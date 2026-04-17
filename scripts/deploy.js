const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("Deploying contracts...");

  // Deploy Company Registry
  const CompanyRegistry = await ethers.getContractFactory("CompanyRegistry");
  const companyRegistry = await CompanyRegistry.deploy();
  await companyRegistry.waitForDeployment();
  console.log(`CompanyRegistry deployed to: ${await companyRegistry.getAddress()}`);

  // Deploy Trade Manager
  const TradeManager = await ethers.getContractFactory("TradeManager");
  const tradeManager = await TradeManager.deploy(await companyRegistry.getAddress());
  await tradeManager.waitForDeployment();
  console.log(`TradeManager deployed to: ${await tradeManager.getAddress()}`);

  // Deploy Shipment Tracker
  const ShipmentTracker = await ethers.getContractFactory("ShipmentTracker");
  const shipmentTracker = await ShipmentTracker.deploy();
  await shipmentTracker.waitForDeployment();
  console.log(`ShipmentTracker deployed to: ${await shipmentTracker.getAddress()}`);

  // Deploy Escrow Payments
  const EscrowPayments = await ethers.getContractFactory("EscrowPayments");
  const escrowPayments = await EscrowPayments.deploy(await tradeManager.getAddress());
  await escrowPayments.waitForDeployment();
  console.log(`EscrowPayments deployed to: ${await escrowPayments.getAddress()}`);

  // Deploy Mock Token
  const MockToken = await ethers.getContractFactory("MockERC20");
  const mockToken = await MockToken.deploy("Test USD", "tUSD", 18);
  await mockToken.waitForDeployment();
  console.log(`MockToken deployed to: ${await mockToken.getAddress()}`);

  // Grant roles to addresses for testing
  const [deployer] = await ethers.getSigners();

  // Grant admin roles
  await companyRegistry.grantRole(
    ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")),
    deployer.address
  );

  await companyRegistry.grantRole(
    ethers.keccak256(ethers.toUtf8Bytes("REVIEWER_ROLE")),
    deployer.address
  );

  await shipmentTracker.grantRole(
    ethers.keccak256(ethers.toUtf8Bytes("APPROVED_COMPANY")),
    deployer.address
  );

  await shipmentTracker.grantRole(
    ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")),
    deployer.address
  );

  await escrowPayments.grantRole(
    ethers.keccak256(ethers.toUtf8Bytes("ARBITRATOR_ROLE")),
    deployer.address
  );

  // ── Mint MockToken (tUSD) to test accounts & pre-approve EscrowPayments ──
  const signers = await ethers.getSigners();
  const escrowAddress = await escrowPayments.getAddress();
  const mintAmount = ethers.parseUnits("10000", 18); // 10,000 tUSD per account
  const approveAmount = ethers.parseUnits("1000000", 18); // Large approval

  console.log("\n--- Setting up MockToken for testing ---");
  for (let i = 0; i < Math.min(signers.length, 5); i++) {
    const signer = signers[i];

    // Mint tokens to each account
    await mockToken.mint(signer.address, mintAmount);
    console.log(`Minted 10,000 tUSD to Account #${i}: ${signer.address}`);

    // Pre-approve EscrowPayments to spend tokens on behalf of each account
    const tokenAsSigner = mockToken.connect(signer);
    await tokenAsSigner.approve(escrowAddress, approveAmount);
    console.log(`  → Approved EscrowPayments to spend tUSD for Account #${i}`);
  }
  console.log("--- MockToken setup complete ---\n");

  console.log("Contracts deployed and configured successfully!");
  console.log("\nContract Addresses:");
  console.log(`CompanyRegistry: ${await companyRegistry.getAddress()}`);
  console.log(`TradeManager: ${await tradeManager.getAddress()}`);
  console.log(`ShipmentTracker: ${await shipmentTracker.getAddress()}`);
  console.log(`EscrowPayments: ${await escrowPayments.getAddress()}`);
  console.log(`MockToken: ${await mockToken.getAddress()}`);

  updateFrontendConfig({
    COMPANY_REGISTRY: await companyRegistry.getAddress(),
    TRADE_MANAGER: await tradeManager.getAddress(),
    SHIPMENT_TRACKER: await shipmentTracker.getAddress(),
    ESCROW_PAYMENTS: await escrowPayments.getAddress(),
    MOCK_TOKEN: await mockToken.getAddress()
  });
}

function updateFrontendConfig(newAddresses) {
  const configPath = path.join(__dirname, "../frontend/src/contract-addresses.json");

  let addresses = {};
  if (fs.existsSync(configPath)) {
    addresses = JSON.parse(fs.readFileSync(configPath, "utf8"));
  }

  addresses = { ...addresses, ...newAddresses };
  fs.writeFileSync(configPath, JSON.stringify(addresses, null, 2));

  const tsPath = path.join(__dirname, "../frontend/src/contract-addresses.ts");
  const tsContent = `export const CONTRACT_ADDRESSES = ${JSON.stringify(addresses, null, 2)};\n`;
  fs.writeFileSync(tsPath, tsContent);
  console.log("Frontend contract-addresses updated!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
