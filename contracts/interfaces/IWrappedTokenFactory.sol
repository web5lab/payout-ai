// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {WrappedTokenConfig} from "../structs/WrappedTokenConfig.sol";

interface IWrappedTokenFactory {
    function createWrappedToken(
        WrappedTokenConfig memory config
    ) external returns (address wrappedTokenAddress);

    function getWrappedTokenAddress(
        uint256 tokenId
    ) external view returns (address);

    function getWrappedTokenCreator(
        address wrappedTokenAddress
    ) external view returns (address);

    function getWrappedTokenIdsByCreator(
        address creator
    ) external view returns (uint256[] memory);

    function getAllWrappedTokens() external view returns (address[] memory);
}
