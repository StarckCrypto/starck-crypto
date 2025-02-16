import * as chai from "chai";
import hardhat from "hardhat";
import { solidity } from "ethereum-waffle";

chai.use(solidity);

const { expect } = chai;
const { ethers } = hardhat;

describe("WithdrawalClaims", function () {
  let owner, alice, bob;
  let token, withdrawalClaims;

  // Computes the leaf hash as defined in the contract.
  const computeLeaf = (id, account, amount, unlockTime) => {
    return ethers.utils.solidityKeccak256(
      ["bytes32", "address", "uint256", "uint256"],
      [id, account, amount, unlockTime]
    );
  };

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();

    const TestToken = await ethers.getContractFactory("TestToken");
    token = await TestToken.deploy(ethers.utils.parseEther("1000000"));
    await token.deployed();

    const WithdrawalClaimsFactory = await ethers.getContractFactory("WithdrawalClaims");
    withdrawalClaims = await WithdrawalClaimsFactory.deploy(token.address);
    await withdrawalClaims.deployed();

    await token.transfer(withdrawalClaims.address, ethers.utils.parseEther("100000"));
  });

  describe("updateMerkleRoot", function () {
    it("updates the merkle root and emits MerkleRootUpdated", async function () {
      const newRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("new-root"));
      await expect(withdrawalClaims.updateMerkleRoot(newRoot))
        .to.emit(withdrawalClaims, "MerkleRootUpdated")
        .withArgs(newRoot);
      expect(await withdrawalClaims.merkleRoot()).to.equal(newRoot);
    });

    it("reverts when a non-owner updates the merkle root", async function () {
      const newRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("new-root"));
      await expect(withdrawalClaims.connect(alice).updateMerkleRoot(newRoot)).to.be.reverted;
    });
  });

  describe("claim", function () {
    let id, amount, unlockTime, leaf, proof;

    beforeEach(async function () {
      id = ethers.utils.hexZeroPad("0x1", 32);
      amount = ethers.utils.parseEther("1000");

      const block = await ethers.provider.getBlock("latest");
      unlockTime = block.timestamp - 1;

      leaf = computeLeaf(id, alice.address, amount, unlockTime);
      proof = [];

      await withdrawalClaims.updateMerkleRoot(leaf);
    });

    it("allows a valid claim and transfers tokens", async function () {
      const aliceInitialBalance = await token.balanceOf(alice.address);

      await expect(withdrawalClaims.connect(alice).claim(id, alice.address, amount, unlockTime, proof))
        .to.emit(withdrawalClaims, "Claimed")
        .withArgs(id, alice.address, amount);
      expect(await withdrawalClaims.claimed(id)).to.equal(true);

      const aliceNewBalance = await token.balanceOf(alice.address);
      expect(aliceNewBalance.sub(aliceInitialBalance)).to.equal(amount);
    });

    it("reverts when claiming the same withdrawal twice", async function () {
      await withdrawalClaims.connect(alice).claim(id, alice.address, amount, unlockTime, proof);
      await expect(
        withdrawalClaims.connect(alice).claim(id, alice.address, amount, unlockTime, proof)
      ).to.be.revertedWith("Withdrawal already claimed");
    });

    it("reverts when an unauthorized caller attempts a claim", async function () {
      await expect(
        withdrawalClaims.connect(bob).claim(id, alice.address, amount, unlockTime, proof)
      ).to.be.revertedWith("Not authorized to claim");
    });

    it("reverts if the lock period has not elapsed", async function () {
      const block = await ethers.provider.getBlock("latest");
      const futureUnlockTime = block.timestamp + 1000;
      const futureLeaf = computeLeaf(id, alice.address, amount, futureUnlockTime);
      await withdrawalClaims.updateMerkleRoot(futureLeaf);

      await expect(
        withdrawalClaims.connect(alice).claim(id, alice.address, amount, futureUnlockTime, [])
      ).to.be.revertedWith("Withdrawal still locked");
    });

    it("reverts with an invalid merkle proof", async function () {
      const invalidAmount = amount.add(1);
      await expect(
        withdrawalClaims.connect(alice).claim(id, alice.address, invalidAmount, unlockTime, proof)
      ).to.be.revertedWith("Invalid Merkle proof");
    });

    it("reverts when token transfer fails", async function () {
      const WithdrawalClaimsFactory = await ethers.getContractFactory("WithdrawalClaims");
      const unfundedClaims = await WithdrawalClaimsFactory.deploy(token.address);
      await unfundedClaims.deployed();

      await unfundedClaims.updateMerkleRoot(leaf);
      await expect(unfundedClaims.connect(alice).claim(id, alice.address, amount, unlockTime, proof)).to.be.reverted;
    });
  });
});
