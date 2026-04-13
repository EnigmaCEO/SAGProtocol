const dotenv = require("dotenv");
dotenv.config();

require("@nomicfoundation/hardhat-toolbox");
require("@nomicfoundation/hardhat-ethers");
require("hardhat-gas-reporter");
require("solidity-coverage");

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 1337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 1337,
    },
    moonbase: {
      url: process.env.MOONBASE_RPC || process.env.MOONBASE_RPC_URL || "https://rpc.api.moonbase.moonbeam.network",
      // Accept either PRIVATE_KEY (generic) or MOONBASE_PRIVATE_KEY_0 (project-specific)
      accounts: (process.env.PRIVATE_KEY || process.env.MOONBASE_PRIVATE_KEY_0)
        ? [process.env.PRIVATE_KEY || process.env.MOONBASE_PRIVATE_KEY_0]
        : [],
      chainId: 1287,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
