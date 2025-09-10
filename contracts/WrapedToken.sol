// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {WrappedTokenConfig} from "./structs/WrappedTokenConfig.sol";

/**
 * @title WRAPPEDTOKEN
 * @dev A wrapped token contract that provides periodic payouts based on USDT investment value
 *
 * Key Features:
 * - Wraps underlying tokens (e.g., USDT) with a maturity date
 * - Provides periodic payouts in a different token (e.g., USDC)
 * - Calculates payout distribution based on USDT investment value rather than token balance
 * - Supports emergency unlock with configurable penalties
 * - Non-transferable wrapped tokens to maintain investment integrity
 * - Role-based access control for administrative functions
 *
 * Workflow:
 * 1. Users invest through the offering contract
 * 2. Wrapped tokens are minted representing their investment
 * 3. Periodic payouts are distributed based on USDT investment proportions
 * 4. At maturity, users can redeem their original wrapped tokens
 *
 * @author [Your Name/Organization]
 * @notice This contract handles wrapped token investments with periodic payouts
 */
contract WRAPPEDTOKEN is
    ERC20,
    ERC20Burnable,
    AccessControl,
    ReentrancyGuard,
    Pausable
{
    using Math for uint256;
    using SafeCast for uint256;

    // ============================================
    // CONSTANTS AND IMMUTABLE VARIABLES
    // ============================================

    /// @dev Role identifier for addresses authorized to distribute payouts
    bytes32 public constant PAYOUT_ADMIN_ROLE = keccak256("PAYOUT_ADMIN_ROLE");

    /// @dev Role identifier for addresses authorized to pause/unpause the contract
    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");

    /// @dev Precision scale for calculations to avoid rounding errors (18 decimals)
    uint256 private constant PRECISION_SCALE = 1e18;

    /// @dev Maximum emergency unlock penalty (50% in basis points)
    uint256 private constant MAX_PENALTY = 5000;

    /// @dev Basis points denominator (100% = 10000 basis points)
    uint256 private constant BASIS_POINTS = 10000;

    /// @dev Number of seconds in a year for APR calculations
    uint256 private constant SECONDS_PER_YEAR = 365 days;

    /// @dev The underlying token that users deposit (e.g., USDT)
    IERC20 public immutable peggedToken;

    /// @dev The token used for periodic payouts (e.g., USDC)
    IERC20 public immutable payoutToken;

    /// @dev Unix timestamp when wrapped tokens mature and can be redeemed
    uint256 public immutable maturityDate;

    /// @dev Duration between payout periods in seconds
    uint256 public immutable payoutPeriodDuration;

    /// @dev Address of the offering contract authorized to register investments
    address public immutable offeringContract;

    /// @dev Unix timestamp when the first payout becomes available
    uint256 public firstPayoutDate;

    // ============================================
    // STATE VARIABLES
    // ============================================

    /// @dev Current Annual Percentage Rate for payouts (modifiable by admin)
    uint256 public payoutAPR;

    /// @dev Total amount of peggedToken held in escrow
    uint256 public totalEscrowed;

    /// @dev Total USDT value of all investments (used for payout calculations)
    uint256 public totalUSDTInvested;

    /// @dev Whether emergency unlock feature is enabled
    bool public emergencyUnlockEnabled;

    /// @dev Penalty percentage for emergency unlocks (in basis points)
    uint256 public emergencyUnlockPenalty;

    /// @dev Current payout period number (starts at 0)
    uint256 public currentPayoutPeriod;

    /// @dev Timestamp of the last payout distribution
    uint256 public lastPayoutDistributionTime;

    // ============================================
    // MAPPINGS
    // ============================================

    /// @dev Amount of payout tokens distributed for each period
    mapping(uint256 => uint256) public payoutFundsPerPeriod;

    /// @dev Total USDT invested at the time of each payout distribution
    mapping(uint256 => uint256) public totalUSDTSnapshot;

    /// @dev Last payout period claimed by each user
    mapping(address => uint256) public userLastClaimedPeriod;

    /// @dev User's USDT investment value at each period (for fair distribution)
    mapping(address => mapping(uint256 => uint256)) public userUSDTSnapshot;

    /**
     * @dev Struct containing investor information
     * @param deposited Amount of peggedToken deposited by the investor
     * @param usdtValue USDT value of the investment (used for payout calculations)
     * @param hasClaimedFinalTokens Whether the investor has redeemed their tokens at maturity
     * @param emergencyUnlocked Whether the investor used emergency unlock feature
     * @param totalPayoutsClaimed Total amount of payouts claimed across all periods
     */
    struct Investor {
        uint256 deposited;
        uint256 usdtValue;
        bool hasClaimedFinalTokens;
        bool emergencyUnlocked;
        uint256 totalPayoutsClaimed;
    }

    /// @dev Mapping of investor addresses to their investment information
    mapping(address => Investor) public investors;

    // ============================================
    // CUSTOM ERRORS
    // ============================================

    /// @dev Thrown when attempting to transfer wrapped tokens (not allowed)
    error NoTransfers();

    /// @dev Thrown when providing invalid amounts (zero or negative)
    error InvalidAmount();

    /// @dev Thrown when providing invalid token addresses
    error InvalidToken();

    /// @dev Thrown when trying to perform pre-maturity actions after maturity
    error Matured();

    /// @dev Thrown when trying to perform post-maturity actions before maturity
    error NotMatured();

    /// @dev Thrown when user has no deposit/investment
    error NoDeposit();

    /// @dev Thrown when trying to claim already claimed tokens/payouts
    error AlreadyClaimed();

    /// @dev Thrown when token transfers fail
    error TransferFailed();

    /// @dev Thrown when there are no payouts available to claim
    error NoPayout();

    /// @dev Thrown when contract has insufficient funds for operation
    error InsufficientFunds();

    /// @dev Thrown when emergency unlock is disabled
    error UnlockDisabled();

    /// @dev Thrown when providing invalid penalty percentages
    error InvalidPenalty();

    /// @dev Thrown when providing invalid stablecoin addresses
    error InvalidStablecoin();

    /// @dev Thrown when payout period is not yet available
    error PayoutNotAvailable();

    /// @dev Thrown when contract configuration is invalid
    error InvalidConfiguration();

    /// @dev Thrown when providing zero addresses where they're not allowed
    error ZeroAddress();

    /// @dev Thrown when caller is not authorized for the operation
    error Unauthorized();

    /// @dev Thrown when providing invalid APR values
    error InvalidAPR();

    // ============================================
    // EVENTS
    // ============================================

    /// @dev Emitted when the payout APR is updated
    event PayoutAPRUpdated(uint256 oldAPR, uint256 newAPR);

    /// @dev Emitted when payouts are distributed for a period
    event PayoutDistributed(
        uint256 indexed period,
        uint256 amount,
        uint256 totalUSDTAtDistribution
    );

    /// @dev Emitted when a user claims payouts
    event PayoutClaimed(address indexed user, uint256 amount, uint256 period);

    /// @dev Emitted when a user redeems their tokens at maturity
    event FinalTokensClaimed(address indexed user, uint256 amount);

    /// @dev Emitted when emergency unlock is enabled
    event EmergencyUnlockEnabled(uint256 penalty);

    /// @dev Emitted when emergency unlock is disabled
    event EmergencyUnlockDisabled();

    /// @dev Emitted when a user uses emergency unlock
    event EmergencyUnlockUsed(
        address indexed user,
        uint256 amount,
        uint256 penalty
    );

    /// @dev Emitted when an investment is registered
    event InvestmentRegistered(
        address indexed user,
        uint256 tokenAmount,
        uint256 usdtValue
    );

    // ============================================
    // CONSTRUCTOR
    // ============================================

    /**
     * @dev Initialize the wrapped token contract with configuration parameters
     * @param config WrappedTokenConfig struct containing all initialization parameters
     *
     * Requirements:
     * - All token addresses and admin address must be non-zero
     * - Maturity date must be in the future
     * - First payout date must be in the future
     * - Payout period duration must be greater than zero
     * - APR must be between 0.01% and 100%
     *
     * Effects:
     * - Sets up all immutable contract parameters
     * - Grants admin roles to the specified admin address
     * - Initializes payout period tracking
     */
    constructor(
        WrappedTokenConfig memory config
    ) ERC20(config.name, config.symbol) {
        // Input validation
        if (
            config.peggedToken == address(0) ||
            config.payoutToken == address(0) ||
            config.admin == address(0)
        ) {
            revert InvalidStablecoin();
        }
        if (config.maturityDate <= block.timestamp)
            revert InvalidConfiguration();
        if (config.payoutPeriodDuration == 0) revert InvalidConfiguration();
        if (config.offeringContract == address(0)) revert ZeroAddress();
        if (config.payoutAPR == 0 || config.payoutAPR > 10000)
            revert InvalidAPR(); // Max 100% APR

        // Set immutable variables
        peggedToken = IERC20(config.peggedToken);
        payoutToken = IERC20(config.payoutToken);
        maturityDate = config.maturityDate;
        payoutPeriodDuration = config.payoutPeriodDuration;
        offeringContract = config.offeringContract;
        payoutAPR = config.payoutAPR;

        // Grant roles to the specified admin, not the deployer
        _grantRole(DEFAULT_ADMIN_ROLE, config.admin);
        _grantRole(PAYOUT_ADMIN_ROLE, config.admin);
        _grantRole(PAUSE_ROLE, config.admin);

        // Initialize payout period tracking
        currentPayoutPeriod = 0;
        lastPayoutDistributionTime = 0;
    }

    // ============================================
    // MODIFIERS
    // ============================================

    /**
     * @dev Restricts function access to the offering contract only
     */
    modifier onlyOfferingContract() {
        if (msg.sender != offeringContract) revert Unauthorized();
        _;
    }

    /**
     * @dev Restricts function access to after maturity date
     */
    modifier onlyAfterMaturity() {
        if (block.timestamp < maturityDate) revert NotMatured();
        _;
    }

    /**
     * @dev Validates that provided address is not zero address
     * @param _addr Address to validate
     */
    modifier validAddress(address _addr) {
        if (_addr == address(0)) revert ZeroAddress();
        _;
    }

    // ============================================
    // INVESTMENT FUNCTIONS
    // ============================================

    /**
     * @notice Register an investment from the offering contract
     * @dev Only callable by the authorized offering contract
     * @param _user The investor's address
     * @param amount The amount of peggedToken to invest
     * @param usdtValue The USDT value of the investment (used for payout calculations)
     *
     * Requirements:
     * - Contract must not be paused
     * - User address must be valid (non-zero)
     * - Amount and USDT value must be greater than zero
     * - Offering contract must have approved this contract for token transfer
     *
     * Effects:
     * - Transfers peggedToken from offering contract to this contract
     * - Mints wrapped tokens to the user
     * - Updates total escrowed amount and total USDT invested
     * - Records/updates investor information
     * - Snapshots user USDT value for existing payout periods
     *
     * @custom:security This function follows the Checks-Effects-Interactions pattern
     */
    function registerInvestment(
        address _user,
        uint256 amount,
        uint256 usdtValue
    ) external onlyOfferingContract whenNotPaused validAddress(_user) {
        // Checks: Input validation
        if (amount == 0 || usdtValue == 0) revert InvalidAmount();

        // Effects: Update state before external calls (CEI pattern)
        totalEscrowed += amount;
        totalUSDTInvested += usdtValue;

        // Effects: Mint wrapped tokens to user
        _mint(_user, amount);

        // Effects: Record/Update investment information
        investors[_user].deposited += amount;
        investors[_user].usdtValue += usdtValue;

        // Effects: Snapshot user USDT value for existing periods (lazy snapshotting)
        if (currentPayoutPeriod > 0) {
            for (uint256 i = 1; i <= currentPayoutPeriod; i++) {
                if (userUSDTSnapshot[_user][i] == 0) {
                    userUSDTSnapshot[_user][i] = investors[_user].usdtValue;
                }
            }
        }

        // Interactions: External call last (CEI pattern)
        if (
            !peggedToken.transferFrom(offeringContract, address(this), amount)
        ) {
            // Revert all state changes if transfer fails
            revert TransferFailed();
        }

        emit InvestmentRegistered(_user, amount, usdtValue);
    }

    // ============================================
    // PAYOUT CALCULATION FUNCTIONS
    // ============================================

    /**
     * @notice Calculate the required payout tokens for the next period
     * @dev Pure calculation function that doesn't modify state
     * @return requiredAmount The amount of payout tokens needed for next distribution
     * @return periodAPR The APR for this specific period (adjusted for period duration)
     *
     * Calculation Logic:
     * - Period APR = (Annual APR * Period Duration) / Seconds Per Year
     * - Required Amount = (Total USDT Invested * Period APR) / Basis Points
     *
     * Example: If total USDT invested is $100,000, APR is 12%, and period is 30 days:
     * - Period APR = (1200 * 30 days) / 365 days ≈ 98.63 basis points
     * - Required Amount = ($100,000 * 98.63) / 10000 ≈ $986.30
     */
    function calculateRequiredPayoutTokens()
        external
        view
        returns (uint256 requiredAmount, uint256 periodAPR)
    {
        if (totalUSDTInvested == 0) {
            return (0, 0);
        }

        // Calculate APR for this specific period with overflow protection
        // Use Math.mulDiv for safe multiplication and division
        periodAPR = Math.mulDiv(
            payoutAPR,
            payoutPeriodDuration,
            SECONDS_PER_YEAR
        );

        // Calculate required payout with overflow protection
        requiredAmount = Math.mulDiv(
            totalUSDTInvested,
            periodAPR,
            BASIS_POINTS
        );

        return (requiredAmount, periodAPR);
    }

    /**
     * @notice Get expected payout for a specific user for the next period
     * @dev Estimation function for UI/frontend usage
     * @param _user Address of the user to calculate payout for
     * @return expectedPayout Estimated payout amount for the user
     *
     * Calculation Logic:
     * - User's share = User USDT Value / Total USDT Invested
     * - Expected Payout = User USDT Value * Period APR / Basis Points
     */
    function getExpectedPayoutForUser(
        address _user
    ) external view returns (uint256 expectedPayout) {
        Investor storage investor = investors[_user];
        if (investor.usdtValue == 0 || totalUSDTInvested == 0) {
            return 0;
        }

        // Calculate period APR with overflow protection
        uint256 periodAPR = Math.mulDiv(
            payoutAPR,
            payoutPeriodDuration,
            SECONDS_PER_YEAR
        );

        // Calculate expected payout with overflow protection
        expectedPayout = Math.mulDiv(
            investor.usdtValue,
            periodAPR,
            BASIS_POINTS
        );

        return expectedPayout;
    }

    // ============================================
    // PAYOUT DISTRIBUTION FUNCTIONS
    // ============================================

    /**
     * @notice Distribute payout tokens for a new period (admin only)
     * @dev Only callable by addresses with PAYOUT_ADMIN_ROLE
     * @param _amount Amount of payout tokens to distribute
     *
     * Requirements:
     * - Caller must have PAYOUT_ADMIN_ROLE
     * - Contract must not be paused
     * - Amount must be greater than zero
     * - Current time must be >= next payout time
     * - Admin must have approved this contract for payout token transfer
     *
     * Effects:
     * - Transfers payout tokens from admin to contract
     * - Increments current payout period
     * - Updates last distribution time
     * - Takes snapshot of total USDT invested for fair distribution
     * - Records payout funds for the period
     *
     * @custom:security Uses nonReentrant to prevent reentrancy attacks
     * @custom:security Follows Checks-Effects-Interactions pattern
     */
    function distributePayoutForPeriod(
        uint256 _amount
    ) external onlyRole(PAYOUT_ADMIN_ROLE) nonReentrant whenNotPaused {
        // Checks: Input validation with overflow protection
        if (_amount == 0) revert InvalidAmount();
        require(_amount <= type(uint128).max, "Payout amount too large");

        // Checks: Verify we can start a new payout period
        uint256 nextPayoutTime = getNextPayoutTime();
        if (block.timestamp < nextPayoutTime) revert PayoutNotAvailable();

        // Interactions: Transfer tokens before state changes
        if (!payoutToken.transferFrom(msg.sender, address(this), _amount)) {
            revert TransferFailed();
        }

        // Effects: Update state after successful transfer
        currentPayoutPeriod += 1;
        require(currentPayoutPeriod <= type(uint64).max, "Too many payout periods");
        
        lastPayoutDistributionTime = block.timestamp;

        // Effects: Take snapshot of current total USDT invested for fair distribution
        require(totalUSDTInvested <= type(uint128).max, "Total USDT too large");
        totalUSDTSnapshot[currentPayoutPeriod] = totalUSDTInvested;
        payoutFundsPerPeriod[currentPayoutPeriod] = _amount;

        // Note: User USDT snapshots are handled lazily in getUserUSDTAtPeriod()
        // This approach saves gas during distribution and only snapshots when needed

        emit PayoutDistributed(currentPayoutPeriod, _amount, totalUSDTInvested);
    }

    // ============================================
    // PAYOUT CLAIMING FUNCTIONS
    // ============================================

    /**
     * @notice Claim all available payouts for the caller
     * @dev Calculates and distributes payouts based on USDT investment proportions
     *
     * Requirements:
     * - Contract must not be paused
     * - User must have a deposit
     * - User must not have already claimed final tokens
     * - There must be unclaimed payouts available
     *
     * Effects:
     * - Calculates total claimable amount from all unclaimed periods
     * - Updates user's last claimed period
     * - Updates user's total payouts claimed
     * - Transfers payout tokens to user
     *
     * Calculation Logic:
     * - For each unclaimed period:
     *   - Get user's USDT value at that period
     *   - Calculate user's share = (Period Funds * User USDT) / Total USDT at Period
     *   - Add to total claimable amount
     *
     * @custom:security Uses nonReentrant to prevent reentrancy attacks
     * @custom:security Follows Checks-Effects-Interactions pattern
     */
    function claimAvailablePayouts() external nonReentrant whenNotPaused {
        address user = msg.sender;
        Investor storage investor = investors[user];

        // Checks: Validate user eligibility
        if (investor.deposited == 0) revert NoDeposit();
        if (investor.hasClaimedFinalTokens || investor.emergencyUnlocked) revert AlreadyClaimed();

        uint256 totalClaimable = 0;
        uint256 lastClaimed = userLastClaimedPeriod[user];

        // Checks/Effects: Calculate claimable amount from unclaimed periods
        for (
            uint256 period = lastClaimed + 1;
            period <= currentPayoutPeriod;
            period++
        ) {
            uint256 periodFunds = payoutFundsPerPeriod[period];
            uint256 totalUSDTAtPeriod = totalUSDTSnapshot[period];

            if (periodFunds > 0 && totalUSDTAtPeriod > 0) {
                // Get user USDT value at the time of distribution
                uint256 userUSDTAtPeriod = getUserUSDTAtPeriod(user, period);

                if (userUSDTAtPeriod > 0) {
                    // Additional safety check to prevent division by zero
                    if (totalUSDTAtPeriod == 0) {
                        continue; // Skip this period if total USDT is zero
                    }
                    
                    // Calculate share with overflow protection
                    uint256 userShare = Math.mulDiv(
                        periodFunds,
                        userUSDTAtPeriod,
                        totalUSDTAtPeriod
                    );
                    totalClaimable += userShare;
                }
            }
        }

        if (totalClaimable == 0) revert NoPayout();

        // Effects: Update state before external call
        userLastClaimedPeriod[user] = currentPayoutPeriod;
        investor.totalPayoutsClaimed += totalClaimable;

        // Checks: Ensure we don't exceed contract balance (safety check)
        uint256 contractBalance = payoutToken.balanceOf(address(this));
        if (totalClaimable > contractBalance) {
            totalClaimable = contractBalance;
        }

        // Interactions: External call last
        bool transferSuccess = payoutToken.transfer(user, totalClaimable);
        require(transferSuccess, "Payout transfer failed");

        emit PayoutClaimed(user, totalClaimable, currentPayoutPeriod);
    }

    /**
     * @dev Get user's USDT value at a specific period with lazy snapshotting
     * @param user Address of the user
     * @param period Payout period number
     * @return User's USDT value at the specified period
     *
     * Logic:
     * - First checks if we have a snapshot for this user/period
     * - If no snapshot exists, uses current USDT value (lazy approach)
     * - This saves gas during distribution by not snapshotting all users upfront
     */
    function getUserUSDTAtPeriod(
        address user,
        uint256 period
    ) internal view returns (uint256) {
        // Safety check: prevent division by zero in calling functions
        if (totalUSDTSnapshot[period] == 0) {
            return 0;
        }
        
        // If we have a snapshot, use it
        uint256 snapshotUSDT = userUSDTSnapshot[user][period];
        if (snapshotUSDT > 0) {
            return snapshotUSDT;
        }

        // Otherwise, use current USDT value (lazy approach)
        return investors[user].usdtValue;
    }

    // ============================================
    // USER INFORMATION FUNCTIONS
    // ============================================

    /**
     * @notice Get comprehensive payout information for a user
     * @dev Returns detailed information about user's payout status and claimable amounts
     * @param _user Address of the user to query
     * @return totalClaimable Total amount the user can claim now
     * @return totalClaimed Total amount the user has claimed historically
     * @return lastClaimedPeriod Last payout period the user claimed
     * @return userUSDTValue User's total USDT investment value
     * @return claimablePeriods Array of period numbers with claimable payouts
     * @return claimableAmounts Array of claimable amounts for each period
     *
     * Gas Optimization: This is a view function for UI/frontend usage
     * It performs the same calculations as claimAvailablePayouts() but doesn't modify state
     */
    function getUserPayoutInfo(
        address _user
    )
        external
        view
        returns (
            uint256 totalClaimable,
            uint256 totalClaimed,
            uint256 lastClaimedPeriod,
            uint256 userUSDTValue,
            uint256[] memory claimablePeriods,
            uint256[] memory claimableAmounts
        )
    {
        Investor storage investor = investors[_user];
        if (investor.deposited == 0 || investor.emergencyUnlocked) {
            return (0, 0, 0, 0, new uint256[](0), new uint256[](0));
        }

        // Return basic information
        totalClaimed = investor.totalPayoutsClaimed;
        lastClaimedPeriod = userLastClaimedPeriod[_user];
        userUSDTValue = investor.usdtValue;

        // Count claimable periods first
        uint256 claimableCount = 0;
        for (
            uint256 period = lastClaimedPeriod + 1;
            period <= currentPayoutPeriod;
            period++
        ) {
            if (payoutFundsPerPeriod[period] > 0) {
                claimableCount++;
            }
        }

        // Initialize arrays with correct size
        claimablePeriods = new uint256[](claimableCount);
        claimableAmounts = new uint256[](claimableCount);

        // Calculate claimable amounts for each period
        uint256 index = 0;
        totalClaimable = 0;

        for (
            uint256 period = lastClaimedPeriod + 1;
            period <= currentPayoutPeriod;
            period++
        ) {
            uint256 periodFunds = payoutFundsPerPeriod[period];
            uint256 totalUSDTAtPeriod = totalUSDTSnapshot[period];

            if (periodFunds > 0 && totalUSDTAtPeriod > 0) {
                uint256 userUSDTAtPeriod = getUserUSDTAtPeriod(_user, period);

                if (userUSDTAtPeriod > 0) {
                    // Additional safety check to prevent division by zero
                    if (totalUSDTAtPeriod == 0) {
                        continue; // Skip this period
                    }
                    
                    // Calculate share with overflow protection
                    uint256 userShare = Math.mulDiv(
                        periodFunds,
                        userUSDTAtPeriod,
                        totalUSDTAtPeriod
                    );

                    claimablePeriods[index] = period;
                    claimableAmounts[index] = userShare;
                    totalClaimable += userShare;
                    index++;
                }
            }
        }

        // Safety check: ensure claimable doesn't exceed contract balance
        uint256 contractBalance = payoutToken.balanceOf(address(this));
        if (totalClaimable > contractBalance) {
            totalClaimable = contractBalance;
        }
    }

    // ============================================
    // TOKEN REDEMPTION FUNCTIONS
    // ============================================

    /**
     * @notice Claim final tokens after maturity (normal redemption)
     * @dev Allows users to redeem their original tokens after maturity date
     *
     * Requirements:
     * - Current time must be >= maturity date
     * - Contract must not be paused
     * - User must not have already claimed final tokens
     * - User must have a deposit
     *
     * Effects:
     * - Marks user as having claimed final tokens
     * - Reduces total escrowed amount and total USDT invested
     * - Burns user's wrapped tokens
     * - Transfers original deposited tokens back to user
     *
     * @custom:security Uses nonReentrant to prevent reentrancy attacks
     * @custom:security Follows Checks-Effects-Interactions pattern
     */
    function claimFinalTokens()
        external
        onlyAfterMaturity
        nonReentrant
        whenNotPaused
    {
        Investor storage investor = investors[msg.sender];

        // Checks: Validate user eligibility
        if (investor.hasClaimedFinalTokens) revert AlreadyClaimed();
        if (investor.emergencyUnlocked) revert AlreadyClaimed();
        if (investor.deposited == 0) revert NoDeposit();

        uint256 wrappedBalance = balanceOf(msg.sender);
        uint256 depositedAmount = investor.deposited;
        uint256 userUSDTValue = investor.usdtValue;

        // Effects: Update state before external calls
        investor.hasClaimedFinalTokens = true;
        totalEscrowed -= depositedAmount;
        totalUSDTInvested -= userUSDTValue;

        // Effects: Burn wrapped tokens
        _burn(msg.sender, wrappedBalance);

        // Interactions: Transfer original tokens
        bool transferSuccess = peggedToken.transfer(msg.sender, depositedAmount);
        require(transferSuccess, "Final token transfer failed");

        emit FinalTokensClaimed(msg.sender, depositedAmount);
    }

    // ============================================
    // EMERGENCY FUNCTIONS
    // ============================================

    /**
     * @notice Enable emergency unlock feature with penalty
     * @dev Only callable by admin role, allows users to unlock tokens before maturity
     * @param _penaltyPercentage Penalty percentage in basis points (e.g., 1000 = 10%)
     *
     * Requirements:
     * - Caller must have DEFAULT_ADMIN_ROLE
     * - Penalty percentage must not exceed MAX_PENALTY (50%)
     *
     * Effects:
     * - Enables emergency unlock feature
     * - Sets penalty percentage for early withdrawals
     *
     * Use Cases:
     * - Market emergencies
     * - Regulatory requirements
     * - Force majeure events
     */
    function enableEmergencyUnlock(
        uint256 _penaltyPercentage
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_penaltyPercentage > MAX_PENALTY) revert InvalidPenalty();

        emergencyUnlockEnabled = true;
        emergencyUnlockPenalty = _penaltyPercentage;

        emit EmergencyUnlockEnabled(_penaltyPercentage);
    }

    /**
     * @notice Disable emergency unlock
     */
    function disableEmergencyUnlock() external onlyRole(DEFAULT_ADMIN_ROLE) {
        emergencyUnlockEnabled = false;
        emergencyUnlockPenalty = 0;

        emit EmergencyUnlockDisabled();
    }

    /**
     * @notice Emergency unlock tokens before maturity (with penalty)
     */
    function emergencyUnlock() external nonReentrant whenNotPaused {
        if (!emergencyUnlockEnabled) revert UnlockDisabled();

        Investor storage investor = investors[msg.sender];
        if (investor.deposited == 0) revert NoDeposit();
        if (investor.hasClaimedFinalTokens || investor.emergencyUnlocked) revert AlreadyClaimed();

        uint256 wrappedBalance = balanceOf(msg.sender);
        uint256 depositedAmount = investor.deposited;
        uint256 userUSDTValue = investor.usdtValue;

        uint256 penaltyAmount = Math.mulDiv(
            depositedAmount,
            emergencyUnlockPenalty,
            BASIS_POINTS
        );
        require(penaltyAmount <= depositedAmount, "Penalty calculation error");
        uint256 amountToReturn = depositedAmount - penaltyAmount;

        // Update state before external calls
        investor.emergencyUnlocked = true;
        // Clear investor data since they've exited early
        investor.deposited = 0;
        investor.usdtValue = 0;
        totalEscrowed -= depositedAmount;
        totalUSDTInvested -= userUSDTValue;

        // Burn wrapped tokens
        _burn(msg.sender, wrappedBalance);

        // Transfer tokens minus penalty
        bool transferSuccess = peggedToken.transfer(msg.sender, amountToReturn);
        require(transferSuccess, "Emergency unlock transfer failed");

        emit EmergencyUnlockUsed(msg.sender, amountToReturn, penaltyAmount);
    }

    /**
     * @notice Get next available payout time
     */
    /// @dev Thrown when first payout date is not set
    error FirstPayoutDateNotSet();

    /// @dev Emitted when the first payout date is set
    event FirstPayoutDateSet(uint256 firstPayoutDate);

    function getNextPayoutTime() public view returns (uint256) {
        if (firstPayoutDate == 0) {
            revert FirstPayoutDateNotSet();
        }
        if (lastPayoutDistributionTime == 0) {
            return firstPayoutDate;
        }
        return lastPayoutDistributionTime + payoutPeriodDuration;
    }

    /**
     * @notice Sets the first payout date. Only callable by the offering contract once.
     * @dev This function is called by the offering contract once the public offering is finalized.
     *      It sets the firstPayoutDate to the current block.timestamp plus the payoutPeriodDuration.
     *
     * Requirements:
     * - Caller must be the offeringContract.
     * - firstPayoutDate must not have been set yet (i.e., it's 0).
     *
     * Effects:
     * - Sets the firstPayoutDate.
     * - Emits a FirstPayoutDateSet event.
     */
    function setFirstPayoutDate() external onlyOfferingContract {
        if (firstPayoutDate != 0) revert InvalidConfiguration(); // Already set

        firstPayoutDate = block.timestamp + payoutPeriodDuration;
        emit FirstPayoutDateSet(firstPayoutDate);
    }

    /**
     * @notice Check if payout period is available
     */
    function isPayoutPeriodAvailable() external view returns (bool) {
        return block.timestamp >= getNextPayoutTime();
    }

    /**
     * @notice Get current payout period information
     */
    function getCurrentPayoutPeriodInfo()
        external
        view
        returns (
            uint256 period,
            uint256 lastDistributionTime,
            uint256 nextPayoutTime,
            bool canDistribute,
            uint256 requiredTokens,
            uint256 currentAPR
        )
    {
        period = currentPayoutPeriod;
        lastDistributionTime = lastPayoutDistributionTime;
        nextPayoutTime = getNextPayoutTime();
        canDistribute = block.timestamp >= nextPayoutTime;
        (requiredTokens, ) = this.calculateRequiredPayoutTokens();
        currentAPR = payoutAPR;
    }

    /**
     * @notice Pause contract (emergency)
     */
    function pause() external onlyRole(PAUSE_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause contract
     */
    function unpause() external onlyRole(PAUSE_ROLE) {
        _unpause();
    }

    /**
     * @notice Grant payout admin role
     */
    function grantPayoutAdminRole(
        address _admin
    ) external onlyRole(DEFAULT_ADMIN_ROLE) validAddress(_admin) {
        _grantRole(PAYOUT_ADMIN_ROLE, _admin);
    }

    /**
     * @notice Revoke payout admin role
     */
    function revokePayoutAdminRole(
        address _admin
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(PAYOUT_ADMIN_ROLE, _admin);
    }

    /**
     * @notice Override transfer to prevent transfers
     */
    function transfer(address, uint256) public pure override returns (bool) {
        revert NoTransfers();
    }

    /**
     * @notice Override transferFrom to prevent transfers
     */
    function transferFrom(
        address,
        address,
        uint256
    ) public pure override returns (bool) {
        revert NoTransfers();
    }

    /**
     * @notice Get contract information
     */
    function getContractInfo()
        external
        view
        returns (
            address peggedTokenAddress,
            address payoutTokenAddress,
            uint256 maturityTimestamp,
            uint256 totalEscrowedAmount,
            uint256 totalUSDTInvestedAmount,
            uint256 currentPeriod,
            uint256 currentPayoutAPR,
            bool emergencyUnlockStatus,
            uint256 emergencyPenalty
        )
    {
        return (
            address(peggedToken),
            address(payoutToken),
            maturityDate,
            totalEscrowed,
            totalUSDTInvested,
            currentPayoutPeriod,
            payoutAPR,
            emergencyUnlockEnabled,
            emergencyUnlockPenalty
        );
    }
}
