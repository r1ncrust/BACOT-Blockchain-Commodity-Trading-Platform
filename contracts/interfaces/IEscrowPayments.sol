// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEscrowPayments {
    enum DisputeResolution { RELEASE_TO_SELLER, REFUND_TO_BUYER, SPLIT_PAYMENT }

    struct Escrow {
        uint256 tradeId;
        address buyer;
        address seller;
        address paymentToken;
        uint256 totalAmount;
        uint256 releasedAmount;
        bool isReleased;
        bool isRefunded;
        uint256 disputeStartTime;
        bool inDispute;
    }

    event EscrowFunded(uint256 indexed tradeId, uint256 amount);
    event EscrowReleased(uint256 indexed tradeId, uint256 amount);
    event EscrowRefunded(uint256 indexed tradeId, uint256 amount);
    event EscrowDisputed(uint256 indexed tradeId);
    event EscrowResolved(uint256 indexed tradeId, DisputeResolution resolution);

    function fundEscrow(uint256 _tradeId, uint256 _amount) external;
    function releasePayment(uint256 _tradeId) external;
    function refundPayment(uint256 _tradeId) external;
    function initiateDispute(uint256 _tradeId) external;
    function resolveDispute(uint256 _tradeId, DisputeResolution _resolution, uint256 _splitAmount) external;
    function getEscrow(uint256 _tradeId) external view returns (Escrow memory);
}