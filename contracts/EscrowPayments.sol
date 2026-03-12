// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IEscrowPayments.sol";
import "./interfaces/ITradeManager.sol";

contract EscrowPayments is IEscrowPayments, ReentrancyGuard, AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ARBITRATOR_ROLE = keccak256("ARBITRATOR_ROLE");

    ITradeManager public tradeManager;
    mapping(uint256 => Escrow) private escrows;
    uint256 public constant DISPUTE_DURATION = 7 days; // 7 days dispute period

    modifier onlyApprovedParties(uint256 _tradeId) {
        ITradeManager.Trade memory trade = tradeManager.getTrade(_tradeId);
        require(msg.sender == trade.buyer || msg.sender == trade.seller, "Not party to trade");
        _;
    }

    modifier onlyArbitrator() {
        require(hasRole(ARBITRATOR_ROLE, msg.sender) || hasRole(ADMIN_ROLE, msg.sender), "Not arbitrator");
        _;
    }

    constructor(address _tradeManager) {
        tradeManager = ITradeManager(_tradeManager);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(ARBITRATOR_ROLE, msg.sender);
    }

    function fundEscrow(uint256 _tradeId, uint256 _amount) external nonReentrant {
        ITradeManager.Trade memory trade = tradeManager.getTrade(_tradeId);
        require(trade.id != 0, "Trade does not exist");
        require(msg.sender == trade.buyer, "Only buyer can fund escrow");
        require(trade.status == ITradeManager.TradeStatus.LOCKED, "Trade not locked");
        require(_amount > 0, "Amount must be positive");

        IERC20 token = IERC20(trade.paymentToken);
        require(token.transferFrom(msg.sender, address(this), _amount), "Transfer failed");

        if (escrows[_tradeId].tradeId == 0) {
            escrows[_tradeId] = Escrow({
                tradeId: _tradeId,
                buyer: trade.buyer,
                seller: trade.seller,
                paymentToken: trade.paymentToken,
                totalAmount: _amount,
                releasedAmount: 0,
                isReleased: false,
                isRefunded: false,
                disputeStartTime: 0,
                inDispute: false
            });
        } else {
            escrows[_tradeId].totalAmount += _amount;
        }

        emit EscrowFunded(_tradeId, _amount);
    }

    function releasePayment(uint256 _tradeId) external nonReentrant onlyApprovedParties(_tradeId) {
        require(escrows[_tradeId].tradeId != 0, "Escrow does not exist");
        require(!escrows[_tradeId].isReleased, "Payment already released");
        require(!escrows[_tradeId].isRefunded, "Payment already refunded");
        require(!escrows[_tradeId].inDispute, "In dispute");
        
        ITradeManager.Trade memory trade = tradeManager.getTrade(_tradeId);
        require(trade.status == ITradeManager.TradeStatus.EXECUTED, "Trade not executed");

        escrows[_tradeId].isReleased = true;
        escrows[_tradeId].releasedAmount = escrows[_tradeId].totalAmount;

        IERC20 token = IERC20(escrows[_tradeId].paymentToken);
        require(token.transfer(escrows[_tradeId].seller, escrows[_tradeId].totalAmount), "Transfer failed");

        emit EscrowReleased(_tradeId, escrows[_tradeId].totalAmount);
    }

    function refundPayment(uint256 _tradeId) external nonReentrant onlyApprovedParties(_tradeId) {
        require(escrows[_tradeId].tradeId != 0, "Escrow does not exist");
        require(!escrows[_tradeId].isReleased, "Payment already released");
        require(!escrows[_tradeId].isRefunded, "Payment already refunded");
        require(!escrows[_tradeId].inDispute, "In dispute");

        ITradeManager.Trade memory trade = tradeManager.getTrade(_tradeId);
        require(trade.status == ITradeManager.TradeStatus.CANCELLED || 
                (trade.status == ITradeManager.TradeStatus.CREATED && block.timestamp > trade.expiryTimestamp), 
                "Cannot refund");

        escrows[_tradeId].isRefunded = true;

        IERC20 token = IERC20(escrows[_tradeId].paymentToken);
        require(token.transfer(escrows[_tradeId].buyer, escrows[_tradeId].totalAmount), "Transfer failed");

        emit EscrowRefunded(_tradeId, escrows[_tradeId].totalAmount);
    }

    function initiateDispute(uint256 _tradeId) external nonReentrant onlyApprovedParties(_tradeId) {
        require(escrows[_tradeId].tradeId != 0, "Escrow does not exist");
        require(!escrows[_tradeId].isReleased, "Payment already released");
        require(!escrows[_tradeId].isRefunded, "Payment already refunded");
        require(!escrows[_tradeId].inDispute, "Already in dispute");

        ITradeManager.Trade memory trade = tradeManager.getTrade(_tradeId);
        require(trade.status == ITradeManager.TradeStatus.DISPUTED, "Trade not in dispute status");

        escrows[_tradeId].inDispute = true;
        escrows[_tradeId].disputeStartTime = block.timestamp;

        emit EscrowDisputed(_tradeId);
    }

    function resolveDispute(uint256 _tradeId, DisputeResolution _resolution, uint256 _splitAmount) 
        external 
        nonReentrant 
        onlyArbitrator 
    {
        require(escrows[_tradeId].tradeId != 0, "Escrow does not exist");
        require(escrows[_tradeId].inDispute, "Not in dispute");
        require(escrows[_tradeId].disputeStartTime + DISPUTE_DURATION >= block.timestamp, "Dispute resolution expired");

        escrows[_tradeId].inDispute = false;

        IERC20 token = IERC20(escrows[_tradeId].paymentToken);
        uint256 remainingAmount = escrows[_tradeId].totalAmount;

        if (_resolution == DisputeResolution.RELEASE_TO_SELLER) {
            require(token.transfer(escrows[_tradeId].seller, remainingAmount), "Transfer failed");
            escrows[_tradeId].releasedAmount = remainingAmount;
            escrows[_tradeId].isReleased = true;
        } else if (_resolution == DisputeResolution.REFUND_TO_BUYER) {
            require(token.transfer(escrows[_tradeId].buyer, remainingAmount), "Transfer failed");
            escrows[_tradeId].isRefunded = true;
        } else if (_resolution == DisputeResolution.SPLIT_PAYMENT) {
            require(_splitAmount <= remainingAmount, "Split amount exceeds available");
            require(token.transfer(escrows[_tradeId].seller, _splitAmount), "Transfer to seller failed");
            uint256 buyerAmount = remainingAmount - _splitAmount;
            require(token.transfer(escrows[_tradeId].buyer, buyerAmount), "Transfer to buyer failed");
            escrows[_tradeId].releasedAmount = _splitAmount;
            escrows[_tradeId].isReleased = true;
        }

        emit EscrowResolved(_tradeId, _resolution);
    }

    function getEscrow(uint256 _tradeId) external view returns (Escrow memory) {
        return escrows[_tradeId];
    }
}