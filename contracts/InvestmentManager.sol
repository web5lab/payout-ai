// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./Offering.sol";

contract InvestmentManager is Ownable {
    event InvestmentRouted(
        address indexed investor,
        address indexed offeringAddress,
        address indexed paymentToken,
        uint256 paidAmount,
        uint256 tokensReceived
    );

    event TokensClaimed(address indexed investor, address indexed offeringAddress, uint256 amount);

    constructor() Ownable(msg.sender) {}

    function routeInvestment(
        address _offeringAddress,
        address _paymentToken,
        uint256 _paymentAmount
    ) external payable {
        // Ensure the offering exists and is valid
        Offering offering = Offering(payable(_offeringAddress));

        uint256 tokensReceivedAmount;
        // If _paymentToken is address(0), it's a native ETH investment
        if (_paymentToken == address(0)) {
            tokensReceivedAmount = offering.invest{value: msg.value}(
                _paymentToken,
                msg.sender,
                _paymentAmount
            );
        } else {
            tokensReceivedAmount = offering.invest(_paymentToken, msg.sender, _paymentAmount);
        }

        // Emit event for subgraph
        emit InvestmentRouted(
            msg.sender,
            _offeringAddress,
            _paymentToken,
            _paymentAmount,
            tokensReceivedAmount
        );
    }

    function claimInvestmentTokens(address _offeringAddress) external {
        Offering offering = Offering(payable(_offeringAddress));
        uint256 claimedAmount = offering.claimTokens(msg.sender);
        emit TokensClaimed(msg.sender, _offeringAddress, claimedAmount);
    }

    // Function to allow the owner to withdraw any accidentally sent ERC20 tokens
    function rescueERC20(
        address _token,
        uint256 _amount,
        address _to
    ) external onlyOwner {
        require(_token != address(0), "Invalid token address");
        require(_amount > 0, "Amount must be greater than 0");
        require(_to != address(0), "Invalid recipient address");
        IERC20(_token).transfer(_to, _amount);
    }

    // Function to allow the owner to withdraw any accidentally sent native currency
    function rescueNative(uint256 _amount, address _to) external onlyOwner {
        require(_amount > 0, "Amount must be greater than 0");
        require(_to != address(0), "Invalid recipient address");
        payable(_to).transfer(_amount);
    }

    receive() external payable {}
}
