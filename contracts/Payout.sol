// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Payout is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant PAYOUT_FUNDER_ROLE = keccak256("PAYOUT_FUNDER_ROLE");
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");

    struct MultiPayoutDetails {
        address funder;
        address token;
        uint256 totalAmount;
        uint256 claimedAmount;
        uint256 numClaimants;
        bool isActive;
        uint256 payoutNonce; // Global nonce for the payout ID itself
    }

    uint256 public nextPayoutId;
    mapping(uint256 => MultiPayoutDetails) public payouts;
    mapping(uint256 => mapping(address => bool)) public hasClaimed; // payoutId => claimant => claimed

    // To prevent replay attacks for each claimant for a specific payout
    mapping(uint256 => mapping(address => uint256)) public claimantNonces;

    event PayoutAllotted(
        uint256 indexed payoutId,
        address indexed funder,
        address token,
        uint256 totalAmount,
        uint256 payoutNonce
    );
    event PayoutClaimed(
        uint256 indexed payoutId,
        address indexed claimant,
        address token,
        uint256 amountClaimed
    );

    constructor(address defaultAdmin, address initialSigner) {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(SIGNER_ROLE, initialSigner);
        nextPayoutId = 1; // Initialize payout ID counter
    }

    function allotPayout(
        address _token,
        uint256 _amount
    ) external onlyRole(PAYOUT_FUNDER_ROLE) whenNotPaused nonReentrant returns (uint256) {
        require(_token != address(0), "Invalid token address");
        require(_amount > 0, "Amount must be greater than zero");

        uint256 currentPayoutId = nextPayoutId;
        nextPayoutId++;

        // Increment global nonce for the payout ID
        uint256 currentPayoutNonce = payouts[currentPayoutId].payoutNonce + 1;

        payouts[currentPayoutId] = MultiPayoutDetails({
            funder: msg.sender,
            token: _token,
            totalAmount: _amount,
            claimedAmount: 0,
            numClaimants: 0,
            isActive: true,
            payoutNonce: currentPayoutNonce
        });

        // Transfer tokens to this contract
        IERC20(_token).transferFrom(msg.sender, address(this), _amount);

        emit PayoutAllotted(currentPayoutId, msg.sender, _token, _amount, currentPayoutNonce);
        return currentPayoutId;
    }

    function claimPayout(
        uint256 _payoutId,
        uint256 _amountToClaim,
        uint256 _claimantNonce,
        bytes memory _signature
    ) external nonReentrant whenNotPaused {
        MultiPayoutDetails storage payout = payouts[_payoutId];
        address claimant = msg.sender;

        require(payout.funder != address(0), "Payout does not exist");
        require(payout.isActive, "Payout is not active");
        require(!hasClaimed[_payoutId][claimant], "Already claimed from this payout");
        require(_amountToClaim > 0, "Amount to claim must be greater than zero");
        require(payout.totalAmount - payout.claimedAmount >= _amountToClaim, "Insufficient funds remaining");

        // Check claimant's nonce for this specific payout to prevent replay attacks
        require(claimantNonces[_payoutId][claimant] + 1 == _claimantNonce, "Incorrect claimant nonce or replay attack");

        // Construct the message hash that was signed off-chain
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(
                    abi.encodePacked(
                        _payoutId,
                        claimant,
                        _amountToClaim,
                        _claimantNonce,
                        address(this),
                        payout.payoutNonce // Include payout's global nonce to invalidate old signatures if payout is modified
                    )
                )
            )
        );

        // Recover the signer from the signature
        address signer = recoverSigner(messageHash, _signature);
        require(hasRole(SIGNER_ROLE, signer), "Invalid signer");

        payout.claimedAmount += _amountToClaim;
        payout.numClaimants++;
        hasClaimed[_payoutId][claimant] = true;
        claimantNonces[_payoutId][claimant] = _claimantNonce; // Update claimant's nonce

        // Transfer tokens to the recipient
        IERC20(payout.token).transfer(claimant, _amountToClaim);

        emit PayoutClaimed(_payoutId, claimant, payout.token, _amountToClaim);
    }

    function recoverSigner(bytes32 _hash, bytes memory _signature) internal pure returns (address) {
        require(_signature.length == 65, "Invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(_signature, 32))
            s := mload(add(_signature, 64))
            v := byte(0, mload(add(_signature, 96)))
        }
        return ecrecover(_hash, v, r, s);
    }

    // Emergency pause/unpause, only admin
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
        emit Paused(msg.sender);
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
        emit Unpaused(msg.sender);
    }

    // Admin functions to manage roles
    function grantPayoutFunderRole(address _funder) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(PAYOUT_FUNDER_ROLE, _funder);
    }

    function revokePayoutFunderRole(address _funder) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(PAYOUT_FUNDER_ROLE, _funder);
    }

    function grantSignerRole(address _signer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(SIGNER_ROLE, _signer);
    }

    function revokeSignerRole(address _signer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(SIGNER_ROLE, _signer);
    }

    function getRemainingAmount(uint256 _payoutId) external view returns (uint256) {
        MultiPayoutDetails storage payout = payouts[_payoutId];
        require(payout.funder != address(0), "Payout does not exist");
        return payout.totalAmount - payout.claimedAmount;
    }

    function getNumClaimants(uint256 _payoutId) external view returns (uint256) {
        MultiPayoutDetails storage payout = payouts[_payoutId];
        require(payout.funder != address(0), "Payout does not exist");
        return payout.numClaimants;
    }
}
