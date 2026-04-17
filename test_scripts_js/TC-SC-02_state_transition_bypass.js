// =============================================================================
// TC-SC-02 | Unauthorized State Transition (Trade Lifecycle Bypass)
// Target   : TradeManager.sol – lockTrade(), executeTrade(), closeTrade()
// Threat   : Tampering
// Tool     : Hardhat, Mythril (run separately via CLI)
// Severity : High (CVSS 8.0–9.0)
//
// Objective:
//   Attempt to advance the trade state machine out of sequence, bypassing
//   required intermediate states.  The BACOT state machine is:
//     CREATED → ACCEPTED → LOCKED → EXECUTED → CLOSED
//                                 ↘ CANCELLED
//                                         ↗ DISPUTED (from EXECUTED)
//
//   Tested bypasses:
//     1. CREATED → LOCKED          (skip ACCEPTED)
//     2. CREATED → EXECUTED        (skip ACCEPTED + LOCKED)
//     3. CREATED → CLOSED          (skip everything)
//     4. ACCEPTED → EXECUTED       (skip LOCKED)
//     5. LOCKED → CLOSED           (skip EXECUTED)
//     6. CANCELLED → any state     (terminal state violation)
//     7. CLOSED → any state        (terminal state violation)
//
// Expected pass (all): reverts with correct status-guard message.
// Expected fail: state advanced without required predecessor → High finding.
//
// Mythril CLI (run separately after test):
//   myth analyze contracts/TradeManager.sol --solc-json mythril.config.json
// =============================================================================

const { expect } = require("chai");
const { ethers }  = require("hardhat");

describe("TC-SC-02 | Unauthorized Trade State Transition", function () {
  let companyRegistry, tradeManager, mockToken;
  let deployer, buyer, seller;
  const FUTURE = Math.floor(Date.now() / 1000) + 86400 * 30;
  const DISPUTE_WINDOW = 86400 * 7;

  async function deployAll() {
    [deployer, buyer, seller] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("CompanyRegistry");
    companyRegistry = await Registry.deploy();
    await companyRegistry.waitForDeployment();

    const TM = await ethers.getContractFactory("TradeManager");
    tradeManager = await TM.deploy(await companyRegistry.getAddress());
    await tradeManager.waitForDeployment();

    const Token = await ethers.getContractFactory("MockERC20");
    mockToken = await Token.deploy("TestUSD", "TUSD", 18);
    await mockToken.waitForDeployment();

    await companyRegistry.connect(buyer).registerCompany(
      "Buyer Corp", "B-001", "NZ", "buyer@test.com", 0
    );
    await companyRegistry.connect(seller).registerCompany(
      "Seller Corp", "S-001", "AU", "seller@test.com", 1
    );
    await companyRegistry.approveCompany(await buyer.getAddress());
    await companyRegistry.approveCompany(await seller.getAddress());
  }

  beforeEach(deployAll);

  // ── Create a trade in CREATED state ──────────────────────────────────────
  async function freshTrade() {
    const tx = await tradeManager.connect(buyer).createTrade(
      await seller.getAddress(),
      "Iron Ore", 2000, "MT",
      ethers.parseEther("120"),
      await mockToken.getAddress(),
      "CFR", 0, FUTURE, DISPUTE_WINDOW,
      ethers.parseEther("24000")
    );
    const receipt = await tx.wait();
    return receipt.logs.find(l => l.fragment?.name === "TradeCreated").args[0];
  }

  // ── Advance to ACCEPTED ───────────────────────────────────────────────────
  async function toAccepted(tradeId) {
    const invalidSig = "0x" + "00".repeat(65);
    await tradeManager.connect(seller).acceptTrade(tradeId, invalidSig);
  }

  // ── Advance to LOCKED ─────────────────────────────────────────────────────
  async function toLocked(tradeId) {
    await toAccepted(tradeId);
    await tradeManager.connect(buyer).lockTrade(tradeId);
  }

  // ── Advance to EXECUTED ───────────────────────────────────────────────────
  async function toExecuted(tradeId) {
    await toLocked(tradeId);
    await tradeManager.connect(buyer).executeTrade(tradeId);
  }

  // ────────────────────────────────────────────────────────────────────────
  it("PASS: Full sequential lifecycle CREATED→ACCEPTED→LOCKED→EXECUTED→CLOSED", async function () {
    const id = await freshTrade();
    await toAccepted(id);

    let t = await tradeManager.getTrade(id);
    expect(t.status).to.equal(1, "Should be ACCEPTED(1)");

    await tradeManager.connect(buyer).lockTrade(id);
    t = await tradeManager.getTrade(id);
    expect(t.status).to.equal(2, "Should be LOCKED(2)");

    await tradeManager.connect(buyer).executeTrade(id);
    t = await tradeManager.getTrade(id);
    expect(t.status).to.equal(3, "Should be EXECUTED(3)");

    await tradeManager.connect(buyer).closeTrade(id);
    t = await tradeManager.getTrade(id);
    expect(t.status).to.equal(4, "Should be CLOSED(4)");

    console.log("✅ Sequential lifecycle completed correctly");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: CREATED → LOCKED (skip ACCEPTED) must revert", async function () {
    const id = await freshTrade();
    await expect(
      tradeManager.connect(buyer).lockTrade(id)
    ).to.be.revertedWith("Trade not accepted yet");
    console.log("✅ CREATED→LOCKED bypass correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: CREATED → EXECUTED (skip ACCEPTED + LOCKED) must revert", async function () {
    const id = await freshTrade();
    await expect(
      tradeManager.connect(buyer).executeTrade(id)
    ).to.be.revertedWith("Trade not locked");
    console.log("✅ CREATED→EXECUTED bypass correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: CREATED → CLOSED (skip all intermediate states) must revert", async function () {
    const id = await freshTrade();
    await expect(
      tradeManager.connect(buyer).closeTrade(id)
    ).to.be.revertedWith("Trade not executed");
    console.log("✅ CREATED→CLOSED bypass correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: ACCEPTED → EXECUTED (skip LOCKED) must revert", async function () {
    const id = await freshTrade();
    await toAccepted(id);
    await expect(
      tradeManager.connect(buyer).executeTrade(id)
    ).to.be.revertedWith("Trade not locked");
    console.log("✅ ACCEPTED→EXECUTED bypass correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: LOCKED → CLOSED (skip EXECUTED) must revert", async function () {
    const id = await freshTrade();
    await toLocked(id);
    await expect(
      tradeManager.connect(buyer).closeTrade(id)
    ).to.be.revertedWith("Trade not executed");
    console.log("✅ LOCKED→CLOSED bypass correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: CANCELLED → LOCKED (terminal state violation) must revert", async function () {
    const id = await freshTrade();
    await tradeManager.connect(buyer).cancelTrade(id);

    await expect(tradeManager.connect(buyer).lockTrade(id))
      .to.be.revertedWith("Trade not accepted yet");
    await expect(tradeManager.connect(buyer).executeTrade(id))
      .to.be.revertedWith("Trade not locked");
    await expect(tradeManager.connect(buyer).closeTrade(id))
      .to.be.revertedWith("Trade not executed");

    console.log("✅ All transitions from CANCELLED correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: CLOSED → any transition (terminal state violation) must revert", async function () {
    const id = await freshTrade();
    await toExecuted(id);
    await tradeManager.connect(buyer).closeTrade(id);

    // Already closed – cancelTrade guard: "Trade already closed or cancelled"
    await expect(tradeManager.connect(buyer).cancelTrade(id))
      .to.be.revertedWith("Trade already closed or cancelled");
    await expect(tradeManager.connect(buyer).closeTrade(id))
      .to.be.revertedWith("Trade not executed");

    console.log("✅ All transitions from CLOSED correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: Non-party cannot advance any state", async function () {
    const [,,,, outsider] = await ethers.getSigners();
    const id = await freshTrade();
    await toAccepted(id);

    await expect(tradeManager.connect(outsider).lockTrade(id))
      .to.be.revertedWith("Not party to trade");
    await expect(tradeManager.connect(outsider).executeTrade(id))
      .to.be.revertedWith("Not party to trade");
    await expect(tradeManager.connect(outsider).closeTrade(id))
      .to.be.revertedWith("Not party to trade");
    await expect(tradeManager.connect(outsider).cancelTrade(id))
      .to.be.revertedWith("Not party to trade");

    console.log("✅ Non-party state advancement correctly rejected for all transitions");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("AUDIT: Print full state enumeration map for evidence", async function () {
    // TradeStatus enum: CREATED=0,ACCEPTED=1,LOCKED=2,EXECUTED=3,CLOSED=4,CANCELLED=5,DISPUTED=6
    const stateNames = ["CREATED","ACCEPTED","LOCKED","EXECUTED","CLOSED","CANCELLED","DISPUTED"];
    const id = await freshTrade();
    let t = await tradeManager.getTrade(id);
    console.log(`  Initial state: ${stateNames[Number(t.status)]} (${t.status})`);

    await toExecuted(id);
    t = await tradeManager.getTrade(id);
    console.log(`  After full lifecycle: ${stateNames[Number(t.status)]} (${t.status})`);
    expect(Number(t.status)).to.equal(3);
  });
});
