// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

contract WRAPEDTOKEN is ERC20, ERC20Burnable {
    enum PayoutFrequency {
        Daily,
        Monthly,
        Yearly
    }

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

    mapping(address => Investor) public investors;

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

    constructor(
        string memory name,
        string memory symbol,
        address _peggedToken,
        address _payoutToken, // New parameter for payout token
        uint256 _maturityDate,
        uint256 _payoutRate, // New parameter for payout rate
        address _offeringContract
    ) ERC20(name, symbol) {
        if (_peggedToken == address(0) || _payoutToken == address(0))
            revert InvalidStablecoin(); // Renamed error for clarity
        peggedToken = IERC20(_peggedToken);
        payoutToken = IERC20(_payoutToken);
        maturityDate = _maturityDate;
        payoutRate = _payoutRate;
        offeringContract = _offeringContract;
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
