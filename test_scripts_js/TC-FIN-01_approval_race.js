// =============================================================================
// TC-FIN-01 | ERC-20 Approval Race Condition / Double-Spend
// Target   : EscrowPayments.sol – fundEscrow() (uses transferFrom)
//            MockERC20.sol – approve() / transferFrom()
// Threat   : Repudiation
// Tool     : Hardhat
// Severity : High (CVSS 7.5–8.5)
//
// Objective:
//   Verify that the ERC-20 token approval mechanism cannot be exploited via
//   the classic front-running approval race:
//     1. Buyer approves escrow for allowance A.
//     2. Buyer submits a new approve() to change allowance to B.
//     3. An attacker (or a malicious escrow call) attempts to drain BOTH A and B
//        by front-running the second approval.
//
//   Also tests:
//     - Over-allowance: approve more than available balance → transferFrom must
//       respect the actual balance.
//     - Zero-amount fund attempt must revert.
//     - Double-fund (two fundEscrow calls for same trade) must accumulate, not
//       create a second escrow entry.
//
// Expected pass: Race condition does not yield a double-spend; contracts
//                respect the most recent allowance.
// Expected fail: Funds extracted above approval or balance → High finding.
// =============================================================================

const { expect } = require("chai");
const { ethers }  = require("hardhat");

describe("TC-FIN-01 | ERC-20 Approval Race Condition", function () {
  let companyRegistry, tradeManager, escrowPayments, mockToken;
  let deployer, buyer, seller;
  const FUTURE = Math.floor(Date.now() / 1000) + 86400 * 30;
  const DISPUTE_WINDOW = 86400 * 7;

  beforeEach(async function () {
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

    const Escrow = await ethers.getContractFactory("EscrowPayments");
    escrowPayments = await Escrow.deploy(await tradeManager.getAddress());
    await escrowPayments.waitForDeployment();

    await companyRegistry.connect(buyer).registerCompany(
      "Buyer Corp", "B-001", "NZ", "buyer@test.com", 0
    );
    await companyRegistry.connect(seller).registerCompany(
      "Seller Corp", "S-001", "AU", "seller@test.com", 1
    );
    await companyRegistry.approveCompany(await buyer.getAddress());
    await companyRegistry.approveCompany(await seller.getAddress());

    // Mint 10 000 tokens to buyer
    await mockToken.mint(await buyer.getAddress(), ethers.parseEther("10000"));
  });

  // ── Helper: create a LOCKED trade ────────────────────────────────────────
  async function lockedTrade(depositAmount) {
    const deposit = depositAmount ?? ethers.parseEther("5000");
    const tx = await tradeManager.connect(buyer).createTrade(
      await seller.getAddress(),
      "Gold", 100, "oz", ethers.parseEther("50"),
      await mockToken.getAddress(), "EXW",
      0, FUTURE, DISPUTE_WINDOW, deposit
    );
    const receipt = await tx.wait();
    const tradeId = receipt.logs.find(l => l.fragment?.name === "TradeCreated").args[0];

    const invalidSig = "0x" + "00".repeat(65);
    await tradeManager.connect(seller).acceptTrade(tradeId, invalidSig);
    await tradeManager.connect(buyer).lockTrade(tradeId);
    return tradeId;
  }

  // ────────────────────────────────────────────────────────────────────────
  it("PASS: Normal approve + fundEscrow transfers exact approved amount", async function () {
    const tradeId = await lockedTrade();
    const amount  = ethers.parseEther("5000");

    await mockToken.connect(buyer).approve(await escrowPayments.getAddress(), amount);
    await escrowPayments.connect(buyer).fundEscrow(tradeId, amount);

    const escrow = await escrowPayments.getEscrow(tradeId);
    expect(escrow.totalAmount).to.equal(amount);
    console.log("✅ Normal fund-escrow transfers correct amount");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: Approval race – second fundEscrow cannot exceed total approved", async function () {
    const tradeId = await lockedTrade();
    const initialApproval = ethers.parseEther("3000");
    const newApproval     = ethers.parseEther("2000");

    // Step 1: Approve 3000
    await mockToken.connect(buyer).approve(await escrowPayments.getAddress(), initialApproval);

    // Step 2: Change approval to 2000 (simulating the race window)
    await mockToken.connect(buyer).approve(await escrowPayments.getAddress(), newApproval);

    // Step 3: Escrow call – only the current allowance (2000) is available
    const currentAllowance = await mockToken.allowance(
      await buyer.getAddress(), await escrowPayments.getAddress()
    );
    expect(currentAllowance).to.equal(newApproval, "Allowance should be the latest value");

    // Attempting to fund with the OLD approval amount must revert (insufficient allowance)
    await expect(
      escrowPayments.connect(buyer).fundEscrow(tradeId, initialApproval)
    ).to.be.reverted;

    console.log("✅ Race condition: old allowance not exploitable after re-approval");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: fundEscrow with zero amount must revert", async function () {
    const tradeId = await lockedTrade();
    await mockToken.connect(buyer).approve(await escrowPayments.getAddress(), ethers.parseEther("5000"));

    await expect(
      escrowPayments.connect(buyer).fundEscrow(tradeId, 0)
    ).to.be.revertedWith("Amount must be positive");
    console.log("✅ Zero-amount fund correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: fundEscrow without any approval must revert", async function () {
    const tradeId = await lockedTrade();

    // No approve() call
    await expect(
      escrowPayments.connect(buyer).fundEscrow(tradeId, ethers.parseEther("1000"))
    ).to.be.reverted; // transferFrom fails

    console.log("✅ Fund without approval correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: fundEscrow exceeding buyer balance must revert", async function () {
    const tradeId = await lockedTrade();
    const overAmount = ethers.parseEther("99999"); // more than minted (10000)

    await mockToken.connect(buyer).approve(await escrowPayments.getAddress(), overAmount);

    await expect(
      escrowPayments.connect(buyer).fundEscrow(tradeId, overAmount)
    ).to.be.reverted; // ERC-20 balance check

    console.log("✅ Over-balance fund correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: Seller (non-buyer) cannot fund escrow", async function () {
    const tradeId = await lockedTrade();
    await mockToken.mint(await seller.getAddress(), ethers.parseEther("5000"));
    await mockToken.connect(seller).approve(await escrowPayments.getAddress(), ethers.parseEther("5000"));

    await expect(
      escrowPayments.connect(seller).fundEscrow(tradeId, ethers.parseEther("5000"))
    ).to.be.revertedWith("Only buyer can fund escrow");
    console.log("✅ Non-buyer fund attempt correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: Two fundEscrow calls accumulate, not create double-escrow entry", async function () {
    const tradeId = await lockedTrade();
    const first  = ethers.parseEther("2000");
    const second = ethers.parseEther("1000");

    await mockToken.connect(buyer).approve(await escrowPayments.getAddress(), first + second);

    await escrowPayments.connect(buyer).fundEscrow(tradeId, first);
    await escrowPayments.connect(buyer).fundEscrow(tradeId, second);

    const escrow = await escrowPayments.getEscrow(tradeId);
    expect(escrow.totalAmount).to.equal(first + second);
    expect(escrow.tradeId).to.equal(tradeId); // single entry, not duplicated

    console.log("✅ Double fund-escrow accumulates correctly in single entry");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("AUDIT: Allowance state before/after approve sequence", async function () {
    const escrowAddr = await escrowPayments.getAddress();
    const buyerAddr  = await buyer.getAddress();

    await mockToken.connect(buyer).approve(escrowAddr, ethers.parseEther("3000"));
    const allowance1 = await mockToken.allowance(buyerAddr, escrowAddr);
    expect(allowance1).to.equal(ethers.parseEther("3000"));

    await mockToken.connect(buyer).approve(escrowAddr, ethers.parseEther("2000"));
    const allowance2 = await mockToken.allowance(buyerAddr, escrowAddr);
    expect(allowance2).to.equal(ethers.parseEther("2000"));

    console.log(`  Allowance after first approve  : ${ethers.formatEther(allowance1)} TUSD`);
    console.log(`  Allowance after second approve : ${ethers.formatEther(allowance2)} TUSD`);
    console.log("  ✅ allowance reflects most recent approve() call");
  });
});
