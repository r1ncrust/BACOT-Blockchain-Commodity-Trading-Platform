require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
require("ts-node/register");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  paths: {
    tests: "./test_scripts_js",
  },
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    sepolia: {
      url: process.env.SEPOLIA_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 11155111
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
    gasPrice: 21
  },
  typechain: {
    outDir: "./typechain-types",
    target: "ethers-v6"
  }
};
