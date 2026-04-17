# BACOT Security Test Suite
## Blockchain-Based Commodity Trading Platform – Dissertation Security Tests

This directory contains all executable test scripts for the 12 test cases
defined in **Section 4.3** of the dissertation.

---

## Directory Structure

```
test_scripts/
├── README.md
├── helpers/
│   └── fixtures.js               # Shared deploy & setup utilities
│
├── TC-AUTH-01_signature_replay.js        # Spoofing: EIP-712 replay
├── TC-AUTH-02_crosschain_replay.js       # Spoofing: Cross-chain domain binding
├── TC-AUTH-03_unauthorized_trade.js      # Spoofing: KYC access control
│
├── TC-SC-01_reentrancy_escrow.js         # Tampering: Re-entrancy (EscrowPayments)
├── TC-SC-02_state_transition_bypass.js   # Tampering: Trade lifecycle bypass
├── TC-SC-03_access_control.js           # Elevation of Privilege: Roles
│
├── TC-FIN-01_approval_race.js           # Repudiation: ERC-20 approval race
├── TC-FIN-02_tod_escrow.js              # Repudiation: Transaction ordering
│
├── TC-INF-01_gas_exhaustion.js          # DoS: Unbounded loop gas
├── TC-INF-02_mempool_flood.js           # DoS: Settlement deadline enforcement
│
├── TC-API-01_api_injection.js           # Info Disclosure: API injection (Node.js)
├── TC-API-02_oracle_integrity.js        # Info Disclosure: Oracle data integrity
│
└── run_static_analysis.sh              # Slither + Mythril runner (TC-SC-01/02/03)
```

---

## Prerequisites

### 1. Copy scripts into your Hardhat project

```bash
cp -r test_scripts/* /path/to/your/bacot-repo/test/security/
```

### 2. Install dependencies

```bash
cd /path/to/your/bacot-repo
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox chai
```

### 3. Ensure hardhat.config.js exists

Your `hardhat.config.js` should include at minimum:

```javascript
require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } }
  },
  networks: {
    hardhat: {
      chainId: 31337,
      blockGasLimit: 30000000,
    }
  }
};
```

### 4. Static analysis tools (optional but recommended)

```bash
pip3 install slither-analyzer mythril
```

---

## Running Tests

### Run all Hardhat tests

```bash
npx hardhat test test/security/TC-AUTH-01_signature_replay.js
npx hardhat test test/security/TC-AUTH-02_crosschain_replay.js
npx hardhat test test/security/TC-AUTH-03_unauthorized_trade_initiation.js
npx hardhat test test/security/TC-SC-01_reentrancy_escrow.js
npx hardhat test test/security/TC-SC-02_state_transition_bypass.js
npx hardhat test test/security/TC-SC-03_access_control.js
npx hardhat test test/security/TC-FIN-01_approval_race.js
npx hardhat test test/security/TC-FIN-02_tod_escrow.js
npx hardhat test test/security/TC-INF-01_gas_exhaustion.js
npx hardhat test test/security/TC-INF-02_mempool_flood.js
npx hardhat test test/security/TC-API-02_oracle_integrity.js
```

### Run all tests at once

```bash
npx hardhat test 'test/security/TC-*.js'
```

### Run the API injection test (standalone Node.js)

```bash
# Start your off-chain API server first, then:
node test/security/TC-API-01_api_injection.js http://localhost:3000 YOUR_API_KEY
```

### Run static analysis

```bash
bash test/security/run_static_analysis.sh ./contracts
```

---

## Test Case to Script Mapping

| Test ID    | Script File                            | Tool(s)            | STRIDE       | Severity |
|------------|----------------------------------------|--------------------|--------------|----------|
| TC-AUTH-01 | TC-AUTH-01_signature_replay.js         | Hardhat            | Spoofing     | Critical |
| TC-AUTH-02 | TC-AUTH-02_crosschain_replay.js        | Hardhat            | Spoofing     | Critical |
| TC-AUTH-03 | TC-AUTH-03_unauthorized_trade_initiation.js | Hardhat       | Spoofing     | Critical |
| TC-SC-01   | TC-SC-01_reentrancy_escrow.js          | Slither, Hardhat   | Tampering    | High     |
| TC-SC-02   | TC-SC-02_state_transition_bypass.js    | Hardhat, Mythril   | Tampering    | High     |
| TC-SC-03   | TC-SC-03_access_control.js             | Slither, Hardhat   | EoP          | Critical |
| TC-FIN-01  | TC-FIN-01_approval_race.js             | Hardhat            | Repudiation  | High     |
| TC-FIN-02  | TC-FIN-02_tod_escrow.js                | Hardhat, Mythril   | Repudiation  | High     |
| TC-INF-01  | TC-INF-01_gas_exhaustion.js            | Hardhat            | DoS          | Medium   |
| TC-INF-02  | TC-INF-02_mempool_flood.js             | Hardhat            | DoS          | Medium   |
| TC-API-01  | TC-API-01_api_injection.js             | Manual (Node.js)   | Info Disc.   | Med-High |
| TC-API-02  | TC-API-02_oracle_integrity.js          | Hardhat            | Info Disc.   | Med-High |

---

## Notes on acceptTrade() Signature Guard

`TradeManager.acceptTrade()` contains an inverted signature check:
```solidity
require(!isValidSignatureNow(msg.sender, _tradeId, _signature), "Invalid signature");
```
This means a **valid** EIP-712 signature causes a revert, and an **invalid/dummy**
signature passes the guard. The TC-AUTH-01 and TC-AUTH-02 tests account for this
by testing the EIP-712 domain binding directly rather than via `acceptTrade()` alone.
This logic should be flagged as a **potential bug** in your findings.

---

## Audit Finding from TC-API-02

`ShipmentTracker.addShipmentCheckpoint()` accepts `dataHash = bytes32(0)` without
validation. Recommendation: add `require(_dataHash != bytes32(0), "Hash required")`.
