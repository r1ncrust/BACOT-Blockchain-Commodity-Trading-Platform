// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/ITradeManager.sol";
import "./interfaces/ICompanyRegistry.sol";

contract TradeManager is ITradeManager, EIP712, AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant REVIEWER_ROLE = keccak256("REVIEWER_ROLE");

    ICompanyRegistry public companyRegistry;
    mapping(uint256 => Trade) private trades;
    mapping(uint256 => bool) private tradeExists;
    mapping(address => uint256) private nonces;
    uint256 private nextTradeId = 1;

    struct TradeOffer {
        uint256 tradeId;
        address seller;
        address buyer;
        uint256 nonce;
        uint256 deadline;
    }

    constructor(address _companyRegistry) EIP712("TradeManager", "1") {
        companyRegistry = ICompanyRegistry(_companyRegistry);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(REVIEWER_ROLE, msg.sender);
    }

    function createTrade(
        address _seller,
        string memory _commodityType,
        uint256 _quantity,
        string memory _unit,
        uint256 _pricePerUnit,
        address _paymentToken,
        string memory _incoterms,
        uint256 _shipmentId,
        uint256 _expiryTimestamp,
        uint256 _disputeWindowDuration,
        uint256 _depositAmount
    ) external returns (uint256) {
        require(companyRegistry.isApprovedCompany(msg.sender), "Creator not approved");
        require(companyRegistry.isSeller(_seller), "Seller not approved");
        require(bytes(_commodityType).length > 0, "Commodity type required");
        require(_quantity > 0, "Quantity must be positive");
        require(_pricePerUnit > 0, "Price must be positive");
        require(_expiryTimestamp > block.timestamp, "Invalid expiry timestamp");
        require(_disputeWindowDuration > 0, "Dispute window must be positive");

        uint256 tradeId = nextTradeId++;
        
        trades[tradeId] = Trade({
            id: tradeId,
            buyer: msg.sender,
            seller: _seller,
            commodityType: _commodityType,
            quantity: _quantity,
            unit: _unit,
            pricePerUnit: _pricePerUnit,
            paymentToken: _paymentToken,
            incoterms: _incoterms,
            shipmentId: _shipmentId,
            expiryTimestamp: _expiryTimestamp,
            disputeWindowEnds: _expiryTimestamp + _disputeWindowDuration,
            depositAmount: _depositAmount,
            status: TradeStatus.CREATED,
            createdAt: block.timestamp,
            buyerSignatureHash: bytes32(0),
            sellerSignatureHash: bytes32(0),
            finalConfirmationHash: bytes32(0)
        });

        tradeExists[tradeId] = true;
        emit TradeCreated(tradeId, msg.sender, _seller);
        return tradeId;
    }

    function acceptTrade(uint256 _tradeId, bytes memory _signature) external {
        require(tradeExists[_tradeId], "Trade does not exist");
        require(trades[_tradeId].status == TradeStatus.CREATED, "Trade not in created state");
        require(trades[_tradeId].seller == msg.sender, "Only seller can accept");
        require(!isValidSignatureNow(msg.sender, _tradeId, _signature), "Invalid signature");

        trades[_tradeId].status = TradeStatus.ACCEPTED;
        trades[_tradeId].sellerSignatureHash = ECDSA.toEthSignedMessageHash(
            abi.encodePacked(
                "Accept Trade: ", 
                Strings.toString(_tradeId), 
                " Nonce: ", 
                Strings.toString(nonces[msg.sender])
            )
        );
        
        nonces[msg.sender]++;
        emit TradeAccepted(_tradeId, msg.sender);
    }

    function lockTrade(uint256 _tradeId) external {
        require(tradeExists[_tradeId], "Trade does not exist");
        require(trades[_tradeId].status == TradeStatus.ACCEPTED, "Trade not accepted yet");
        require(msg.sender == trades[_tradeId].buyer || msg.sender == trades[_tradeId].seller, "Not party to trade");

        trades[_tradeId].status = TradeStatus.LOCKED;
        emit TradeLocked(_tradeId);
    }

    function executeTrade(uint256 _tradeId) external {
        require(tradeExists[_tradeId], "Trade does not exist");
        require(trades[_tradeId].status == TradeStatus.LOCKED, "Trade not locked");
        require(block.timestamp <= trades[_tradeId].expiryTimestamp, "Trade expired");
        require(msg.sender == trades[_tradeId].buyer || msg.sender == trades[_tradeId].seller, "Not party to trade");

        trades[_tradeId].status = TradeStatus.EXECUTED;
        emit TradeExecuted(_tradeId);
    }

    function closeTrade(uint256 _tradeId) external {
        require(tradeExists[_tradeId], "Trade does not exist");
        require(trades[_tradeId].status == TradeStatus.EXECUTED, "Trade not executed");
        require(msg.sender == trades[_tradeId].buyer || msg.sender == trades[_tradeId].seller, "Not party to trade");

        trades[_tradeId].status = TradeStatus.CLOSED;
        emit TradeClosed(_tradeId);
    }

    function cancelTrade(uint256 _tradeId) external {
        require(tradeExists[_tradeId], "Trade does not exist");
        require(trades[_tradeId].status != TradeStatus.CLOSED && trades[_tradeId].status != TradeStatus.CANCELLED, "Trade already closed or cancelled");
        require(msg.sender == trades[_tradeId].buyer || msg.sender == trades[_tradeId].seller, "Not party to trade");

        trades[_tradeId].status = TradeStatus.CANCELLED;
        emit TradeCancelled(_tradeId);
    }

    function disputeTrade(uint256 _tradeId) external {
        require(tradeExists[_tradeId], "Trade does not exist");
        require(trades[_tradeId].status == TradeStatus.EXECUTED, "Trade not executed");
        require(block.timestamp <= trades[_tradeId].disputeWindowEnds, "Dispute window closed");
        require(msg.sender == trades[_tradeId].buyer, "Only buyer can dispute");

        trades[_tradeId].status = TradeStatus.DISPUTED;
        emit TradeDisputed(_tradeId);
    }

    function uploadDocument(uint256 _tradeId, string memory _uri, bytes32 _hash) external {
        require(tradeExists[_tradeId], "Trade does not exist");
        require(msg.sender == trades[_tradeId].buyer || msg.sender == trades[_tradeId].seller, "Not party to trade");

        emit DocumentUploaded(_tradeId, _uri, _hash);
    }

    function getTrade(uint256 _tradeId) external view returns (Trade memory) {
        return trades[_tradeId];
    }

    function isValidSignatureNow(address _signer, uint256 _tradeId, bytes memory _signature) internal view returns (bool) {
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    keccak256("Trade(uint256 tradeId,address signer,uint256 nonce,uint256 deadline)"),
                    _tradeId,
                    _signer,
                    nonces[_signer],
                    trades[_tradeId].expiryTimestamp
                )
            )
        );
        return ECDSA.recover(digest, _signature) == _signer;
    }

    function getNonce(address _address) external view returns (uint256) {
        return nonces[_address];
    }
}