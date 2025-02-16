import * as chai from "chai";
import hardhat from "hardhat";
import { solidity } from "ethereum-waffle";

chai.use(solidity);

const { expect } = chai;
const { ethers } = hardhat;

describe("WithdrawalClaims", function () {
  let owner, alice, bob;
  let token, withdrawalClaims;

  // Helper: compute leaf hash exactly as in the contract.
  // Note: Using the same types as in Solidity: uint256, address, uint256, uint256.
  const computeLeaf = (index, account, amount, unlockTime) => {
    return ethers.utils.solidityKeccak256(
      ["uint256", "address", "uint256", "uint256"],
      [index, account, amount, unlockTime]
    );
  };

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();

    // Deploy the TestToken contract with a large initial supply.
    const TestToken = await ethers.getContractFactory("TestToken");
    token = await TestToken.deploy(ethers.utils.parseEther("1000000"));
    await token.deployed();

    // Deploy the WithdrawalClaims contract, passing the token address.
    const WithdrawalClaims = await ethers.getContractFactory("WithdrawalClaims");
    withdrawalClaims = await WithdrawalClaims.deploy(token.address);
    await withdrawalClaims.deployed();

    // Fund the WithdrawalClaims contract with tokens so it can pay out claims.
    await token.transfer(withdrawalClaims.address, ethers.utils.parseEther("100000"));
  });

  describe("updateMerkleRoot", function () {
    it("should update the merkle root and emit MerkleRootUpdated", async function () {
      const newRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("new-root"));
      await expect(withdrawalClaims.updateMerkleRoot(newRoot))
        .to.emit(withdrawalClaims, "MerkleRootUpdated")
        .withArgs(newRoot);
      expect(await withdrawalClaims.merkleRoot()).to.equal(newRoot);
    });

    it("should revert if a non-owner attempts to update the merkle root", async function () {
      const newRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("new-root"));
      await expect(withdrawalClaims.connect(alice).updateMerkleRoot(newRoot)).to.be.reverted;
      // (The revert message will be from Ownable—if using OpenZeppelin’s Ownable it might be "Ownable: caller is not the owner")
    });
  });

  describe("claim", function () {
    // We set up a valid claim scenario.
    let index, claimAccount, amount, unlockTime, leaf, proof;

    beforeEach(async function () {
      index = 1;
      claimAccount = alice.address;
      amount = ethers.utils.parseEther("1000");

      // Set unlockTime to a time that is already past (current block time - 1 second)
      const block = await ethers.provider.getBlock("latest");
      unlockTime = block.timestamp - 1;

      // Compute the leaf for this withdrawal request.
      leaf = computeLeaf(index, claimAccount, amount, unlockTime);

      // For a tree with a single leaf, the Merkle root equals the leaf.
      proof = []; // no siblings needed

      // Update the contract's merkle root to match our computed leaf.
      await withdrawalClaims.updateMerkleRoot(leaf);
    });

    it("should allow a valid claim and transfer tokens", async function () {
      const aliceInitialBalance = await token.balanceOf(alice.address);

      await expect(withdrawalClaims.connect(alice).claim(index, alice.address, amount, unlockTime, proof))
        .to.emit(withdrawalClaims, "Claimed")
        .withArgs(index, alice.address, amount);

      // Ensure that the withdrawal request is now marked as claimed.
      expect(await withdrawalClaims.claimed(index)).to.equal(true);

      // Check that the tokens have been transferred.
      const aliceNewBalance = await token.balanceOf(alice.address);
      expect(aliceNewBalance.sub(aliceInitialBalance)).to.equal(amount);
    });

    it("should revert if the same withdrawal is claimed twice", async function () {
      // First claim works.
      await withdrawalClaims.connect(alice).claim(index, alice.address, amount, unlockTime, proof);
      // Second claim attempt should revert.
      await expect(
        withdrawalClaims.connect(alice).claim(index, alice.address, amount, unlockTime, proof)
      ).to.be.revertedWith("Withdrawal already claimed");
    });

    it("should revert if the caller is not the designated account", async function () {
      // Bob tries to claim on behalf of Alice.
      await expect(
        withdrawalClaims.connect(bob).claim(index, alice.address, amount, unlockTime, proof)
      ).to.be.revertedWith("Not authorized to claim");
    });

    it("should revert if the lock period has not passed", async function () {
      // Set an unlockTime in the future.
      const block = await ethers.provider.getBlock("latest");
      const futureUnlockTime = block.timestamp + 1000;
      const futureLeaf = computeLeaf(index, alice.address, amount, futureUnlockTime);
      // Update the merkle root with the new leaf.
      await withdrawalClaims.updateMerkleRoot(futureLeaf);

      await expect(
        withdrawalClaims.connect(alice).claim(index, alice.address, amount, futureUnlockTime, [])
      ).to.be.revertedWith("Withdrawal still locked");
    });

    it("should revert with an invalid merkle proof", async function () {
      // Alter one of the parameters (e.g. amount) so that the computed leaf does not match the stored merkle root.
      const invalidAmount = amount.add(1);
      await expect(
        withdrawalClaims.connect(alice).claim(index, alice.address, invalidAmount, unlockTime, proof)
      ).to.be.revertedWith("Invalid Merkle proof");
    });

    it("should revert if token transfer fails", async function () {
      // To simulate a transfer failure, deploy a new instance of WithdrawalClaims that is not funded.
      const WithdrawalClaims = await ethers.getContractFactory("WithdrawalClaims");
      const unfundedClaims = await WithdrawalClaims.deploy(token.address);
      await unfundedClaims.deployed();

      // Set the merkle root as before.
      await unfundedClaims.updateMerkleRoot(leaf);

      // Because we have not transferred any tokens to this new contract, the transfer should fail.
      await expect(unfundedClaims.connect(alice).claim(index, alice.address, amount, unlockTime, proof)).to.be.reverted;
      // (The revert message may come from the token contract or our require statement)
    });
  });
});
