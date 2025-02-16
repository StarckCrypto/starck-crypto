const { ethers } = require("hardhat");

const STK_TOKEN_ADDRESS = "0xa35b5c783117e107644056f5d39faa468e9d8d47";

async function main() {
  const Contract = await ethers.getContractFactory("WithdrawalClaims");
  const contract = await Contract.deploy(STK_TOKEN_ADDRESS);

  await contract.deployed();

  console.log("Contract deployed to:", contract.address);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
