// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

struct WrapedTokenConfig {
    string name;
    string symbol;
    address peggedToken;
    address payoutToken;
    uint256 maturityDate;
    uint256 payoutRate;
    address offeringContract;
}

contract WRAPEDTOKEN is ERC20, ERC20Burnable, AccessControl, Pausable, ReentrancyGuard {
    enum PayoutFrequency {
        Daily,
        Monthly,
        Yearly
    }

    bytes32 public constant PAYOUT_FUNDER_ROLE = keccak256("PAYOUT_FUNDER_ROLE");
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");

    IERC20 public immutable peggedToken;
    IERC20 public immutable payoutToken; // Token used for payouts
    uint256 public immutable maturityDate;
    uint256 public immutable payoutRate; // Payout rate as a percentage (e.g., 100 for 1%)
    uint256 public totalEscrowed;
    address public immutable offeringContract;

    struct Investor {
        uint256 deposited;
        bool hasClaimedTokens;
        uint256 lastPayoutTime;
        uint256 totalPayoutsClaimed;
        PayoutFrequency payoutFrequency;
        uint256 payoutAmountPerPeriod; // Amount to be paid out per period
    }

    struct MultiPayoutDetails {
        address funder;
        address token;
        uint256 totalAmount;
        uint256 claimedAmount;
        uint256 numClaimants;
        bool isActive;
        uint256 payoutNonce; // Global nonce for the payout ID itself
    }

    mapping(address => Investor) public investors;
    
    // Multi-payout system
    uint256 public nextPayoutId;
    mapping(uint256 => MultiPayoutDetails) public payouts;
    mapping(uint256 => mapping(address => bool)) public hasClaimed; // payoutId => claimant => claimed
    mapping(uint256 => mapping(address => uint256)) public claimantNonces; // payoutId => claimant => nonce

    error NoTransfersAllowed();
    error InvalidAmount();
    error InvalidStablecoin();
    error AlreadyMatured();
    error NotMatured();
    error NoDeposit();
    error AlreadyClaimed();
    error TokenTransferFailed();
    error NoPayoutDue();
    error PayoutPeriodNotElapsed();

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

    constructor(WrapedTokenConfig memory config) ERC20(config.name, config.symbol) {
        if (config.peggedToken == address(0) || config.payoutToken == address(0))
            revert InvalidStablecoin();
        peggedToken = IERC20(config.peggedToken);
        payoutToken = IERC20(config.payoutToken);
        maturityDate = config.maturityDate;
        payoutRate = config.payoutRate;
        offeringContract = config.offeringContract;
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        nextPayoutId = 1;
    }

    modifier onlyOfferingContract() {
        if (msg.sender != offeringContract)
            revert("Caller is not the offering contract");
        _;
    }

    modifier onlyAfterMaturity() {
        if (block.timestamp < maturityDate) revert NotMatured();
        _;
    }

    function _getPayoutPeriodSeconds(
        PayoutFrequency _frequency
    ) internal pure returns (uint256) {
        if (_frequency == PayoutFrequency.Daily) {
            return 1 days;
        } else if (_frequency == PayoutFrequency.Monthly) {
            return 30 days; // Approximation for a month
        } else if (_frequency == PayoutFrequency.Yearly) {
            return 365 days; // Approximation for a year
        }
        return 0; // Should not happen
    }

    function registerInvestment(
        address _user,
        uint256 amount,
        PayoutFrequency _payoutFrequency
    ) external onlyOfferingContract {
        if (amount == 0) revert InvalidAmount();

        bool success = peggedToken.transferFrom(
            offeringContract,
            address(this),
            amount
        );
        if (!success) revert TokenTransferFailed();

        _mint(_user, amount);

        uint256 calculatedPayoutAmountPerPeriod = (amount * payoutRate) / 10000; // Assuming payoutRate is in basis points (e.g., 100 for 1%)

        investors[_user] = Investor({
            deposited: amount,
            hasClaimedTokens: false,
            lastPayoutTime: block.timestamp,
            totalPayoutsClaimed: 0,
            payoutFrequency: _payoutFrequency,
            payoutAmountPerPeriod: calculatedPayoutAmountPerPeriod
        });

        totalEscrowed += amount;
    }

    function claimPayout() external {
        Investor storage user = investors[msg.sender];
        if (user.deposited == 0) revert NoDeposit();
        if (user.hasClaimedTokens) revert AlreadyClaimed(); // Cannot claim payouts if final tokens are claimed

        uint256 payoutPeriodSeconds = _getPayoutPeriodSeconds(
            user.payoutFrequency
        );
        if (payoutPeriodSeconds == 0) revert NoPayoutDue(); // Should not happen if frequency is valid

        uint256 timeElapsed = block.timestamp - user.lastPayoutTime;
        if (timeElapsed < payoutPeriodSeconds) revert PayoutPeriodNotElapsed();

        uint256 periodsPassed = timeElapsed / payoutPeriodSeconds;
        uint256 totalPayoutDue = periodsPassed * user.payoutAmountPerPeriod;

        // Ensure total payouts do not exceed the deposited amount
        if (user.totalPayoutsClaimed + totalPayoutDue > user.deposited) {
            totalPayoutDue = user.deposited - user.totalPayoutsClaimed;
        }

        if (totalPayoutDue == 0) revert NoPayoutDue();

        user.lastPayoutTime += periodsPassed * payoutPeriodSeconds;
        user.totalPayoutsClaimed += totalPayoutDue;

        if (!payoutToken.transfer(msg.sender, totalPayoutDue))
            revert TokenTransferFailed();
    }

    function claimFinalTokens() external onlyAfterMaturity {
        Investor storage user = investors[msg.sender];
        if (user.hasClaimedTokens) revert AlreadyClaimed();
        if (user.deposited == 0) revert NoDeposit();

        // Before claiming final tokens, ensure all due payouts are claimed
        // This prevents users from bypassing periodic payouts by waiting for maturity
        uint256 payoutPeriodSeconds = _getPayoutPeriodSeconds(
            user.payoutFrequency
        );
        if (payoutPeriodSeconds > 0) {
            uint256 timeElapsed = block.timestamp - user.lastPayoutTime;
            if (timeElapsed >= payoutPeriodSeconds) {
                // There are pending payouts, revert or force claim?
                // For now, let's revert to force claiming periodic payouts first.
                revert NoPayoutDue(); // Or a more specific error like "PendingPayoutsExist"
            }
        }

        uint256 peggedAmount = balanceOf(msg.sender);
        _burn(msg.sender, peggedAmount);

        user.hasClaimedTokens = true;
        if (!peggedToken.transfer(msg.sender, user.deposited))
            revert TokenTransferFailed();
    }

    // Multi-payout distribution system
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

    function claimMultiPayout(
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

    function transfer(address, uint256) public pure override returns (bool) {
        revert NoTransfersAllowed();
    }

    function transferFrom(
        address,
        address,
        uint256
    ) public pure override returns (bool) {
        revert NoTransfersAllowed();
    }
}