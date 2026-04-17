// =============================================================================
// TC-SC-03 | Privileged Function Access Control (Elevation of Privilege)
// Target   : CompanyRegistry.sol – approveCompany(), suspendCompany(),
//                                   updateCompanyRole(), grantRole()
//            TradeManager.sol    – AccessControl role management
//            EscrowPayments.sol  – resolveDispute()
//            ShipmentTracker.sol – role-gated functions
// Threat   : Elevation of Privilege
// Tool     : Slither (static), Hardhat (dynamic)
// Severity : Critical (CVSS 9.0–10.0)
//
// Objective:
//   Attempt to call every privileged function from an unprivileged address.
//   Also verify that self-granting of ADMIN_ROLE / REVIEWER_ROLE / ARBITRATOR_ROLE
//   is blocked for non-DEFAULT_ADMIN_ROLE holders.
//
// Slither CLI (run separately):
//   slither contracts/ --detect suicidal,unprotected-upgrade,arbitrary-send-eth,
//                               controlled-delegatecall,reentrancy-eth
//
// Expected pass: Every privileged call from a non-role address reverts.
// Expected fail: Any call succeeds → CRITICAL finding.
// =============================================================================

const { expect } = require("chai");
const { ethers }  = require("hardhat");

describe("TC-SC-03 | Privileged Function Access Control", function () {
  let companyRegistry, tradeManager, escrowPayments;
  let deployer, admin, reviewer, arbitrator, attacker, victim;

  const ADMIN_ROLE      = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));
  const REVIEWER_ROLE   = ethers.keccak256(ethers.toUtf8Bytes("REVIEWER_ROLE"));
  const ARBITRATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ARBITRATOR_ROLE"));
  const DEFAULT_ADMIN   = ethers.ZeroHash; // 0x000...0

  beforeEach(async function () {
    [deployer, admin, reviewer, arbitrator, attacker, victim] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("CompanyRegistry");
    companyRegistry = await Registry.deploy();
    await companyRegistry.waitForDeployment();

    const TM = await ethers.getContractFactory("TradeManager");
    const Token = await ethers.getContractFactory("MockERC20");
    const mockToken = await Token.deploy("T", "T", 18);
    await mockToken.waitForDeployment();
    tradeManager = await TM.deploy(await companyRegistry.getAddress());
    await tradeManager.waitForDeployment();

    const Escrow = await ethers.getContractFactory("EscrowPayments");
    escrowPayments = await Escrow.deploy(await tradeManager.getAddress());
    await escrowPayments.waitForDeployment();

    // Register a victim company so we can test approve/suspend targets
    await companyRegistry.connect(victim).registerCompany(
      "Victim Corp", "V-001", "NZ", "victim@co.com", 0
    );
  });

  // ── CompanyRegistry ───────────────────────────────────────────────────────

  it("SECURITY: Non-reviewer cannot call approveCompany()", async function () {
    await expect(
      companyRegistry.connect(attacker).approveCompany(await victim.getAddress())
    ).to.be.revertedWith("Not reviewer");
    console.log("✅ approveCompany() blocked for non-reviewer");
  });

  it("SECURITY: Non-reviewer cannot call suspendCompany()", async function () {
    // Approve victim first via deployer (who is reviewer)
    await companyRegistry.approveCompany(await victim.getAddress());
    await expect(
      companyRegistry.connect(attacker).suspendCompany(await victim.getAddress())
    ).to.be.revertedWith("Not reviewer");
    console.log("✅ suspendCompany() blocked for non-reviewer");
  });

  it("SECURITY: Non-reviewer cannot call updateCompanyRole()", async function () {
    await expect(
      companyRegistry.connect(attacker).updateCompanyRole(await victim.getAddress(), 1)
    ).to.be.revertedWith("Not reviewer");
    console.log("✅ updateCompanyRole() blocked for non-reviewer");
  });

  // ── AccessControl self-grant attempt ─────────────────────────────────────

  it("SECURITY: Attacker cannot self-grant ADMIN_ROLE via grantRole()", async function () {
    await expect(
      companyRegistry.connect(attacker).grantRole(ADMIN_ROLE, await attacker.getAddress())
    ).to.be.reverted; // AccessControl: sender must be DEFAULT_ADMIN_ROLE
    console.log("✅ ADMIN_ROLE self-grant blocked");
  });

  it("SECURITY: Attacker cannot self-grant REVIEWER_ROLE via grantRole()", async function () {
    await expect(
      companyRegistry.connect(attacker).grantRole(REVIEWER_ROLE, await attacker.getAddress())
    ).to.be.reverted;
    console.log("✅ REVIEWER_ROLE self-grant blocked");
  });

  it("SECURITY: Attacker cannot self-grant DEFAULT_ADMIN_ROLE", async function () {
    await expect(
      companyRegistry.connect(attacker).grantRole(DEFAULT_ADMIN, await attacker.getAddress())
    ).to.be.reverted;
    console.log("✅ DEFAULT_ADMIN_ROLE self-grant blocked");
  });

  // ── EscrowPayments ────────────────────────────────────────────────────────

  it("SECURITY: Non-arbitrator cannot call resolveDispute()", async function () {
    // resolveDispute requires escrow to exist and inDispute=true, but
    // the role check fires first in the onlyArbitrator modifier.
    await expect(
      escrowPayments.connect(attacker).resolveDispute(1, 0, 0)
    ).to.be.revertedWith("Not arbitrator");
    console.log("✅ resolveDispute() blocked for non-arbitrator");
  });

  it("SECURITY: Attacker cannot self-grant ARBITRATOR_ROLE in EscrowPayments", async function () {
    await expect(
      escrowPayments.connect(attacker).grantRole(ARBITRATOR_ROLE, await attacker.getAddress())
    ).to.be.reverted;
    console.log("✅ ARBITRATOR_ROLE self-grant in EscrowPayments blocked");
  });

  // ── TradeManager ──────────────────────────────────────────────────────────

  it("SECURITY: Attacker cannot self-grant ADMIN_ROLE in TradeManager", async function () {
    await expect(
      tradeManager.connect(attacker).grantRole(ADMIN_ROLE, await attacker.getAddress())
    ).to.be.reverted;
    console.log("✅ ADMIN_ROLE self-grant in TradeManager blocked");
  });

  // ── Role verification audit ───────────────────────────────────────────────

  it("AUDIT: Only deployer holds privileged roles at deployment", async function () {
    const deployerAddr  = await deployer.getAddress();
    const attackerAddr  = await attacker.getAddress();

    // CompanyRegistry
    expect(await companyRegistry.hasRole(ADMIN_ROLE,    deployerAddr)).to.be.true;
    expect(await companyRegistry.hasRole(REVIEWER_ROLE, deployerAddr)).to.be.true;
    expect(await companyRegistry.hasRole(ADMIN_ROLE,    attackerAddr)).to.be.false;
    expect(await companyRegistry.hasRole(REVIEWER_ROLE, attackerAddr)).to.be.false;

    // EscrowPayments
    expect(await escrowPayments.hasRole(ARBITRATOR_ROLE, deployerAddr)).to.be.true;
    expect(await escrowPayments.hasRole(ARBITRATOR_ROLE, attackerAddr)).to.be.false;

    // TradeManager
    expect(await tradeManager.hasRole(ADMIN_ROLE, deployerAddr)).to.be.true;
    expect(await tradeManager.hasRole(ADMIN_ROLE, attackerAddr)).to.be.false;

    console.log("  ✅ Role audit: deployer holds all privileged roles; attacker holds none");
  });

  it("PASS: Deployer (reviewer) can approve, suspend, and update role", async function () {
    // Approve
    await companyRegistry.approveCompany(await victim.getAddress());
    let c = await companyRegistry.getCompany(await victim.getAddress());
    expect(c.status).to.equal(1);

    // Suspend
    await companyRegistry.suspendCompany(await victim.getAddress());
    c = await companyRegistry.getCompany(await victim.getAddress());
    expect(c.status).to.equal(2);

    // Update role to SELLER
    await companyRegistry.updateCompanyRole(await victim.getAddress(), 1);
    c = await companyRegistry.getCompany(await victim.getAddress());
    expect(c.role).to.equal(1);

    console.log("✅ Deployer (REVIEWER_ROLE) can execute all privileged functions");
  });
});
