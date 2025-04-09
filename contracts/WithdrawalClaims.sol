// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Import Ownable for access control, IERC20 for token interface,
// and MerkleProof for verifying the Merkle tree proof.
import "node_modules/@openzeppelin/contracts/access/Ownable.sol";
import "node_modules/@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "node_modules/@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract WithdrawalClaims is Ownable {
  // The token that is held by the contract.
  IERC20 public token;

  // The current Merkle root representing all valid withdrawal requests.
  bytes32 public merkleRoot;

  // Mapping to track which withdrawal requests (by their unique id)
  // have been claimed already.
  mapping(bytes32 => bool) public claimed;

  // Emitted when the Merkle root is updated.
  event MerkleRootUpdated(bytes32 newMerkleRoot);

  // Emitted when a withdrawal is claimed.
  event Claimed(bytes32 indexed id, address indexed account, uint256 amount);

  /**
   * @notice Set the token that this contract will distribute.
   * @param _token The address of the ERC20 token.
   */
  constructor(IERC20 _token) Ownable(msg.sender) {
    token = _token;
  }

  /**
   * @notice Allows the owner (or an off-chain process) to update the Merkle root.
   * This function should be called periodically (e.g., every 12 or 24 hours)
   * to capture the latest withdrawal requests.
   * @param _merkleRoot The new Merkle root.
   */
  function updateMerkleRoot(bytes32 _merkleRoot) external onlyOwner {
    merkleRoot = _merkleRoot;
    emit MerkleRootUpdated(_merkleRoot);
  }

  /**
   * @notice Allows a user to claim their tokens after the lock period has ended.
   * @param id A unique identifier for the withdrawal request (as bytes32).
   * @param amount The amount of tokens to be claimed.
   * @param unlockTime The timestamp after which the claim is allowed.
   * @param merkleProof The Merkle proof that validates this withdrawal request.
   */
  function claim(bytes32 id, uint256 amount, uint256 unlockTime, bytes32[] calldata merkleProof) external {
    // Ensure this request has not been claimed already.
    require(!claimed[id], "Withdrawal already claimed");

    // Ensure that the lock period has passed.
    require(block.timestamp >= unlockTime, "Withdrawal still locked");

    // Recreate the leaf node. It must match the one that was used off-chain to
    // build the Merkle tree. The leaf is computed from the unique id, the amount, and the unlockTime.
    bytes32 leaf = keccak256(abi.encodePacked(id, amount, unlockTime));

    // Verify the provided proof against the stored Merkle root.
    require(MerkleProof.verify(merkleProof, merkleRoot, leaf), "Invalid Merkle proof");

    // Mark the request as claimed to prevent double claims.
    claimed[id] = true;

    // Transfer the tokens from this contract to the user.
    require(token.transfer(msg.sender, amount), "Token transfer failed");

    emit Claimed(id, msg.sender, amount);
  }
}
