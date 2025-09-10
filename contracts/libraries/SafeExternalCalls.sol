// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IExternalCallSafety.sol";

/**
 * @title SafeExternalCalls
 * @dev Library for safe external calls with proper error handling
 */
library SafeExternalCalls {
    uint256 private constant MAX_GAS_FOR_ETH_TRANSFER = 50000;
    uint256 private constant MAX_GAS_FOR_CONTRACT_CALL = 100000;

    error ETHTransferFailed(address to, uint256 amount, string reason);
    error TokenTransferFailed(address token, address to, uint256 amount, string reason);
    error ContractCallFailed(address target, string functionName, string reason);

    /**
     * @dev Safely transfer ETH with gas limit and proper error handling
     * @param to Recipient address
     * @param amount Amount to transfer
     */
    function safeTransferETH(address to, uint256 amount) internal {
        require(to != address(0), "Invalid recipient");
        require(address(this).balance >= amount, "Insufficient ETH balance");
        
        (bool success, bytes memory returnData) = payable(to).call{
            value: amount,
            gas: MAX_GAS_FOR_ETH_TRANSFER
        }("");
        
        if (!success) {
            string memory reason = "Unknown error";
            if (returnData.length > 0) {
                assembly {
                    let returnDataSize := mload(returnData)
                    let returnDataPtr := add(returnData, 0x20)
                    reason := mload(returnDataPtr)
                }
            }
            revert ETHTransferFailed(to, amount, reason);
        }
    }

    /**
     * @dev Safely transfer ERC20 tokens with proper validation
     * @param token Token contract address
     * @param to Recipient address
     * @param amount Amount to transfer
     */
    function safeTransferERC20(address token, address to, uint256 amount) internal {
        require(token != address(0), "Invalid token");
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");
        
        // Check balance before transfer
        uint256 contractBalance = IERC20(token).balanceOf(address(this));
        require(contractBalance >= amount, "Insufficient token balance");
        
        try IERC20(token).transfer(to, amount) returns (bool success) {
            require(success, "Token transfer returned false");
            
            // Verify the transfer actually happened (protection against non-standard tokens)
            uint256 newBalance = IERC20(token).balanceOf(address(this));
            require(newBalance == contractBalance - amount, "Transfer amount mismatch");
            
        } catch Error(string memory reason) {
            revert TokenTransferFailed(token, to, amount, reason);
        } catch (bytes memory) {
            revert TokenTransferFailed(token, to, amount, "Unknown error");
        }
    }

    /**
     * @dev Safely transfer ERC20 tokens from one address to another
     * @param token Token contract address
     * @param from Sender address
     * @param to Recipient address
     * @param amount Amount to transfer
     */
    function safeTransferFromERC20(
        address token,
        address from,
        address to,
        uint256 amount
    ) internal {
        require(token != address(0), "Invalid token");
        require(from != address(0), "Invalid sender");
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");
        
        // Check allowance
        uint256 allowance = IERC20(token).allowance(from, address(this));
        require(allowance >= amount, "Insufficient allowance");
        
        // Check sender balance
        uint256 senderBalance = IERC20(token).balanceOf(from);
        require(senderBalance >= amount, "Insufficient sender balance");
        
        try IERC20(token).transferFrom(from, to, amount) returns (bool success) {
            require(success, "TransferFrom returned false");
        } catch Error(string memory reason) {
            revert TokenTransferFailed(token, to, amount, reason);
        } catch (bytes memory) {
            revert TokenTransferFailed(token, to, amount, "Unknown error");
        }
    }

    /**
     * @dev Safely approve ERC20 tokens with proper validation
     * @param token Token contract address
     * @param spender Spender address
     * @param amount Amount to approve
     */
    function safeApproveERC20(address token, address spender, uint256 amount) internal {
        require(token != address(0), "Invalid token");
        require(spender != address(0), "Invalid spender");
        
        try IERC20(token).approve(spender, amount) returns (bool success) {
            require(success, "Approval returned false");
        } catch Error(string memory reason) {
            revert TokenTransferFailed(token, spender, amount, reason);
        } catch (bytes memory) {
            revert TokenTransferFailed(token, spender, amount, "Approval failed");
        }
    }

    /**
     * @dev Safely call external contract with gas limit
     * @param target Target contract address
     * @param data Call data
     * @param gasLimit Gas limit for the call
     * @return success Whether the call succeeded
     * @return returnData Return data from the call
     */
    function safeContractCall(
        address target,
        bytes memory data,
        uint256 gasLimit
    ) internal returns (bool success, bytes memory returnData) {
        require(target != address(0), "Invalid target");
        require(target.code.length > 0, "Target is not a contract");
        
        if (gasLimit == 0) {
            gasLimit = MAX_GAS_FOR_CONTRACT_CALL;
        }
        
        (success, returnData) = target.call{gas: gasLimit}(data);
    }

    /**
     * @dev Safely call external contract and revert on failure
     * @param target Target contract address
     * @param data Call data
     * @param functionName Function name for error reporting
     */
    function safeContractCallWithRevert(
        address target,
        bytes memory data,
        string memory functionName
    ) internal {
        (bool success, bytes memory returnData) = safeContractCall(target, data, 0);
        
        if (!success) {
            string memory reason = "Unknown error";
            if (returnData.length > 0) {
                assembly {
                    let returnDataSize := mload(returnData)
                    let returnDataPtr := add(returnData, 0x20)
                    reason := mload(returnDataPtr)
                }
            }
            revert ContractCallFailed(target, functionName, reason);
        }
    }
}