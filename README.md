# Commodity Trading on Ethereum

A comprehensive commodity trading platform built on Ethereum using smart contracts and modern Web3 technologies.

## Features

### Core Functionality
1. **Company Onboarding**
   - Company registration with roles (BUYER, SELLER, BOTH)
   - Profile management with legal details
   - Admin approval workflow
   - Status tracking (PENDING/APPROVED/SUSPENDED)

2. **Commodity Shipment Tracking**
   - Complete shipment lifecycle management
   - Real-time status updates with timestamps
   - IoT-style checkpoint tracking
   - Append-only audit trail

3. **Trading Contract & Document Signing**
   - EIP-712 typed data signatures for document signing
   - Multi-stage trade workflow (Create → Accept → Lock → Execute → Close)
   - Document management with IPFS storage
   - Replay protection with nonces

4. **Payment & Escrow System**
   - ERC-20 stablecoin support
   - Escrow functionality with dispute resolution
   - Partial payment handling
   - Automated refund mechanisms

## Architecture

- **Smart Contracts**: Solidity ^0.8.x with OpenZeppelin libraries
- **Frontend**: React with TypeScript
- **Backend**: Node.js/Express for document storage
- **Testing**: Hardhat with Chai for unit tests

## Security Measures

- Access control with OpenZeppelin's AccessControl
- Reentrancy protection for payments
- EIP-712 signatures with replay prevention
- State validation and authorization checks
- Secure token handling with approve/transferFrom pattern

## Setup Instructions

### Prerequisites
- Node.js v18+
- npm/yarn
- MetaMask wallet
- Ethereum node (Ganache, Hardhat, or Infura)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd commodity-trading-platform