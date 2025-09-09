require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
      },
      viaIR: true,
      metadata: {
        bytecodeHash: "none"
      }
    },
  },

  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    lumiaTestnet: {
      url: "https://beam-rpc.lumia.org",
      chainId: 2030232745,
      accounts: PRIVATE_KEY,
    },
    lumiaMainnet: {
      url: "https://mainnet-rpc.lumia.org",
      chainId: 994873017,
      accounts: PRIVATE_KEY,
    },
  },

  etherscan: {
    apiKey: {
      lumiaMainnet: "abc", // Blockscout does not need a real key, just put anything
      lumiaTestnet: "abc",
    },
    customChains: [
      {
        network: "lumiaMainnet",
        chainId: 994873017,
        urls: {
          apiURL: "https://explorer.lumia.org/api", // ✅ Lumia Blockscout API endpoint
          browserURL: "https://explorer.lumia.org",
        },
      },
      {
        network: "lumiaTestnet",
        chainId: 2030232745,
        urls: {
          apiURL: "https://beam-explorer.lumia.org/api", // ✅ Testnet Blockscout API
          browserURL: "https://beam-explorer.lumia.org",
        },
      },
    ],
  },

  ignition: {
    defaultNetwork: "hardhat",
  },
};
