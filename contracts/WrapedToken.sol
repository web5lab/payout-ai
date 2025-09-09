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

    // Role definitions
    bytes32 public constant PAYOUT_ADMIN_ROLE = keccak256("PAYOUT_ADMIN_ROLE");

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

    // Multi-payout system
    struct PayoutRound {
        uint256 totalAmount;
        uint256 claimedAmount;
        uint256 roundNumber;
        bool isActive;
        mapping(address => uint256) claimedByUser;
    }

    mapping(address => Investor) public investors;
    mapping(uint256 => PayoutRound) public payoutRounds;
    uint256 public currentRoundNumber;
    uint256 public totalPayoutFunds;

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
    error PayoutRoundNotActive();
    error InsufficientPayoutFunds();

    event PayoutRoundCreated(uint256 indexed roundNumber, uint256 totalAmount);
    event PayoutClaimed(address indexed user, uint256 indexed roundNumber, uint256 amount);
    event IndividualPayoutClaimed(address indexed user, uint256 amount);
    event FinalTokensClaimed(address indexed user, uint256 amount);

    constructor(WrapedTokenConfig memory config) ERC20(config.name, config.symbol) {
        if (config.peggedToken == address(0) || config.payoutToken == address(0))
            revert InvalidStablecoin();
        peggedToken = IERC20(config.peggedToken);
        payoutToken = IERC20(config.payoutToken);
        maturityDate = config.maturityDate;
        payoutRate = config.payoutRate;
        offeringContract = config.offeringContract;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PAYOUT_ADMIN_ROLE, msg.sender);
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
        if (amount == 0) revert InvalidAmount();

        bool success = peggedToken.transferFrom(
            offeringContract,
            address(this),
            amount
        );
        if (!success) revert TokenTransferFailed();

        _mint(_user, amount);

        uint256 calculatedPayoutAmountPerPeriod = (amount * payoutRate) / 10000;

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

    // Individual payout claim (original functionality)
    function claimPayout() external {
        Investor storage user = investors[msg.sender];
        if (user.deposited == 0) revert NoDeposit();
        if (user.hasClaimedTokens) revert AlreadyClaimed();

        uint256 payoutPeriodSeconds = _getPayoutPeriodSeconds(user.payoutFrequency);
        if (payoutPeriodSeconds == 0) revert NoPayoutDue();

        uint256 timeElapsed = block.timestamp - user.lastPayoutTime;
        if (timeElapsed < payoutPeriodSeconds) revert PayoutPeriodNotElapsed();

        uint256 periodsPassed = timeElapsed / payoutPeriodSeconds;
        uint256 totalPayoutDue = periodsPassed * user.payoutAmountPerPeriod;

        if (user.totalPayoutsClaimed + totalPayoutDue > user.deposited) {
            totalPayoutDue = user.deposited - user.totalPayoutsClaimed;
        }

        if (totalPayoutDue == 0) revert NoPayoutDue();

        user.lastPayoutTime += periodsPassed * payoutPeriodSeconds;
        user.totalPayoutsClaimed += totalPayoutDue;

        if (!payoutToken.transfer(msg.sender, totalPayoutDue))
            revert TokenTransferFailed();

        emit IndividualPayoutClaimed(msg.sender, totalPayoutDue);
    }

    // Admin creates a new payout round
    function createPayoutRound(uint256 _totalAmount) external onlyRole(PAYOUT_ADMIN_ROLE) nonReentrant {
        if (_totalAmount == 0) revert InvalidAmount();
        
        // Transfer payout tokens to this contract
        if (!payoutToken.transferFrom(msg.sender, address(this), _totalAmount))
            revert TokenTransferFailed();

        currentRoundNumber++;
        PayoutRound storage newRound = payoutRounds[currentRoundNumber];
        newRound.totalAmount = _totalAmount;
        newRound.claimedAmount = 0;
        newRound.roundNumber = currentRoundNumber;
        newRound.isActive = true;

        totalPayoutFunds += _totalAmount;

        emit PayoutRoundCreated(currentRoundNumber, _totalAmount);
    }

    // User claims from a specific payout round
    function claimFromPayoutRound(uint256 _roundNumber, uint256 _claimAmount) external nonReentrant {
        PayoutRound storage round = payoutRounds[_roundNumber];
        
        if (!round.isActive) revert PayoutRoundNotActive();
        if (round.claimedByUser[msg.sender] > 0) revert AlreadyClaimed();
        if (_claimAmount == 0) revert InvalidAmount();
        if (round.claimedAmount + _claimAmount > round.totalAmount) revert InsufficientPayoutFunds();

        // Check if user has wrapped tokens (is an investor)
        if (balanceOf(msg.sender) == 0) revert NoDeposit();

        round.claimedAmount += _claimAmount;
        round.claimedByUser[msg.sender] = _claimAmount;

        if (!payoutToken.transfer(msg.sender, _claimAmount))
            revert TokenTransferFailed();

        emit PayoutClaimed(msg.sender, _roundNumber, _claimAmount);
    }

    // Get user's claim status for a round
    function getUserClaimForRound(uint256 _roundNumber, address _user) external view returns (uint256) {
        return payoutRounds[_roundNumber].claimedByUser[_user];
    }

    // Get remaining amount in a payout round
    function getRemainingAmountInRound(uint256 _roundNumber) external view returns (uint256) {
        PayoutRound storage round = payoutRounds[_roundNumber];
        return round.totalAmount - round.claimedAmount;
    }

    // Admin can deactivate a payout round
    function deactivatePayoutRound(uint256 _roundNumber) external onlyRole(PAYOUT_ADMIN_ROLE) {
        payoutRounds[_roundNumber].isActive = false;
    }

    function claimFinalTokens() external onlyAfterMaturity {
        Investor storage user = investors[msg.sender];
        if (user.hasClaimedTokens) revert AlreadyClaimed();
        if (user.deposited == 0) revert NoDeposit();

        uint256 wrappedBalance = balanceOf(msg.sender);
        _burn(msg.sender, wrappedBalance);

        user.hasClaimedTokens = true;
        if (!peggedToken.transfer(msg.sender, user.deposited))
            revert TokenTransferFailed();

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
    function grantPayoutAdminRole(address _admin) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(PAYOUT_ADMIN_ROLE, _admin);
    }

    // Revoke payout admin role
    function revokePayoutAdminRole(address _admin) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(PAYOUT_ADMIN_ROLE, _admin);
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