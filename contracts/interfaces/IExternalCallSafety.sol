// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IExternalCallSafety
 * @dev Interface for safe external call utilities
 */
interface IExternalCallSafety {
    /**
     * @dev Emitted when an external call fails
     * @param target The target contract address
     * @param functionName The function that was called
     * @param reason The failure reason
     */
    event ExternalCallFailed(
        address indexed target,
        string functionName,
        string reason
    );

    /**
     * @dev Emitted when a token transfer fails
     * @param token The token contract address
     * @param to The recipient address
     * @param amount The transfer amount
     * @param reason The failure reason
     */
    event TransferFailed(
        address indexed token,
        address indexed to,
        uint256 amount,
        string reason
    );

    /**
     * @dev Emitted when an ETH transfer fails
     * @param to The recipient address
     * @param amount The transfer amount
     * @param reason The failure reason
     */
    event ETHTransferFailed(
        address indexed to,
        uint256 amount,
        string reason
    );
}