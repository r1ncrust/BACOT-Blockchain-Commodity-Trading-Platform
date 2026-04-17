const { run } = require("hardhat");

async function verifyContracts() {
  try {
    // Verify CompanyRegistry
    await run("verify:verify", {
      address: "CONTRACT_ADDRESS_HERE",
      constructorArguments: [],
    });

    // Verify TradeManager
    await run("verify:verify", {
      address: "CONTRACT_ADDRESS_HERE",
      constructorArguments: ["COMPANY_REGISTRY_ADDRESS"],
    });

    // Verify ShipmentTracker
    await run("verify:verify", {
      address: "CONTRACT_ADDRESS_HERE",
      constructorArguments: [],
    });

    // Verify EscrowPayments
    await run("verify:verify", {
      address: "CONTRACT_ADDRESS_HERE",
      constructorArguments: ["TRADE_MANAGER_ADDRESS"],
    });

    // Verify MockToken
    await run("verify:verify", {
      address: "CONTRACT_ADDRESS_HERE",
      constructorArguments: ["Test USD", "tUSD", 18],
    });

    console.log("All contracts verified successfully!");
  } catch (error) {
    console.error("Verification failed:", error);
  }
}

verifyContracts();
