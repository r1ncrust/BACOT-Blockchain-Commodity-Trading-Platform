import { ethers } from "hardhat";

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

  console.log("Contracts deployed and configured successfully!");
  console.log("\nContract Addresses:");
  console.log(`CompanyRegistry: ${await companyRegistry.getAddress()}`);
  console.log(`TradeManager: ${await tradeManager.getAddress()}`);
  console.log(`ShipmentTracker: ${await shipmentTracker.getAddress()}`);
  console.log(`EscrowPayments: ${await escrowPayments.getAddress()}`);
  console.log(`MockToken: ${await mockToken.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});