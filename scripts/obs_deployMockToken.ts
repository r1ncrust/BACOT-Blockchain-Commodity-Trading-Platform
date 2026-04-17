import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("Deploying MockToken...");

  // Deploy Mock Token
  const MockToken = await ethers.getContractFactory("MockERC20");
  const mockToken = await MockToken.deploy("Test USD", "tUSD", 18);
  await mockToken.waitForDeployment();
  const mockTokenAddress = await mockToken.getAddress();
  console.log(`MockToken deployed to: ${mockTokenAddress}`);

  // Fetch EscrowPayments address from existing config if available
  const configPath = path.join(__dirname, "../frontend/src/contract-addresses.json");
  let escrowAddress = "";
  if (fs.existsSync(configPath)) {
    const addresses = JSON.parse(fs.readFileSync(configPath, "utf8"));
    escrowAddress = addresses.ESCROW_PAYMENTS || "";
  }

  // ── Mint MockToken (tUSD) to test accounts & pre-approve EscrowPayments ──
  const signers = await ethers.getSigners();
  const mintAmount = ethers.parseUnits("10000", 18); // 10,000 tUSD per account
  const approveAmount = ethers.parseUnits("1000000", 18); // Large approval

  console.log("\n--- Setting up MockToken for testing ---");
  for (let i = 0; i < Math.min(signers.length, 5); i++) {
    const signer = signers[i];

    // Mint tokens to each account
    await mockToken.mint(signer.address, mintAmount);
    console.log(`Minted 10,000 tUSD to Account #${i}: ${signer.address}`);

    // Pre-approve EscrowPayments to spend tokens on behalf of each account if EscrowPayments is deployed
    if (escrowAddress) {
      const tokenAsSigner = mockToken.connect(signer);
      await tokenAsSigner.approve(escrowAddress, approveAmount);
      console.log(`  → Approved EscrowPayments to spend tUSD for Account #${i}`);
    } else {
      console.log(`  → Skipping approval because EscrowPayments address was not found in config`);
    }
  }
  console.log("--- MockToken setup complete ---\n");

  updateFrontendConfig({ MOCK_TOKEN: mockTokenAddress });
}

function updateFrontendConfig(newAddresses: any) {
  const configPath = path.join(__dirname, "../frontend/src/contract-addresses.json");

  let addresses: any = {};
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
