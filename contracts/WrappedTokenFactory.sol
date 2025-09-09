// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./WrapedToken.sol";

/**
 * @title WrappedTokenFactory
 * @dev Factory contract to deploy and manage WrappedToken contracts.
 */
contract WrappedTokenFactory is Ownable {
    uint256 public count;
    mapping(uint256 => address) public wrappedTokens;
    mapping(address => address) public creators;
    mapping(address => uint256[]) public byCreator;

    event WrappedTokenDeployed(
        uint256 indexed tokenId,
        address indexed creator,
        address indexed wrappedTokenAddress,
        address offeringContract
    );

    constructor() Ownable(msg.sender) {}

    function createWrappedToken(
        WrapedTokenConfig memory config
    ) external returns (address wrappedTokenAddress) {
        // Validate payout period configuration
        require(config.payoutPeriodDuration > 0, "Invalid payout period");
        require(config.firstPayoutDate > block.timestamp, "First payout must be in future");
        
        WRAPEDTOKEN wrappedToken = new WRAPEDTOKEN(config);
        wrappedTokenAddress = address(wrappedToken);

        // Grant DEFAULT_ADMIN_ROLE to the original caller (not the factory)
        bytes32 DEFAULT_ADMIN_ROLE = wrappedToken.DEFAULT_ADMIN_ROLE();
        wrappedToken.grantRole(DEFAULT_ADMIN_ROLE, config.admin);

        wrappedTokens[count] = wrappedTokenAddress;
        creators[wrappedTokenAddress] = msg.sender;
        byCreator[msg.sender].push(count);

        emit WrappedTokenDeployed(
            count,
            msg.sender,
            wrappedTokenAddress,
            config.offeringContract
        );
        count++;
    }

    function getWrappedTokenAddress(
        uint256 tokenId
    ) external view returns (address) {
        return wrappedTokens[tokenId];
    }

    function getWrappedTokenCreator(
        address wrappedTokenAddress
    ) external view returns (address) {
        return creators[wrappedTokenAddress];
    }

    function getWrappedTokenIdsByCreator(
        address creator
    ) external view returns (uint256[] memory) {
        return byCreator[creator];
    }

    function getAllWrappedTokens() external view returns (address[] memory) {
        address[] memory result = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = wrappedTokens[i];
        }
        return result;
    }
}
