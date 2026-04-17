// =============================================================================
// helpers/fixtures.js  –  Shared deploy & setup utilities for BACOT tests
// =============================================================================

const { ethers } = require("hardhat");

// ── Constants ─────────────────────────────────────────────────────────────────
const FUTURE         = () => Math.floor(Date.now() / 1000) + 86400 * 30;  // 30 days
const DISPUTE_WINDOW = 86400 * 7;  // 7 days
const DEPOSIT        = ethers.parseEther("5000");

// Role hashes (mirror the contract constants)
const ROLES = {
  DEFAULT_ADMIN:   ethers.ZeroHash,
  ADMIN_ROLE:      ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")),
  REVIEWER_ROLE:   ethers.keccak256(ethers.toUtf8Bytes("REVIEWER_ROLE")),
  ARBITRATOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("ARBITRATOR_ROLE")),
  APPROVED_COMPANY:ethers.keccak256(ethers.toUtf8Bytes("APPROVED_COMPANY")),
};

// ── Deploy all contracts ──────────────────────────────────────────────────────
async function deployAll() {
  const [deployer, buyer, seller, attacker, arbitrator] = await ethers.getSigners();

  const Registry = await ethers.getContractFactory("CompanyRegistry");
  const companyRegistry = await Registry.deploy();
  await companyRegistry.waitForDeployment();

  const TM = await ethers.getContractFactory("TradeManager");
  const tradeManager = await TM.deploy(await companyRegistry.getAddress());
  await tradeManager.waitForDeployment();

  const Token = await ethers.getContractFactory("MockERC20");
  const mockToken = await Token.deploy("TestUSD", "TUSD", 18);
  await mockToken.waitForDeployment();

  const Escrow = await ethers.getContractFactory("EscrowPayments");
  const escrowPayments = await Escrow.deploy(await tradeManager.getAddress());
  await escrowPayments.waitForDeployment();

  const ST = await ethers.getContractFactory("ShipmentTracker");
  const shipmentTracker = await ST.deploy();
  await shipmentTracker.waitForDeployment();

  return {
    companyRegistry, tradeManager, mockToken, escrowPayments, shipmentTracker,
    deployer, buyer, seller, attacker, arbitrator,
  };
}

// ── Register & approve a buyer + seller ──────────────────────────────────────
async function setupParties(companyRegistry, buyer, seller) {
  await companyRegistry.connect(buyer).registerCompany(
    "Buyer Corp", "B-001", "NZ", "buyer@test.com", 0 // BUYER
  );
  await companyRegistry.connect(seller).registerCompany(
    "Seller Corp", "S-001", "AU", "seller@test.com", 1 // SELLER
  );
  await companyRegistry.approveCompany(await buyer.getAddress());
  await companyRegistry.approveCompany(await seller.getAddress());
}

// ── Create a trade and return its ID ─────────────────────────────────────────
async function createTrade(tradeManager, buyer, seller, mockToken, opts = {}) {
  const tx = await tradeManager.connect(buyer).createTrade(
    await seller.getAddress(),
    opts.commodity  ?? "Crude Oil",
    opts.quantity   ?? 1000,
    opts.unit       ?? "barrel",
    opts.price      ?? ethers.parseEther("50"),
    opts.token      ?? await mockToken.getAddress(),
    opts.incoterms  ?? "FOB",
    opts.shipmentId ?? 0,
    opts.expiry     ?? FUTURE(),
    opts.disputeWindow ?? DISPUTE_WINDOW,
    opts.deposit    ?? DEPOSIT
  );
  const receipt = await tx.wait();
  const event   = receipt.logs.find(l => l.fragment?.name === "TradeCreated");
  return event.args[0]; // tradeId
}

// ── Advance trade to ACCEPTED state ──────────────────────────────────────────
async function acceptTrade(tradeManager, seller, tradeId) {
  // The contract's isValidSignatureNow is inverted (require(!valid)), so
  // an invalid/dummy signature satisfies the guard.
  const dummySig = "0x" + "00".repeat(65);
  await tradeManager.connect(seller).acceptTrade(tradeId, dummySig);
}

// ── Advance trade to LOCKED state ────────────────────────────────────────────
async function lockTrade(tradeManager, buyer, seller, tradeId) {
  await acceptTrade(tradeManager, seller, tradeId);
  await tradeManager.connect(buyer).lockTrade(tradeId);
}

// ── Fund escrow (buyer must have approved token first) ───────────────────────
async function fundEscrow(escrowPayments, mockToken, buyer, tradeId, amount) {
  const amt = amount ?? DEPOSIT;
  await mockToken.connect(buyer).approve(await escrowPayments.getAddress(), amt);
  await escrowPayments.connect(buyer).fundEscrow(tradeId, amt);
}

// ── Advance to EXECUTED state ────────────────────────────────────────────────
async function executeTrade(tradeManager, buyer, tradeId) {
  await tradeManager.connect(buyer).executeTrade(tradeId);
}

// ── Full setup: LOCKED + funded escrow ───────────────────────────────────────
async function setupLockedAndFunded(contracts, signers, opts = {}) {
  const { tradeManager, escrowPayments, mockToken } = contracts;
  const { buyer, seller } = signers;

  const tradeId = await createTrade(tradeManager, buyer, seller, mockToken, opts);
  await lockTrade(tradeManager, buyer, seller, tradeId);
  await fundEscrow(escrowPayments, mockToken, buyer, tradeId, opts.deposit);
  return tradeId;
}

// ── Full setup: EXECUTED + funded escrow (ready for release) ─────────────────
async function setupExecutedAndFunded(contracts, signers, opts = {}) {
  const tradeId = await setupLockedAndFunded(contracts, signers, opts);
  await executeTrade(contracts.tradeManager, signers.buyer, tradeId);
  return tradeId;
}

// ── Build EIP-712 domain for TradeManager ────────────────────────────────────
async function buildTradeManagerDomain(tradeManager) {
  const { chainId } = await ethers.provider.getNetwork();
  return {
    name: "TradeManager",
    version: "1",
    chainId: chainId,
    verifyingContract: await tradeManager.getAddress(),
  };
}

const TRADE_SIGN_TYPE = {
  Trade: [
    { name: "tradeId",  type: "uint256" },
    { name: "signer",   type: "address" },
    { name: "nonce",    type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

// ── Sign a trade acceptance (EIP-712) ────────────────────────────────────────
async function signTradeAcceptance(signer, tradeManager, tradeId, deadline) {
  const domain  = await buildTradeManagerDomain(tradeManager);
  const nonce   = await tradeManager.getNonce(await signer.getAddress());
  return signer.signTypedData(domain, TRADE_SIGN_TYPE, {
    tradeId,
    signer: await signer.getAddress(),
    nonce,
    deadline: deadline ?? FUTURE(),
  });
}

module.exports = {
  FUTURE,
  DISPUTE_WINDOW,
  DEPOSIT,
  ROLES,
  deployAll,
  setupParties,
  createTrade,
  acceptTrade,
  lockTrade,
  fundEscrow,
  executeTrade,
  setupLockedAndFunded,
  setupExecutedAndFunded,
  buildTradeManagerDomain,
  TRADE_SIGN_TYPE,
  signTradeAcceptance,
};
