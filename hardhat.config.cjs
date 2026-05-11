const dotenv = require("dotenv");
dotenv.config();

require("@nomicfoundation/hardhat-toolbox");
require("@nomicfoundation/hardhat-ethers");
require("hardhat-gas-reporter");
require("solidity-coverage");

function privateKeyFromEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  return value.startsWith("0x") ? value : `0x${value}`;
}

function accountsFromEnv(...names) {
  return names.map(privateKeyFromEnv).filter(Boolean);
}

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1,
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
      accounts: accountsFromEnv(
        "PRIVATE_KEY",
        "DEPLOYER_PRIVATE_KEY",
        "MOONBASE_PRIVATE_KEY_0",
        "MOONBASE_PRIVATE_KEY_1"
      ),
      chainId: 1287,
    },
    arc: {
      url: process.env.ARC_RPC || process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network",
      accounts: accountsFromEnv(
        "PRIVATE_KEY",
        "DEPLOYER_PRIVATE_KEY",
        "ARC_PRIVATE_KEY_0",
        "ARC_PRIVATE_KEY_1",
        "MOONBASE_PRIVATE_KEY_0",
        "MOONBASE_PRIVATE_KEY_1"
      ),
      chainId: 5042002,
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
