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
    uint256 payoutPeriodDuration; // Duration in seconds (e.g., 30 days, 1 year)
    uint256 firstPayoutDate; // When first payout becomes available
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
    uint256 public immutable payoutPeriodDuration; // Duration between payouts in seconds
    uint256 public immutable firstPayoutDate; // When first payout becomes available
    uint256 public totalEscrowed;
    address public immutable offeringContract;

    // Emergency unlock settings
    bool public emergencyUnlockEnabled;
    uint256 public emergencyUnlockPenalty; // Penalty percentage (e.g., 1000 = 10%)
    
    // Payout period tracking
    uint256 public currentPayoutPeriod; // Current payout period number
    uint256 public lastPayoutDistributionTime; // Last time admin distributed payouts
    mapping(uint256 => uint256) public payoutFundsPerPeriod; // period => amount added
    mapping(address => uint256) public userLastClaimedPeriod; // user => last claimed period

    struct Investor {
        uint256 deposited;
        bool hasClaimedTokens;
        uint256 lastPayoutTime;
        uint256 totalPayoutsClaimed;
        PayoutFrequency payoutFrequency;
        uint256 payoutAmountPerPeriod; // Amount to be paid out per period
        uint256 totalPayoutBalance; // Total payout balance available to claim
        bool emergencyUnlocked; // Track if user used emergency unlock
        uint256 lastClaimedPeriod; // Last period user claimed payout
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
    error PayoutNotAvailable();
    error InvalidPayoutPeriod();

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
    event PayoutPeriodStarted(uint256 indexed period, uint256 startTime);
    event PayoutDistributed(uint256 indexed period, uint256 amount, uint256 totalFunds);

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
        payoutPeriodDuration = config.payoutPeriodDuration;
        firstPayoutDate = config.firstPayoutDate;
        offeringContract = config.offeringContract;

        // Grant roles to the deployer (WrappedTokenFactory)
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PAYOUT_ADMIN_ROLE, msg.sender);
        
        // Initialize payout period tracking
        currentPayoutPeriod = 0;
        lastPayoutDistributionTime = 0;

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
            emergencyUnlocked: false,
            lastClaimedPeriod: 0
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
    function distributePayoutForPeriod(
        uint256 _amount
    ) external onlyRole(PAYOUT_ADMIN_ROLE) nonReentrant {
        if (_amount == 0) revert InvalidAmt();
        
        // Check if we can start a new payout period
        uint256 nextPayoutTime = getNextPayoutTime();
        if (block.timestamp < nextPayoutTime) revert PayoutNotAvailable();
        
        // Start new payout period
        currentPayoutPeriod += 1;
        lastPayoutDistributionTime = block.timestamp;
        payoutFundsPerPeriod[currentPayoutPeriod] = _amount;

        // Transfer payout tokens to this contract
        if (!payoutToken.transferFrom(msg.sender, address(this), _amount))
            revert TransferFailed();

        totalPayoutFunds += _amount;

        emit PayoutPeriodStarted(currentPayoutPeriod, block.timestamp);
        emit PayoutDistributed(currentPayoutPeriod, _amount, totalPayoutFunds);
    }

    // User claims their full available payout balance
    function claimAvailablePayouts() external nonReentrant {
        Investor storage user = investors[msg.sender];
        if (user.deposited == 0) revert NoDeposit();
        if (user.emergencyUnlocked) revert Claimed();
        
        uint256 userBalance = balanceOf(msg.sender);
        if (userBalance == 0) revert NoDeposit();
        
        // Calculate claimable amount from unclaimed periods
        uint256 totalClaimable = 0;
        uint256 totalSupply = totalSupply();
        
        for (uint256 period = user.lastClaimedPeriod + 1; period <= currentPayoutPeriod; period++) {
            uint256 periodFunds = payoutFundsPerPeriod[period];
            if (periodFunds > 0 && totalSupply > 0) {
                uint256 userShare = (periodFunds * userBalance) / totalSupply;
                totalClaimable += userShare;
            }
        }
        
        if (totalClaimable == 0) revert NoPayout();
        
        // Update user's last claimed period
        user.lastClaimedPeriod = currentPayoutPeriod;
        user.totalPayoutBalance += totalClaimable;
        
        // Ensure we don't try to transfer more than the contract has
        uint256 contractBalance = payoutToken.balanceOf(address(this));
        if (totalClaimable > contractBalance) {
            totalClaimable = contractBalance;
        }
        
        if (!payoutToken.transfer(msg.sender, totalClaimable))
            revert TransferFailed();

        emit PayoutClaimed(msg.sender, totalClaimable, 0);
    }
    
    // Legacy function for backwards compatibility
    function claimTotalPayout() external {
        claimAvailablePayouts();
    }
    
    // Legacy function for backwards compatibility  
    function addPayoutFunds(uint256 _amount) external {
        distributePayoutForPeriod(_amount);
    }

    // Get user's payout balance including unclaimed periods
    function getUserPayoutBalance(
        address _user
    ) external view returns (uint256 totalAvailable, uint256 claimed, uint256 claimable) {
        Investor storage user = investors[_user];
        if (user.deposited == 0) return (0, 0, 0);

        uint256 userBalance = balanceOf(_user);
        if (userBalance == 0) return (0, 0, 0);

        uint256 totalSupply = totalSupply();
        if (totalSupply == 0) return (0, 0, 0);

        // Calculate total available from all periods
        totalAvailable = 0;
        for (uint256 period = 1; period <= currentPayoutPeriod; period++) {
            uint256 periodFunds = payoutFundsPerPeriod[period];
            if (periodFunds > 0) {
                totalAvailable += (periodFunds * userBalance) / totalSupply;
            }
        }
        
        // Calculate claimable from unclaimed periods
        claimable = 0;
        for (uint256 period = user.lastClaimedPeriod + 1; period <= currentPayoutPeriod; period++) {
            uint256 periodFunds = payoutFundsPerPeriod[period];
            if (periodFunds > 0) {
                claimable += (periodFunds * userBalance) / totalSupply;
            }
        }
        
        claimed = user.totalPayoutBalance;
        
        // Ensure claimable doesn't exceed contract balance
        uint256 contractBalance = payoutToken.balanceOf(address(this));
        if (claimable > contractBalance) {
            claimable = contractBalance;
        }
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

        // Clean up user record completely
        delete investors[msg.sender];

        // Transfer tokens minus penalty
        if (!peggedToken.transfer(msg.sender, amountToReturn))
            revert TransferFailed();

        emit EmergencyUnlockUsed(msg.sender, amountToReturn, penaltyAmount);
    }
    
    // Get next available payout time
    function getNextPayoutTime() public view returns (uint256) {
        if (lastPayoutDistributionTime == 0) {
            return firstPayoutDate;
        }
        return lastPayoutDistributionTime + payoutPeriodDuration;
    }
    
    // Check if payout period is available
    function isPayoutPeriodAvailable() external view returns (bool) {
        return block.timestamp >= getNextPayoutTime();
    }
    
    // Get current payout period info
    function getCurrentPayoutPeriodInfo() external view returns (
        uint256 period,
        uint256 lastDistributionTime,
        uint256 nextPayoutTime,
        bool canDistribute
    ) {
        period = currentPayoutPeriod;
        lastDistributionTime = lastPayoutDistributionTime;
        nextPayoutTime = getNextPayoutTime();
        canDistribute = block.timestamp >= nextPayoutTime;
    }
    
    // Get user's claimable periods
    function getUserClaimablePeriods(address _user) external view returns (
        uint256[] memory periods,
        uint256[] memory amounts
    ) {
        Investor storage user = investors[_user];
        if (user.deposited == 0) {
            return (new uint256[](0), new uint256[](0));
        }
        
        uint256 userBalance = balanceOf(_user);
        uint256 totalSupply = totalSupply();
        
        if (userBalance == 0 || totalSupply == 0) {
            return (new uint256[](0), new uint256[](0));
        }
        
        // Count claimable periods
        uint256 claimableCount = 0;
        for (uint256 period = user.lastClaimedPeriod + 1; period <= currentPayoutPeriod; period++) {
            if (payoutFundsPerPeriod[period] > 0) {
                claimableCount++;
            }
        }
        
        periods = new uint256[](claimableCount);
        amounts = new uint256[](claimableCount);
        
        uint256 index = 0;
        for (uint256 period = user.lastClaimedPeriod + 1; period <= currentPayoutPeriod; period++) {
            uint256 periodFunds = payoutFundsPerPeriod[period];
            if (periodFunds > 0) {
                periods[index] = period;
                amounts[index] = (periodFunds * userBalance) / totalSupply;
                index++;
            }
        }
    }

    function claimFinalTokens() external onlyAfterMaturity {
        Investor storage user = investors[msg.sender];
        if (user.hasClaimedTokens) revert Claimed();
        if (user.deposited == 0) revert NoDeposit();
        if (user.emergencyUnlocked) revert Claimed();

        uint256 wrappedBalance = balanceOf(msg.sender);
        _burn(msg.sender, wrappedBalance);

        uint256 depositedAmount = user.deposited;
        
        // Clean up user record completely
        delete investors[msg.sender];
        
        if (!peggedToken.transfer(msg.sender, depositedAmount))
            revert TransferFailed();

        emit FinalTokensClaimed(msg.sender, depositedAmount);
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
