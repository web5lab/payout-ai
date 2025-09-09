// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockV3Aggregator
 * @dev A simple mock for API3 reader proxy for testing Offering contract.
 *      CORRECTED to match the IApi3ReaderProxy interface (returns int224).
 */
contract MockV3Aggregator {
    // Changed from uint256 to int224 for type consistency
    int224 private price;
    bool private fresh;

    // Changed parameter from uint256 to int224
    constructor(int224 _price, bool _fresh) {
        price = _price;
        fresh = _fresh;
    }

    // Changed parameter from uint256 to int224
    function setPrice(int224 _price) external {
        price = _price;
    }

    function setFresh(bool _fresh) external {
        fresh = _fresh;
    }

    // CRITICAL FIX: Changed return type from uint256 to int224
    function read() external view returns (int224, uint32) {
        uint32 timestamp = fresh ? uint32(block.timestamp) : uint32(block.timestamp - 4000);
        return (price, timestamp);
    }
}