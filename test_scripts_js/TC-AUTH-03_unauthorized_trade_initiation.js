// =============================================================================
// TC-AUTH-03 | Unauthorized Trade Initiation (KYC / Access Control)
// Target   : TradeManager.sol – createTrade()
//            CompanyRegistry.sol – isApprovedCompany(), isSeller()
// Threat   : Spoofing
// Tool     : Hardhat
// Severity : Critical (CVSS 9.0–10.0)
//
// Objective:
//   Attempt to initiate trades from accounts that bypass the KYC / onboarding
//   flow enforced by CompanyRegistry.  Tests five scenarios:
//     1. Completely unregistered address as buyer.
//     2. Registered-but-PENDING address as buyer (not yet approved).
//     3. SUSPENDED address as buyer.
//     4. Approved BUYER using an unregistered address as seller.
//     5. Approved BUYER using a PENDING address as seller.
//
// Expected pass (all): createTrade() reverts with an access-control message.
// Expected fail: Trade is created → CRITICAL finding.
// =============================================================================

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TC-AUTH-03 | Unauthorized Trade Initiation", function () {
  let companyRegistry, tradeManager, mockToken;
  let deployer, approvedBuyer, approvedSeller, pendingBuyer, suspendedBuyer,
      unregistered, pendingSeller;
  const FUTURE = Math.floor(Date.now() / 1000) + 86400 * 30;
  const DISPUTE_WINDOW = 86400 * 7;

  // Default trade parameters
  function tradeParams(sellerAddr) {
    return [
      sellerAddr,
      "Palm Oil", 500, "MT",
      ethers.parseEther("800"),
      ethers.ZeroAddress, // replaced per test if needed
      "CIF", 0, FUTURE, DISPUTE_WINDOW,
      ethers.parseEther("4000"),
    ];
  }

  beforeEach(async function () {
    [
      deployer, approvedBuyer, approvedSeller,
      pendingBuyer, suspendedBuyer, unregistered, pendingSeller,
    ] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("CompanyRegistry");
    companyRegistry = await Registry.deploy();
    await companyRegistry.waitForDeployment();

    const TM = await ethers.getContractFactory("TradeManager");
    tradeManager = await TM.deploy(await companyRegistry.getAddress());
    await tradeManager.waitForDeployment();

    const Token = await ethers.getContractFactory("MockERC20");
    mockToken = await Token.deploy("TestUSD", "TUSD", 18);
    await mockToken.waitForDeployment();

    // approvedBuyer: register + approve
    await companyRegistry.connect(approvedBuyer).registerCompany(
      "Good Buyer", "B-001", "NZ", "buyer@ok.com", 0
    );
    await companyRegistry.approveCompany(await approvedBuyer.getAddress());

    // approvedSeller: register + approve
    await companyRegistry.connect(approvedSeller).registerCompany(
      "Good Seller", "S-001", "AU", "seller@ok.com", 1
    );
    await companyRegistry.approveCompany(await approvedSeller.getAddress());

    // pendingBuyer: registered only (status = PENDING)
    await companyRegistry.connect(pendingBuyer).registerCompany(
      "Pending Buyer", "B-002", "NZ", "pending@buy.com", 0
    );

    // suspendedBuyer: registered, approved, then suspended
    await companyRegistry.connect(suspendedBuyer).registerCompany(
      "Suspended Co", "B-003", "NZ", "suspended@co.com", 0
    );
    await companyRegistry.approveCompany(await suspendedBuyer.getAddress());
    await companyRegistry.suspendCompany(await suspendedBuyer.getAddress());

    // pendingSeller: registered only
    await companyRegistry.connect(pendingSeller).registerCompany(
      "Pending Seller", "S-002", "AU", "pending@sell.com", 1
    );
  });

  // ── Helper: extract tokenAddress into params ──────────────────────────────
  function params(sellerAddr) {
    return [
      sellerAddr, "Palm Oil", 500, "MT",
      ethers.parseEther("800"),
      ethers.ZeroAddress,          // payment token (not needed to test access)
      "CIF", 0, FUTURE, DISPUTE_WINDOW, ethers.parseEther("4000"),
    ];
  }

  // ────────────────────────────────────────────────────────────────────────
  it("PASS: Approved buyer + approved seller can create a trade", async function () {
    await expect(
      tradeManager.connect(approvedBuyer).createTrade(...params(await approvedSeller.getAddress()))
    ).to.emit(tradeManager, "TradeCreated");
    console.log("✅ Approved buyer + seller can create trade");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: Unregistered address as buyer must be rejected", async function () {
    await expect(
      tradeManager.connect(unregistered).createTrade(...params(await approvedSeller.getAddress()))
    ).to.be.revertedWith("Creator not approved");
    console.log("✅ Unregistered buyer correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: Registered-but-PENDING buyer must be rejected", async function () {
    await expect(
      tradeManager.connect(pendingBuyer).createTrade(...params(await approvedSeller.getAddress()))
    ).to.be.revertedWith("Creator not approved");
    console.log("✅ Pending (unapproved) buyer correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: SUSPENDED buyer must be rejected", async function () {
    await expect(
      tradeManager.connect(suspendedBuyer).createTrade(...params(await approvedSeller.getAddress()))
    ).to.be.revertedWith("Creator not approved");
    console.log("✅ Suspended buyer correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: Approved buyer with unregistered seller address must be rejected", async function () {
    await expect(
      tradeManager.connect(approvedBuyer).createTrade(...params(await unregistered.getAddress()))
    ).to.be.revertedWith("Seller not approved");
    console.log("✅ Unregistered seller address correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: Approved buyer with PENDING seller must be rejected", async function () {
    await expect(
      tradeManager.connect(approvedBuyer).createTrade(...params(await pendingSeller.getAddress()))
    ).to.be.revertedWith("Seller not approved");
    console.log("✅ Pending seller correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: approveCompany() called by non-admin/non-reviewer must revert", async function () {
    // Privilege escalation attempt: attacker tries to self-approve
    await companyRegistry.connect(unregistered).registerCompany(
      "Attacker Inc", "ATK-001", "XX", "atk@evil.com", 0
    );
    await expect(
      companyRegistry.connect(unregistered).approveCompany(await unregistered.getAddress())
    ).to.be.revertedWith("Not reviewer");
    console.log("✅ Self-approval by non-reviewer correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("AUDIT: CompanyRegistry status values after lifecycle", async function () {
    const pending   = await companyRegistry.getCompany(await pendingBuyer.getAddress());
    const suspended = await companyRegistry.getCompany(await suspendedBuyer.getAddress());
    const approved  = await companyRegistry.getCompany(await approvedBuyer.getAddress());

    // 0 = PENDING, 1 = APPROVED, 2 = SUSPENDED
    expect(pending.status).to.equal(0,  "pendingBuyer should be PENDING");
    expect(suspended.status).to.equal(2,"suspendedBuyer should be SUSPENDED");
    expect(approved.status).to.equal(1, "approvedBuyer should be APPROVED");

    console.log("  Status: pending=", pending.status,
                " suspended=", suspended.status,
                " approved=",  approved.status);
    console.log("✅ Registry status values are correct");
  });
});
