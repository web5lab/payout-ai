// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

struct EscrowConfig {
    address owner;
}

contract Escrow is Ownable, ReentrancyGuard {
    bool public refundsEnabled;

    struct DepositInfo {
        uint256 amount;
        address token; // address(0) means native ETH
    }

    mapping(address => mapping(address => DepositInfo)) public deposits; // offeringContract => investor => DepositInfo

    event Deposited(
        address indexed offeringContract,
        address indexed investor,
        address indexed token,
        uint256 amount
    );
    event Refunded(
        address indexed offeringContract,
        address indexed investor,
        address indexed token,
        uint256 amount
    );
    event RefundsEnabled();
    event Withdrawn(address indexed token, uint256 amount, address indexed to);

    constructor(EscrowConfig memory config) Ownable(config.owner) {
        require(config.owner != address(0), "Invalid owner");
    }

    // Deposit native ETH
    function depositNative(
        address _offeringContract,
        address _investor
    ) external payable {
        require(
            msg.sender == _offeringContract,
            "Only offering contract can deposit"
        );
        require(msg.value > 0, "Invalid amount");
        require(!refundsEnabled, "Refunds already enabled");
        require(_offeringContract != address(0), "Invalid offering contract");
        require(_investor != address(0), "Invalid investor address");

        deposits[_offeringContract][_investor] = DepositInfo({
            amount: msg.value,
            token: address(0) // ETH
        });

        emit Deposited(_offeringContract, _investor, address(0), msg.value);
    }

    // Deposit ERC20 tokens
    function depositToken(
        address _offeringContract,
        address _investor,
        address tokenAddr,
        uint256 amount
    ) external nonReentrant {
        require(
            msg.sender == _offeringContract,
            "Only offering contract can deposit"
        );
        require(tokenAddr != address(0), "Invalid token");
        require(amount > 0, "Invalid amount");
        require(!refundsEnabled, "Refunds already enabled");
        require(_offeringContract != address(0), "Invalid offering contract");
        require(_investor != address(0), "Invalid investor address");

        require(
            IERC20(tokenAddr).transferFrom(
                _offeringContract,
                address(this),
                amount
            ),
            "Transfer failed"
        );

        deposits[_offeringContract][_investor] = DepositInfo({
            amount: amount,
            token: tokenAddr
        });

        emit Deposited(_offeringContract, _investor, tokenAddr, amount);
    }

    // Owner can enable refunds
    function enableRefunds() external onlyOwner {
        refundsEnabled = true;
        emit RefundsEnabled();
    }

    // Owner initiates refund to a specific investor for a specific offering contract
    function refund(
        address _offeringContract,
        address _investor
    ) external onlyOwner nonReentrant {
        require(refundsEnabled, "Refunds not enabled");
        require(_offeringContract != address(0), "Invalid offering contract");
        require(_investor != address(0), "Invalid investor address");

        DepositInfo memory userDeposit = deposits[_offeringContract][_investor];
        require(userDeposit.amount > 0, "Nothing to refund");

        deposits[_offeringContract][_investor] = DepositInfo({
            amount: 0,
            token: address(0)
        });

        if (userDeposit.token == address(0)) {
            (bool sent, ) = payable(_investor).call{value: userDeposit.amount}(
                ""
            );
            require(sent, "ETH refund failed");
        } else {
            require(
                IERC20(userDeposit.token).transfer(
                    _investor,
                    userDeposit.amount
                ),
                "Token refund failed"
            );
        }

        emit Refunded(
            _offeringContract,
            _investor,
            userDeposit.token,
            userDeposit.amount
        );
    }

    // Owner withdraws ETH or ERC20 tokens from the contract
    function withdraw(
        address tokenAddr,
        uint256 amount,
        address to
    ) external onlyOwner nonReentrant {
        require(to != address(0), "Invalid recipient");

        if (tokenAddr == address(0)) {
            // Withdraw ETH
            require(address(this).balance >= amount, "Insufficient ETH");
            (bool sent, ) = payable(to).call{value: amount}("");
            require(sent, "ETH withdraw failed");
        } else {
            // Withdraw ERC20
            require(
                IERC20(tokenAddr).balanceOf(address(this)) >= amount,
                "Insufficient tokens"
            );
            require(
                IERC20(tokenAddr).transfer(to, amount),
                "Token withdraw failed"
            );
        }

        emit Withdrawn(tokenAddr, amount, to);
    }

    // Allow contract to receive ETH for testing
    receive() external payable {}
}
