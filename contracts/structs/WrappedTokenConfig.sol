// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title WrappedTokenConfig
 * @dev Configuration structure for initializing wrapped tokens
 * @param name The name of the wrapped token (e.g., "Wrapped USDT Q1 2025")
 * @param symbol The symbol of the wrapped token (e.g., "wUSDT-Q1-25")
 * @param peggedToken Address of the underlying token to be wrapped (e.g., USDT)
 * @param payoutToken Address of the token used for periodic payouts (e.g., USDC)
 * @param payoutAPR Annual Percentage Rate for payouts in basis points (1200 = 12% APR)
 * @param offeringContract Address of the contract that handles initial token offerings
 * @param admin Address that will receive admin roles for contract management
 * @param payoutPeriodDuration Duration between payouts in seconds (e.g., 30 days)
 */
struct WrappedTokenConfig {
    string name;
    string symbol;
    address peggedToken;
    address payoutToken;
    uint256 payoutAPR;
    address offeringContract;
    address admin;
    uint256 payoutPeriodDuration;
    uint256 totalPayoutRound;
}
