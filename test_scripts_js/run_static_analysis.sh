#!/usr/bin/env bash
# =============================================================================
# run_static_analysis.sh  –  Static analysis for TC-SC-01, TC-SC-02, TC-SC-03
# Tools: Slither, Mythril
# Usage: bash run_static_analysis.sh [contracts_dir]
# =============================================================================

set -euo pipefail

CONTRACTS_DIR="${1:-./contracts}"
REPORT_DIR="./reports/static"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

GREEN="\033[0;32m"; RED="\033[0;31m"; YELLOW="\033[1;33m"; NC="\033[0m"

mkdir -p "$REPORT_DIR"

echo -e "${GREEN}=== BACOT Static Analysis Runner ===${NC}"
echo "Contracts: $CONTRACTS_DIR"
echo "Reports:   $REPORT_DIR"
echo ""

# ── Slither ───────────────────────────────────────────────────────────────────
if command -v slither &>/dev/null; then
  echo -e "${GREEN}[1/2] Running Slither...${NC}"

  # TC-SC-01: Re-entrancy (EscrowPayments)
  echo "  → Checking re-entrancy in EscrowPayments..."
  slither "$CONTRACTS_DIR/EscrowPayments.sol" \
    --detect reentrancy-eth,reentrancy-no-eth,reentrancy-events \
    --json "$REPORT_DIR/slither_reentrancy_${TIMESTAMP}.json" \
    2>&1 | tee "$REPORT_DIR/slither_reentrancy_${TIMESTAMP}.txt" || true

  # TC-SC-03: Access control (all contracts)
  echo "  → Checking access control across all contracts..."
  slither "$CONTRACTS_DIR/" \
    --detect unprotected-upgrade,suicidal,arbitrary-send-eth,\
controlled-delegatecall,tx-origin,weak-prng,unchecked-transfer \
    --json "$REPORT_DIR/slither_access_${TIMESTAMP}.json" \
    2>&1 | tee "$REPORT_DIR/slither_access_${TIMESTAMP}.txt" || true

  # Full comprehensive scan
  echo "  → Full Slither scan..."
  slither "$CONTRACTS_DIR/" \
    --json "$REPORT_DIR/slither_full_${TIMESTAMP}.json" \
    2>&1 | tee "$REPORT_DIR/slither_full_${TIMESTAMP}.txt" || true

  echo -e "${GREEN}  ✅ Slither done. Reports: $REPORT_DIR/slither_*_${TIMESTAMP}.*${NC}"
else
  echo -e "${YELLOW}  ⚠️  Slither not found. Install: pip3 install slither-analyzer${NC}"
fi

echo ""

# ── Mythril ───────────────────────────────────────────────────────────────────
if command -v myth &>/dev/null; then
  echo -e "${GREEN}[2/2] Running Mythril...${NC}"

  # Mythril config file (solc remappings for OpenZeppelin)
  cat > /tmp/mythril_config.json <<'EOF'
{
  "remappings": ["@openzeppelin=./node_modules/@openzeppelin"],
  "optimizer": {"enabled": true, "runs": 200}
}
EOF

  for contract in EscrowPayments TradeManager CompanyRegistry ShipmentTracker; do
    echo "  → Analysing $contract.sol (TC-SC-01/02/03)..."
    myth analyze "$CONTRACTS_DIR/$contract.sol" \
      --solc-json /tmp/mythril_config.json \
      --execution-timeout 120 \
      -o json \
      > "$REPORT_DIR/mythril_${contract}_${TIMESTAMP}.json" 2>&1 || true
    echo "     Report: $REPORT_DIR/mythril_${contract}_${TIMESTAMP}.json"
  done

  echo -e "${GREEN}  ✅ Mythril done.${NC}"
else
  echo -e "${YELLOW}  ⚠️  Mythril not found. Install: pip3 install mythril${NC}"
fi

echo ""
echo -e "${GREEN}=== Static Analysis Complete ===${NC}"
echo "All reports saved to: $REPORT_DIR/"

# ── Echidna (fuzz testing for TC-SC-03 access control) ───────────────────────
echo ""
if command -v echidna &>/dev/null; then
  echo -e "${GREEN}[Bonus] Running Echidna fuzz test for access control...${NC}"
  cat > /tmp/echidna_test.sol <<'EOF'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./contracts/CompanyRegistry.sol";

contract EchidnaAccessTest is CompanyRegistry {
    address internal _attacker = address(0xdeadbeef);

    // Invariant: attacker should never hold ADMIN_ROLE
    function echidna_no_attacker_admin() public view returns (bool) {
        return !hasRole(ADMIN_ROLE, _attacker);
    }

    // Invariant: attacker should never hold REVIEWER_ROLE
    function echidna_no_attacker_reviewer() public view returns (bool) {
        return !hasRole(REVIEWER_ROLE, _attacker);
    }
}
EOF
  echidna /tmp/echidna_test.sol \
    --contract EchidnaAccessTest \
    --config /dev/null \
    2>&1 | tee "$REPORT_DIR/echidna_access_${TIMESTAMP}.txt" || true
  echo -e "${GREEN}  ✅ Echidna done.${NC}"
else
  echo -e "${YELLOW}  ⚠️  Echidna not found. Install from: https://github.com/crytic/echidna${NC}"
fi
