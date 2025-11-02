require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-waffle");
require("dotenv").config(); // Load .env variables

module.exports = {
  solidity: "0.8.4",
  networks: {
    moonbase: {
      url: "https://rpc.testnet.moonbeam.network",
      accounts: [
        process.env.MOONBASE_PRIVATE_KEY_0,
        process.env.MOONBASE_PRIVATE_KEY_1,
      ],
      chainId: 1287,
    },
  },
};
