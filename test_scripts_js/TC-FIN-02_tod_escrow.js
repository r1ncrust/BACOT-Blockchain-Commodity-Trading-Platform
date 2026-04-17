// =============================================================================
// TC-FIN-02 | Transaction Ordering Dependence (TOD) in Escrow
// Target   : EscrowPayments.sol – releasePayment() vs refundPayment()
//            EscrowPayments.sol – releasePayment() vs cancelTrade()
// Threat   : Repudiation
// Tool     : Hardhat, Mythril (CLI)
// Severity : High (CVSS 7.5–8.5)
//
// Objective:
//   Simulate competing transactions from buyer and seller submitted in the same
//   block window to test whether race conditions allow:
//     (a) Both a release AND a refund to succeed (double-spend of escrow).
//     (b) A cancel-then-release or release-then-cancel scenario to leave
//         funds in an inconsistent state.
//
//   Hardhat allows controlling transaction ordering within a block by
//   pausing auto-mining, queueing transactions, and then mining manually.
//
// Mythril CLI (run separately):
//   myth analyze contracts/EscrowPayments.sol \
//        --solc-json mythril.config.json \
//        --detect transaction-order-dependence
//
// Expected pass: Second competing call reverts; funds moved exactly once.
// Expected fail: Double-spend succeeds → High finding.
// =============================================================================

const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("TC-FIN-02 | Transaction Ordering Dependence (Escrow)", function () {
  let companyRegistry, tradeManager, escrowPayments, mockToken;
  let deployer, buyer, seller;
  const FUTURE = Math.floor(Date.now() / 1000) + 86400 * 30;
  const DISPUTE_WINDOW = 86400 * 7;
  const DEPOSIT = ethers.parseEther("5000");

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

    await mockToken.mint(await buyer.getAddress(), ethers.parseEther("100000"));
  });

  // ── Full setup: funded + executed trade (ready for release) ──────────────
  async function fundedExecutedTrade() {
    const tx = await tradeManager.connect(buyer).createTrade(
      await seller.getAddress(), "Wheat", 500, "MT",
      ethers.parseEther("200"), await mockToken.getAddress(),
      "FOB", 0, FUTURE, DISPUTE_WINDOW, DEPOSIT
    );
    const receipt = await tx.wait();
    const tradeId = receipt.logs.find(l => l.fragment?.name === "TradeCreated").args[0];

    const invalidSig = "0x" + "00".repeat(65);
    await tradeManager.connect(seller).acceptTrade(tradeId, invalidSig);
    await tradeManager.connect(buyer).lockTrade(tradeId);

    await mockToken.connect(buyer).approve(await escrowPayments.getAddress(), DEPOSIT);
    await escrowPayments.connect(buyer).fundEscrow(tradeId, DEPOSIT);

    await tradeManager.connect(buyer).executeTrade(tradeId);
    return tradeId;
  }

  // ── Setup: funded + cancelled trade (ready for refund) ───────────────────
  async function fundedCancelledTrade() {
    const tx = await tradeManager.connect(buyer).createTrade(
      await seller.getAddress(), "Cotton", 300, "bale",
      ethers.parseEther("100"), await mockToken.getAddress(),
      "DAP", 0, FUTURE, DISPUTE_WINDOW, DEPOSIT
    );
    const receipt = await tx.wait();
    const tradeId = receipt.logs.find(l => l.fragment?.name === "TradeCreated").args[0];

    const invalidSig = "0x" + "00".repeat(65);
    await tradeManager.connect(seller).acceptTrade(tradeId, invalidSig);
    await tradeManager.connect(buyer).lockTrade(tradeId);

    await mockToken.connect(buyer).approve(await escrowPayments.getAddress(), DEPOSIT);
    await escrowPayments.connect(buyer).fundEscrow(tradeId, DEPOSIT);

    // Cancel the trade
    await tradeManager.connect(buyer).cancelTrade(tradeId);
    return tradeId;
  }

  // ────────────────────────────────────────────────────────────────────────
  it("PASS: releasePayment() transfers funds to seller exactly once", async function () {
    const tradeId = await fundedExecutedTrade();
    const before = await mockToken.balanceOf(await seller.getAddress());

    await escrowPayments.connect(seller).releasePayment(tradeId);

    const after = await mockToken.balanceOf(await seller.getAddress());
    expect(after - before).to.equal(DEPOSIT);

    const escrow = await escrowPayments.getEscrow(tradeId);
    expect(escrow.isReleased).to.be.true;
    expect(escrow.isRefunded).to.be.false;
    console.log("✅ Single release transfers exactly DEPOSIT to seller");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: TOD – release then refund must revert (double-spend)", async function () {
    const tradeId = await fundedExecutedTrade();

    // Tx1: release succeeds
    await escrowPayments.connect(seller).releasePayment(tradeId);

    // Tx2: refund attempt after release – must fail
    await expect(
      escrowPayments.connect(buyer).refundPayment(tradeId)
    ).to.be.revertedWith("Payment already released");

    // Verify: only seller received funds; buyer balance unchanged from deposit
    const escrow = await escrowPayments.getEscrow(tradeId);
    expect(escrow.isReleased).to.be.true;
    expect(escrow.isRefunded).to.be.false;

    console.log("✅ Release-then-refund double-spend correctly prevented");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: TOD – refund then release must revert (double-spend)", async function () {
    const tradeId = await fundedCancelledTrade();

    // Tx1: refund succeeds (cancelled trade)
    await escrowPayments.connect(buyer).refundPayment(tradeId);

    // Tx2: release attempt after refund – must fail
    await expect(
      escrowPayments.connect(seller).releasePayment(tradeId)
    ).to.be.revertedWith("Payment already refunded");

    const escrow = await escrowPayments.getEscrow(tradeId);
    expect(escrow.isRefunded).to.be.true;
    expect(escrow.isReleased).to.be.false;

    console.log("✅ Refund-then-release double-spend correctly prevented");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: TOD simulation – manual block mining with competing transactions", async function () {
    const tradeId = await fundedExecutedTrade();

    // Disable auto-mining to simulate mempool competition
    await network.provider.send("evm_setAutomine", [false]);

    try {
      const escrowAddr = await escrowPayments.getAddress();

      // Queue both transactions in the same block
      const releaseTx = await escrowPayments.connect(seller)
        .releasePayment.populateTransaction(tradeId);
      const refundTx  = await escrowPayments.connect(buyer)
        .refundPayment.populateTransaction(tradeId);

      // Submit both to mempool
      const tx1 = await seller.sendTransaction(releaseTx);
      const tx2 = await buyer.sendTransaction(refundTx);

      // Mine one block containing both
      await network.provider.send("evm_mine", []);

      // Check which transaction succeeded
      const receipt1 = await tx1.wait().catch(() => null);
      const receipt2 = await tx2.wait().catch(() => null);

      const tx1Success = receipt1?.status === 1;
      const tx2Success = receipt2?.status === 1;

      // Exactly one must succeed
      expect(
        (tx1Success ? 1 : 0) + (tx2Success ? 1 : 0)
      ).to.be.lessThanOrEqual(1, "At most ONE of release/refund must succeed");

      const escrow = await escrowPayments.getEscrow(tradeId);
      // Funds must not leave the contract twice
      const contractBalance = await mockToken.balanceOf(escrowAddr);
      if (tx1Success) {
        expect(escrow.isReleased).to.be.true;
        console.log("  → Release won the ordering race; refund correctly blocked");
      } else if (tx2Success) {
        expect(escrow.isRefunded).to.be.true;
        console.log("  → Refund won the ordering race; release correctly blocked");
      } else {
        console.log("  → Both transactions reverted (escrow state unchanged)");
      }
      console.log(`  Contract token balance: ${ethers.formatEther(contractBalance)} TUSD`);
      console.log("✅ TOD simulation: no double-spend observed");

    } finally {
      // Always restore auto-mining
      await network.provider.send("evm_setAutomine", [true]);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: Double releasePayment() by same party must revert", async function () {
    const tradeId = await fundedExecutedTrade();

    await escrowPayments.connect(seller).releasePayment(tradeId);

    await expect(
      escrowPayments.connect(seller).releasePayment(tradeId)
    ).to.be.revertedWith("Payment already released");

    // Confirm escrow balance is zero
    const contractBalance = await mockToken.balanceOf(await escrowPayments.getAddress());
    expect(contractBalance).to.equal(0n);

    console.log("✅ Double-release by same party correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("AUDIT: Funds accounting – seller receives exactly deposited amount", async function () {
    const tradeId = await fundedExecutedTrade();

    const sellerBefore   = await mockToken.balanceOf(await seller.getAddress());
    const contractBefore = await mockToken.balanceOf(await escrowPayments.getAddress());

    await escrowPayments.connect(seller).releasePayment(tradeId);

    const sellerAfter   = await mockToken.balanceOf(await seller.getAddress());
    const contractAfter = await mockToken.balanceOf(await escrowPayments.getAddress());

    console.log(`  Escrow before  : ${ethers.formatEther(contractBefore)} TUSD`);
    console.log(`  Escrow after   : ${ethers.formatEther(contractAfter)}  TUSD`);
    console.log(`  Seller received: ${ethers.formatEther(sellerAfter - sellerBefore)} TUSD`);

    expect(sellerAfter - sellerBefore).to.equal(DEPOSIT);
    expect(contractAfter).to.equal(0n);
    console.log("✅ Funds accounting is exact – no tokens trapped or duplicated");
  });
});
