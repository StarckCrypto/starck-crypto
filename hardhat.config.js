require("dotenv").config();
require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-waffle");
require("solidity-coverage");

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: "0.8.20",
  networks: {
    bsc: {
      url: process.env.QUICKNODE_BSC_URL,
      accounts: [process.env.PRIVATE_KEY],
      chainId: 56,
    },
  },
};
