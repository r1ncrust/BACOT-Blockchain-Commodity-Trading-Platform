// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITradeManager {
    enum TradeStatus { 
        CREATED, 
        ACCEPTED, 
        LOCKED, 
        EXECUTED, 
        CLOSED, 
        CANCELLED, 
        DISPUTED 
    }

    struct Trade {
        uint256 id;
        address buyer;
        address seller;
        string commodityType;
        uint256 quantity;
        string unit;
        uint256 pricePerUnit;
        address paymentToken;
        string incoterms;
        uint256 shipmentId;
        uint256 expiryTimestamp;
        uint256 disputeWindowEnds;
        uint256 depositAmount;
        TradeStatus status;
        uint256 createdAt;
        bytes32 buyerSignatureHash;
        bytes32 sellerSignatureHash;
        bytes32 finalConfirmationHash;
    }

    event TradeCreated(uint256 indexed tradeId, address indexed buyer, address indexed seller);
    event TradeAccepted(uint256 indexed tradeId, address accepter);
    event TradeLocked(uint256 indexed tradeId);
    event TradeExecuted(uint256 indexed tradeId);
    event TradeClosed(uint256 indexed tradeId);
    event TradeCancelled(uint256 indexed tradeId);
    event TradeDisputed(uint256 indexed tradeId);
    event DocumentUploaded(uint256 indexed tradeId, string documentUri, bytes32 documentHash);

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
    ) external returns (uint256);

    function acceptTrade(
        uint256 _tradeId,
        bytes memory _signature
    ) external;

    function lockTrade(uint256 _tradeId) external;
    function executeTrade(uint256 _tradeId) external;
    function closeTrade(uint256 _tradeId) external;
    function cancelTrade(uint256 _tradeId) external;
    function disputeTrade(uint256 _tradeId) external;
    function uploadDocument(uint256 _tradeId, string memory _uri, bytes32 _hash) external;
    function getTrade(uint256 _tradeId) external view returns (Trade memory);
}