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
    address admin;
}

contract WRAPEDTOKEN is
    ERC20,
    ERC20Burnable,
    AccessControl,
    Pausable,
    ReentrancyGuard
{
    enum PayoutFrequency {
        Daily,
        Monthly,
        Yearly
    }

    // Role definitions
    bytes32 public constant PAYOUT_ADMIN_ROLE = keccak256("PAYOUT_ADMIN_ROLE");

    IERC20 public immutable peggedToken;
    IERC20 public immutable payoutToken; // Token used for payouts
    uint256 public immutable maturityDate;
    uint256 public immutable payoutRate; // Payout rate as a percentage (e.g., 100 for 1%)
    uint256 public totalEscrowed;
    address public immutable offeringContract;

    // Emergency unlock settings
    bool public emergencyUnlockEnabled;
    uint256 public emergencyUnlockPenalty; // Penalty percentage (e.g., 1000 = 10%)

    struct Investor {
        uint256 deposited;
        bool hasClaimedTokens;
        uint256 lastPayoutTime;
        uint256 totalPayoutsClaimed;
        PayoutFrequency payoutFrequency;
        uint256 payoutAmountPerPeriod; // Amount to be paid out per period
        uint256 totalPayoutBalance; // Total payout balance available to claim
        bool emergencyUnlocked; // Track if user used emergency unlock
    }

    mapping(address => Investor) public investors;
    uint256 public totalPayoutFunds; // Total payout funds available in contract

    error NoTransfers();
    error InvalidAmt();
    error InvalidToken();
    error Matured();
    error NotMatured();
    error NoDeposit();
    error Claimed();
    error TransferFailed();
    error NoPayout();
    error PeriodNotElapsed();
    error InsufficientFunds();
    error UnlockDisabled();
    error AlreadyUnlocked();
    error InvalidPenalty();
    error InvalidStablecoin();
    error PayoutPeriodNotElapsed();

    event PayoutFundsAdded(uint256 amount, uint256 totalFunds);
    event PayoutClaimed(
        address indexed user,
        uint256 amount,
        uint256 remainingBalance
    );
    event IndividualPayoutClaimed(address indexed user, uint256 amount);
    event FinalTokensClaimed(address indexed user, uint256 amount);
    event EmergencyUnlockEnabled(uint256 penalty);
    event EmergencyUnlockUsed(
        address indexed user,
        uint256 amount,
        uint256 penalty
    );

    constructor(
        WrapedTokenConfig memory config
    ) ERC20(config.name, config.symbol) {
        if (
            config.peggedToken == address(0) || config.payoutToken == address(0)
        ) revert InvalidStablecoin();
        peggedToken = IERC20(config.peggedToken);
        payoutToken = IERC20(config.payoutToken);
        maturityDate = config.maturityDate;
        payoutRate = config.payoutRate;
        offeringContract = config.offeringContract;

        // Grant roles to the deployer (WrappedTokenFactory)
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PAYOUT_ADMIN_ROLE, msg.sender);

        // Also grant DEFAULT_ADMIN_ROLE to the offering contract's deployer
        // This is needed because the factory deploys the token, but we need the original deployer to have admin rights
        // We'll handle this in the factory instead
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
            return 30 days;
        } else if (_frequency == PayoutFrequency.Yearly) {
            return 365 days;
        }
        return 0;
    }

    function registerInvestment(
        address _user,
        uint256 amount,
        PayoutFrequency _payoutFrequency
    ) external onlyOfferingContract {
        if (amount == 0) revert InvalidAmt();

        bool success = peggedToken.transferFrom(
            offeringContract,
            address(this),
            amount
        );
        if (!success) revert TransferFailed();

        _mint(_user, amount);

        uint256 payoutPerPeriod = (amount * payoutRate) / 10000;

        investors[_user] = Investor({
            deposited: amount,
            hasClaimedTokens: false,
            lastPayoutTime: block.timestamp,
            totalPayoutsClaimed: 0,
            payoutFrequency: _payoutFrequency,
            payoutAmountPerPeriod: payoutPerPeriod,
            totalPayoutBalance: 0, // Will be updated when admin adds payout funds
            emergencyUnlocked: false
        });

        totalEscrowed += amount;
    }

    // Individual payout claim (original functionality)
    function claimPayout() external {
        Investor storage user = investors[msg.sender];
        if (user.deposited == 0) revert NoDeposit();
        if (user.hasClaimedTokens) revert Claimed();

        uint256 payoutPeriodSeconds = _getPayoutPeriodSeconds(
            user.payoutFrequency
        );
        if (payoutPeriodSeconds == 0) revert NoPayout();

        uint256 timeElapsed = block.timestamp - user.lastPayoutTime;
        if (timeElapsed < payoutPeriodSeconds) revert PayoutPeriodNotElapsed();

        uint256 periodsPassed = timeElapsed / payoutPeriodSeconds;
        uint256 totalPayoutDue = periodsPassed * user.payoutAmountPerPeriod;

        if (user.totalPayoutsClaimed + totalPayoutDue > user.deposited) {
            totalPayoutDue = user.deposited - user.totalPayoutsClaimed;
        }

        if (totalPayoutDue == 0) revert NoPayout();

        user.lastPayoutTime += periodsPassed * payoutPeriodSeconds;
        user.totalPayoutsClaimed += totalPayoutDue;

        if (!payoutToken.transfer(msg.sender, totalPayoutDue))
            revert TransferFailed();

        emit IndividualPayoutClaimed(msg.sender, totalPayoutDue);
    }

    // Admin adds payout funds and distributes to all investors proportionally
    function addPayoutFunds(
        uint256 _amount
    ) external onlyRole(PAYOUT_ADMIN_ROLE) nonReentrant {
        if (_amount == 0) revert InvalidAmt();

        // Transfer payout tokens to this contract
        if (!payoutToken.transferFrom(msg.sender, address(this), _amount))
            revert TransferFailed();

        totalPayoutFunds += _amount;

        // Distribute proportionally to all investors based on their wrapped token balance
        uint256 totalSupply = totalSupply();
        if (totalSupply > 0) {
            // Update each investor's payout balance proportionally
            // Note: In practice, you might want to iterate through a list of investors
            // For now, the balance is updated when users claim
        }

        emit PayoutFundsAdded(_amount, totalPayoutFunds);
    }

    // User claims their full available payout balance
    function claimTotalPayout() external nonReentrant {
        Investor storage user = investors[msg.sender];
        if (user.deposited == 0) revert NoDeposit();
        if (user.emergencyUnlocked) revert Claimed();

        // Calculate user's share of total payout funds
        uint256 userBalance = balanceOf(msg.sender);
        if (userBalance == 0) revert NoDeposit();

        uint256 totalSupply = totalSupply();
        uint256 userShare = (totalPayoutFunds * userBalance) / totalSupply;

        // Subtract what user has already claimed
        uint256 availableToClaim = userShare - user.totalPayoutBalance;

        if (availableToClaim == 0) revert NoPayout();

        user.totalPayoutBalance = userShare;

        if (!payoutToken.transfer(msg.sender, availableToClaim))
            revert TransferFailed();

        emit PayoutClaimed(
            msg.sender,
            availableToClaim,
            userShare - availableToClaim
        );
    }

    // Get user's total available payout balance
    function getUserPayoutBalance(
        address _user
    )
        external
        view
        returns (uint256 totalAvailable, uint256 claimed, uint256 claimable)
    {
        Investor storage user = investors[_user];
        if (user.deposited == 0) return (0, 0, 0);

        uint256 userBalance = balanceOf(_user);
        if (userBalance == 0) return (0, 0, 0);

        uint256 totalSupply = totalSupply();
        if (totalSupply == 0) return (0, 0, 0);

        totalAvailable = (totalPayoutFunds * userBalance) / totalSupply;
        claimed = user.totalPayoutBalance;
        claimable = totalAvailable > claimed ? totalAvailable - claimed : 0;
    }

    // Emergency unlock feature - allows users to unlock tokens before maturity with penalty
    function enableEmergencyUnlock(
        uint256 _penaltyPercentage
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_penaltyPercentage > 5000) revert InvalidPenalty(); // Max 50% penalty
        emergencyUnlockEnabled = true;
        emergencyUnlockPenalty = _penaltyPercentage;
        emit EmergencyUnlockEnabled(_penaltyPercentage);
    }

    function disableEmergencyUnlock() external onlyRole(DEFAULT_ADMIN_ROLE) {
        emergencyUnlockEnabled = false;
        emergencyUnlockPenalty = 0;
    }

    // User can emergency unlock their tokens before maturity (with penalty)
    function emergencyUnlock() external nonReentrant {
        if (!emergencyUnlockEnabled) revert UnlockDisabled();

        Investor storage user = investors[msg.sender];
        if (user.deposited == 0) revert NoDeposit();
        if (user.emergencyUnlocked) revert AlreadyUnlocked();
        if (user.hasClaimedTokens) revert Claimed();

        uint256 wrappedBalance = balanceOf(msg.sender);
        if (wrappedBalance == 0) revert NoDeposit();

        // Calculate penalty
        uint256 penaltyAmount = (user.deposited * emergencyUnlockPenalty) /
            10000;
        uint256 amountToReturn = user.deposited - penaltyAmount;

        // Burn wrapped tokens
        _burn(msg.sender, wrappedBalance);

        // Mark as emergency unlocked
        user.emergencyUnlocked = true;

        // Transfer tokens minus penalty
        if (!peggedToken.transfer(msg.sender, amountToReturn))
            revert TransferFailed();

        emit EmergencyUnlockUsed(msg.sender, amountToReturn, penaltyAmount);
    }

    function claimFinalTokens() external onlyAfterMaturity {
        Investor storage user = investors[msg.sender];
        if (user.hasClaimedTokens) revert Claimed();
        if (user.deposited == 0) revert NoDeposit();
        if (user.emergencyUnlocked) revert Claimed();

        uint256 wrappedBalance = balanceOf(msg.sender);
        _burn(msg.sender, wrappedBalance);

        user.hasClaimedTokens = true;
        if (!peggedToken.transfer(msg.sender, user.deposited))
            revert TransferFailed();

        emit FinalTokensClaimed(msg.sender, user.deposited);
    }

    // Emergency pause/unpause
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // Grant payout admin role
    function grantPayoutAdminRole(
        address _admin
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(PAYOUT_ADMIN_ROLE, _admin);
    }

    // Revoke payout admin role
    function revokePayoutAdminRole(
        address _admin
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(PAYOUT_ADMIN_ROLE, _admin);
    }

    function transfer(address, uint256) public pure override returns (bool) {
        revert NoTransfers();
    }

    function transferFrom(
        address,
        address,
        uint256
    ) public pure override returns (bool) {
        revert NoTransfers();
    }
}
