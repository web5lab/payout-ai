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
        WRAPEDTOKEN wrappedToken = new WRAPEDTOKEN(config);
        wrappedTokenAddress = address(wrappedToken);

        wrappedTokens[count] = wrappedTokenAddress;
        creators[wrappedTokenAddress] = msg.sender;
        byCreator[msg.sender].push(count);

        emit WrappedTokenDeployed(count, msg.sender, wrappedTokenAddress, config.offeringContract);
        count++;
    }

    function getWrappedTokenAddress(uint256 tokenId) external view returns (address) {
        return wrappedTokens[tokenId];
    }

    function getWrappedTokenCreator(address wrappedTokenAddress) external view returns (address) {
        return creators[wrappedTokenAddress];
    }

    function getWrappedTokenIdsByCreator(address creator) external view returns (uint256[] memory) {
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