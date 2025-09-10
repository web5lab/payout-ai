// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IInvestmentManager {
    function notifyRefundsEnabled(address _offeringContract) external;
    function claimRefund(address _offeringContract, address _token) external;
}
