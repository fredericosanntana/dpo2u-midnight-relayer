require("dotenv/config");
require("@nomicfoundation/hardhat-toolbox");

/** @type {import("hardhat/config").HardhatUserConfig} */
const config = {
  solidity: "0.8.20",
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hederaTestnet: {
      url: process.env.HEDERA_RPC || "https://testnet.hashio.io/api",
      chainId: 296,
      accounts: process.env.RELAYER_PRIVATE_KEY ? [process.env.RELAYER_PRIVATE_KEY] : [],
    },
  },
};

module.exports = config;
