// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./Offering.sol";
import "./interfaces/IInvestmentManager.sol"; // Import the interface
import "./Escrow.sol"; // Import Escrow to interact with it

contract InvestmentManager is Ownable, IInvestmentManager {
    address public escrowContract;
    mapping(address => bool) public refundsEnabledForOffering;
    event InvestmentRouted(
        address indexed investor,
        address indexed offeringAddress,
        address indexed paymentToken,
        uint256 paidAmount,
        uint256 tokensReceived
    );

    event TokensClaimed(
        address indexed investor,
        address indexed offeringAddress,
        uint256 amount
    );

    event RefundClaimed( // New event for subgraph
        address indexed investor,
        address indexed offeringAddress,
        address indexed token,
        uint256 amount
    );

    event refundEnabled(address indexed offeringAddress); // This event seems to be for the old flow, might be removed later.

    constructor() Ownable(msg.sender) {}

    function setEscrowContract(address _escrowContract) external onlyOwner {
        require(_escrowContract != address(0), "Invalid escrow contract address");
        escrowContract = _escrowContract;
    }

    function notifyRefundsEnabled(address _offeringContract) external override {
        require(msg.sender == escrowContract, "Only Escrow contract can call this function");
        refundsEnabledForOffering[_offeringContract] = true;
        emit refundEnabled(_offeringContract); // Re-emitting the existing event for consistency
    }

    function claimRefund(address _offeringContract, address _token) external override {
        require(refundsEnabledForOffering[_offeringContract], "Refunds not enabled for this offering");
        require(_offeringContract != address(0), "Invalid offering contract");
        require(_token != address(0) || _token == address(0), "Invalid token address"); // Allow address(0) for ETH

        Escrow escrow = Escrow(payable(escrowContract));
        
        // Get the deposit amount and token from Escrow before calling refund
        Escrow.DepositInfo memory depositInfo = escrow.getDepositInfo(_offeringContract, msg.sender);
        require(depositInfo.amount > 0, "No deposit found for refund");
        require(depositInfo.token == _token, "Token mismatch for refund");

        // Call the refund function on the Escrow contract
        escrow.refund(_offeringContract, msg.sender);

        // Emit event for subgraph with the actual refunded amount and token
        emit RefundClaimed(msg.sender, _offeringContract, depositInfo.token, depositInfo.amount);
    }

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
            tokensReceivedAmount = offering.invest(
                _paymentToken,
                msg.sender,
                _paymentAmount
            );
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
