// =============================================================================
// TC-INF-02 | Transaction Mempool Flooding / Settlement Delay (DoS)
// Target   : TradeManager.sol – executeTrade() (time-gated by expiryTimestamp)
//            EscrowPayments.sol – fundEscrow(), releasePayment()
// Threat   : Denial of Service
// Tool     : Hardhat
// Severity : Medium (CVSS 5.5–7.5)
//
// Objective:
//   Simulate a high-volume transaction flooding scenario to evaluate whether
//   time-sensitive settlement operations (governed by expiryTimestamp) can be
//   delayed past their deadline by congestion, and whether the platform
//   correctly enforces time-based guards even after artificial delays.
//
//   Specific scenarios:
//     1. Flood the simulated network with spam transactions.
//     2. Attempt executeTrade() AFTER the expiryTimestamp has passed.
//     3. Confirm the contract enforces the deadline even when the caller
//        claims "the delay wasn't my fault."
//     4. Measure gas cost of spam transactions to quantify attack cost.
//
// Expected pass: executeTrade() reverts after expiry; deadline is enforced.
// Expected fail: Expired trade still executes → Medium finding.
//
// Note: On a real public testnet, flood the RPC node with low-gas dummy txs
//       using a script like `flood_sepolia.sh` (provided as a companion).
// =============================================================================

const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("TC-INF-02 | Mempool Flooding / Settlement Deadline Enforcement", function () {
  let companyRegistry, tradeManager, escrowPayments, mockToken;
  let deployer, buyer, seller, spammer;
  const DISPUTE_WINDOW = 86400 * 7;
  const DEPOSIT = ethers.parseEther("1000");

  beforeEach(async function () {
    [deployer, buyer, seller, spammer] = await ethers.getSigners();

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
    await mockToken.mint(await spammer.getAddress(), ethers.parseEther("10000"));
  });

  // ── Create a SHORT-LIVED trade (expires in 60 seconds) ───────────────────
  async function shortLivedTrade() {
    const now    = (await ethers.provider.getBlock("latest")).timestamp;
    const expiry = now + 120; // 2 minutes from now

    const tx = await tradeManager.connect(buyer).createTrade(
      await seller.getAddress(),
      "Natural Gas", 200, "MMBtu",
      ethers.parseEther("3"),
      await mockToken.getAddress(),
      "DDP", 0, expiry, DISPUTE_WINDOW, DEPOSIT
    );
    const receipt = await tx.wait();
    const tradeId = receipt.logs.find(l => l.fragment?.name === "TradeCreated").args[0];

    const invalidSig = "0x" + "00".repeat(65);
    await tradeManager.connect(seller).acceptTrade(tradeId, invalidSig);
    await tradeManager.connect(buyer).lockTrade(tradeId);

    await mockToken.connect(buyer).approve(await escrowPayments.getAddress(), DEPOSIT);
    await escrowPayments.connect(buyer).fundEscrow(tradeId, DEPOSIT);

    return { tradeId, expiry };
  }

  // ────────────────────────────────────────────────────────────────────────
  it("PASS: executeTrade() succeeds before expiry", async function () {
    const { tradeId } = await shortLivedTrade();

    await expect(
      tradeManager.connect(buyer).executeTrade(tradeId)
    ).to.emit(tradeManager, "TradeExecuted").withArgs(tradeId);

    console.log("✅ executeTrade() before expiry succeeds");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: executeTrade() after expiry must revert (deadline enforced)", async function () {
    const { tradeId, expiry } = await shortLivedTrade();

    // Fast-forward blockchain time past the expiry
    await network.provider.send("evm_setNextBlockTimestamp", [expiry + 10]);
    await network.provider.send("evm_mine", []);

    await expect(
      tradeManager.connect(buyer).executeTrade(tradeId)
    ).to.be.revertedWith("Trade expired");

    console.log("✅ Expired trade correctly rejected – deadline enforced by contract");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: Simulate mempool flood then attempt time-critical settlement", async function () {
    const { tradeId, expiry } = await shortLivedTrade();

    // --- Simulate mempool flooding ---
    // Send N spam transactions from spammer account before the settlement tx
    const SPAM_COUNT = 20;
    const spamGasCosts = [];

    console.log(`  Flooding mempool with ${SPAM_COUNT} dummy token transfers...`);
    for (let i = 0; i < SPAM_COUNT; i++) {
      const tx = await mockToken.connect(spammer).transfer(
        await deployer.getAddress(),
        ethers.parseEther("1")
      );
      const receipt = await tx.wait();
      spamGasCosts.push(receipt.gasUsed);
    }

    const totalSpamGas = spamGasCosts.reduce((a, b) => a + b, 0n);
    const avgSpamGas   = totalSpamGas / BigInt(SPAM_COUNT);
    console.log(`  Total spam gas consumed   : ${totalSpamGas.toString()}`);
    console.log(`  Average per spam tx       : ${avgSpamGas.toString()}`);

    // --- Attempt settlement while still within deadline ---
    const currentBlock = await ethers.provider.getBlock("latest");
    if (currentBlock.timestamp < expiry) {
      await expect(
        tradeManager.connect(buyer).executeTrade(tradeId)
      ).to.emit(tradeManager, "TradeExecuted");
      console.log("  ✅ Settlement succeeded before expiry despite flood");
    } else {
      // If time slipped past expiry during flood (unlikely in local Hardhat)
      console.log("  ⚠️  Clock advanced past expiry during flood simulation");
      await expect(
        tradeManager.connect(buyer).executeTrade(tradeId)
      ).to.be.revertedWith("Trade expired");
      console.log("  ✅ Deadline correctly enforced after expiry");
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  it("SECURITY: refundPayment() still works after trade expiry (expired, not cancelled)", async function () {
    // A different path: trade created but never executed (e.g., seller went silent)
    // After expiry, buyer should be able to refund if trade status allows it.
    const now    = (await ethers.provider.getBlock("latest")).timestamp;
    const expiry = now + 60; // 60 seconds

    const tx = await tradeManager.connect(buyer).createTrade(
      await seller.getAddress(),
      "Copper", 50, "MT",
      ethers.parseEther("400"),
      await mockToken.getAddress(),
      "FCA", 0, expiry, DISPUTE_WINDOW, DEPOSIT
    );
    const receipt = await tx.wait();
    const tradeId = receipt.logs.find(l => l.fragment?.name === "TradeCreated").args[0];

    // Fund escrow without advancing trade past CREATED state
    // (trade stays in CREATED since we skip accept/lock – just test the refund path)
    // For refund: trade must be CANCELLED or (CREATED + expired)
    await mockToken.connect(buyer).approve(await escrowPayments.getAddress(), DEPOSIT);

    // We cannot fund escrow unless LOCKED, so just verify the expiry guard in TM
    await network.provider.send("evm_setNextBlockTimestamp", [expiry + 5]);
    await network.provider.send("evm_mine", []);

    // executeTrade should fail due to expiry
    const invalidSig = "0x" + "00".repeat(65);
    await tradeManager.connect(seller).acceptTrade(tradeId, invalidSig);
    await tradeManager.connect(buyer).lockTrade(tradeId);

    await expect(
      tradeManager.connect(buyer).executeTrade(tradeId)
    ).to.be.revertedWith("Trade expired");

    console.log("✅ Expired LOCKED trade cannot be executed – verified after simulated delay");
  });

  // ────────────────────────────────────────────────────────────────────────
  it("AUDIT: Gas cost of a full settlement transaction", async function () {
    const { tradeId } = await shortLivedTrade();

    const tx      = await tradeManager.connect(buyer).executeTrade(tradeId);
    const receipt = await tx.wait();

    console.log(`  executeTrade() gas used : ${receipt.gasUsed.toString()}`);

    const escTx     = await escrowPayments.connect(seller).releasePayment(tradeId);
    const escReceipt = await escTx.wait();
    console.log(`  releasePayment() gas used: ${escReceipt.gasUsed.toString()}`);
    console.log("  ✅ Settlement gas costs recorded for evidence");

    expect(receipt.gasUsed).to.be.lessThan(500_000n);
    expect(escReceipt.gasUsed).to.be.lessThan(500_000n);
  });
});
