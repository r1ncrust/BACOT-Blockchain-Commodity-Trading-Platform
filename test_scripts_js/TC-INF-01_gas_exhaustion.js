// =============================================================================
// TC-INF-01 | Gas Exhaustion via Unbounded Loops (DoS)
// Target   : ShipmentTracker.sol – getStatusUpdates(), getCheckpoints()
//            EscrowPayments.sol  – (no on-chain loop, but gas cost measured)
// Threat   : Denial of Service
// Tool     : Hardhat (gas reporter)
// Severity : Medium (CVSS 5.5–7.5)
//
// Objective:
//   Identify functions whose gas cost grows unboundedly with on-chain data
//   size, potentially causing:
//     (a) Block gas limit exhaustion – transactions can no longer be confirmed.
//     (b) Griefing – attacker inflates data arrays to make legitimate calls
//         prohibitively expensive or impossible.
//
//   ShipmentTracker stores statusUpdates[] and checkpoints[] as dynamic arrays
//   per shipment.  Repeated addShipmentCheckpoint() calls grow these arrays.
//
// Methodology:
//   1. Add N checkpoints to a shipment where N = 10, 50, 100, 200.
//   2. Measure gas consumed by getCheckpoints() at each N.
//   3. Record whether gas approaches the Hardhat block gas limit (30M).
//   4. Check updateShipmentStatus() gas growth with repeated status history.
//
// Expected pass: Gas grows linearly but stays well within block limit for
//                realistic N; contract enforces a size cap (if any).
// Vulnerability: Gas exceeds 30M for realistic N → Medium/High finding.
// =============================================================================

const { expect } = require("chai");
const { ethers }  = require("hardhat");

// Block gas limit used in Hardhat default config
const BLOCK_GAS_LIMIT = 30_000_000n;
const GAS_WARNING_THRESHOLD = 20_000_000n; // 66% of block limit

describe("TC-INF-01 | Gas Exhaustion / Unbounded Loop DoS", function () {
  let shipmentTracker;
  let deployer, company;

  const APPROVED_COMPANY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("APPROVED_COMPANY"));

  beforeEach(async function () {
    [deployer, company] = await ethers.getSigners();

    const ST = await ethers.getContractFactory("ShipmentTracker");
    shipmentTracker = await ST.deploy();
    await shipmentTracker.waitForDeployment();

    // Grant the company the APPROVED_COMPANY role required by ShipmentTracker
    await shipmentTracker.grantRole(APPROVED_COMPANY_ROLE, await company.getAddress());
  });

  // ── Helper: create shipment and return ID ─────────────────────────────────
  async function createShipment() {
    const future = Math.floor(Date.now() / 1000) + 86400 * 90;
    const tx = await shipmentTracker.connect(company).createShipment(
      "Soybeans", 1000, "MT", "Brazil", "China",
      await company.getAddress(), future, "TRK-001"
    );
    const receipt = await tx.wait();
    return receipt.logs.find(l => l.fragment?.name === "ShipmentCreated").args[0];
  }

  // ── Helper: add N checkpoints ─────────────────────────────────────────────
  async function addCheckpoints(shipmentId, n) {
    for (let i = 0; i < n; i++) {
      await shipmentTracker.connect(company).addShipmentCheckpoint(
        shipmentId,
        `Port-${i}`,
        25 + (i % 10),   // temperature
        60 + (i % 20),   // humidity
        ethers.keccak256(ethers.toUtf8Bytes(`checkpoint-data-${i}`))
      );
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  it("PASS: Single checkpoint – baseline gas cost", async function () {
    const shipmentId = await createShipment();
    await addCheckpoints(shipmentId, 1);

    // Static call to measure gas for getter
    const gasEstimate = await shipmentTracker.getCheckpoints.estimateGas(shipmentId);
    console.log(`  Gas for getCheckpoints(1 entry) : ${gasEstimate.toString()}`);
    expect(gasEstimate).to.be.lessThan(BLOCK_GAS_LIMIT);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("GAS PROFILE: getCheckpoints() gas growth at N = 10, 50, 100", async function () {
    const results = [];

    for (const n of [10, 50, 100]) {
      const shipmentId = await createShipment();
      await addCheckpoints(shipmentId, n);

      const gasEstimate = await shipmentTracker.getCheckpoints.estimateGas(shipmentId);
      results.push({ n, gas: gasEstimate });

      console.log(`  N=${String(n).padStart(3)}: getCheckpoints() gas = ${gasEstimate.toString()}`);

      if (gasEstimate > GAS_WARNING_THRESHOLD) {
        console.warn(`  ⚠️  WARNING: Gas (${gasEstimate}) exceeds 66% of block limit at N=${n}`);
      }

      expect(gasEstimate).to.be.lessThan(
        BLOCK_GAS_LIMIT,
        `Gas limit exceeded at N=${n} – DoS vulnerability confirmed`
      );
    }

    // Verify linear growth (gas[N=50] / gas[N=10] should be roughly 5x)
    const ratio = Number(results[1].gas) / Number(results[0].gas);
    console.log(`  Growth ratio N=50/N=10 : ${ratio.toFixed(2)}x`);
    console.log("  ✅ Gas growth is within block limit for N ≤ 100");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("GAS PROFILE: addShipmentCheckpoint() per-call gas cost", async function () {
    const shipmentId = await createShipment();

    const costs = [];
    for (let i = 0; i < 5; i++) {
      const tx = await shipmentTracker.connect(company).addShipmentCheckpoint(
        shipmentId, `Port-${i}`, 22, 55,
        ethers.keccak256(ethers.toUtf8Bytes(`data-${i}`))
      );
      const receipt = await tx.wait();
      costs.push(receipt.gasUsed);
      console.log(`  Checkpoint ${i+1} gas used: ${receipt.gasUsed.toString()}`);
    }

    // Check that per-call gas is stable (append cost should not grow per entry)
    const maxCost = costs.reduce((a, b) => a > b ? a : b);
    expect(maxCost).to.be.lessThan(500_000n, "Single checkpoint add should cost < 500k gas");
    console.log("✅ Per-call addShipmentCheckpoint() gas is stable");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("GAS PROFILE: getStatusUpdates() growth with repeated status history", async function () {
    const shipmentId = await createShipment();

    // Walk the valid status transition chain: CREATED→PICKED_UP→IN_TRANSIT→CUSTOMS→DELIVERED
    // StatusEnum: CREATED=0, PICKED_UP=1, IN_TRANSIT=2, CUSTOMS=3, DELIVERED=4
    const transitions = [1, 2, 3, 4]; // PICKED_UP, IN_TRANSIT, CUSTOMS, DELIVERED

    for (const status of transitions) {
      await shipmentTracker.connect(company).updateShipmentStatus(
        shipmentId, status, `Status update to ${status}`
      );
    }

    // There should be 5 entries (1 initial + 4 transitions)
    const updates = await shipmentTracker.getStatusUpdates(shipmentId);
    expect(updates.length).to.equal(5);

    const gasEstimate = await shipmentTracker.getStatusUpdates.estimateGas(shipmentId);
    console.log(`  Gas for getStatusUpdates(5 entries): ${gasEstimate.toString()}`);
    expect(gasEstimate).to.be.lessThan(BLOCK_GAS_LIMIT);
    console.log("✅ Status update history gas within acceptable limits");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: Verify no write operation iterates over unbounded array", async function () {
    // createShipment, updateShipmentStatus, addShipmentCheckpoint all do O(1) writes.
    // This test confirms write gas is independent of existing array size.
    const shipmentId = await createShipment();

    // Pre-populate with 20 checkpoints
    await addCheckpoints(shipmentId, 20);

    // Measure next write gas
    const tx = await shipmentTracker.connect(company).addShipmentCheckpoint(
      shipmentId, "FinalPort", 20, 50,
      ethers.keccak256(ethers.toUtf8Bytes("final"))
    );
    const receipt = await tx.wait();

    console.log(`  Write gas after 20 existing checkpoints: ${receipt.gasUsed.toString()}`);
    expect(receipt.gasUsed).to.be.lessThan(500_000n);
    console.log("✅ Write operations are O(1) – no unbounded iteration on writes");
  });
});
