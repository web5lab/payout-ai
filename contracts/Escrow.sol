// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IInvestmentManager.sol"; // Import the interface

interface IOffering {
    function finalizeOffering() external;
}

struct EscrowConfig {
    address owner;
}

contract Escrow is Ownable, ReentrancyGuard {
    address public investmentManager; // New state variable

    modifier onlyInvestmentManager() {
        require(msg.sender == investmentManager, "Only InvestmentManager can call this function");
        _;
    }

    struct DepositInfo {
        uint256 amount;
        address token;
    }

    struct OfferingInfo {
        address owner;
        bool isRegistered;
        bool isFinalized;
    }

    struct InvestmentTotals {
        uint256 totalETH;
        mapping(address => uint256) tokenTotals; // token address => total amount
        address[] tokens; // array to track which tokens have been invested
    }

    // offeringContract => investor => DepositInfo
    mapping(address => mapping(address => DepositInfo)) public deposits;

    // offeringContract => refunds enabled
    mapping(address => bool) public refundsEnabled;

    // offeringContract => OfferingInfo
    mapping(address => OfferingInfo) public offerings;

    // offeringContract => InvestmentTotals
    mapping(address => InvestmentTotals) private investmentTotals;

    // offeringContract => token address => bool (to check if token exists in array)
    mapping(address => mapping(address => bool)) private tokenExists;

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
    event RefundsEnabled(address indexed offeringContract);
    event Withdrawn(address indexed token, uint256 amount, address indexed to);
    event OfferingRegistered(
        address indexed offeringContract,
        address indexed owner
    );
    event OfferingFinalized(
        address indexed offeringContract,
        address indexed owner,
        uint256 totalETH,
        address[] tokens,
        uint256[] tokenAmounts
    );

    constructor(EscrowConfig memory config) Ownable(config.owner) {
        require(config.owner != address(0), "Invalid owner");
    }

    function setInvestmentManager(address _investmentManager) external onlyOwner {
        require(_investmentManager != address(0), "Invalid investment manager address");
        investmentManager = _investmentManager;
    }

    // Register an offering contract with its owner
    function registerOffering(
        address _offeringContract,
        address _offeringOwner
    ) external onlyOwner {
        require(_offeringContract != address(0), "Invalid offering contract");
        require(_offeringOwner != address(0), "Invalid offering owner");
        require(
            !offerings[_offeringContract].isRegistered,
            "Offering already registered"
        );

        offerings[_offeringContract] = OfferingInfo({
            owner: _offeringOwner,
            isRegistered: true,
            isFinalized: false
        });

        emit OfferingRegistered(_offeringContract, _offeringOwner);
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
        require(!refundsEnabled[_offeringContract], "Refunds already enabled");
        require(_offeringContract != address(0), "Invalid offering contract");
        require(_investor != address(0), "Invalid investor address");
        require(
            offerings[_offeringContract].isRegistered,
            "Offering not registered"
        );
        require(
            !offerings[_offeringContract].isFinalized,
            "Offering already finalized"
        );

        // Update or add deposit
        DepositInfo storage existingDeposit = deposits[_offeringContract][
            _investor
        ];

        if (existingDeposit.amount > 0 && existingDeposit.token == address(0)) {
            // Add to existing ETH deposit
            existingDeposit.amount += msg.value;
        } else {
            // Create new deposit (overwrites if different token type)
            if (existingDeposit.amount > 0) {
                // Refund existing different token deposit first
                _processRefund(_offeringContract, _investor, existingDeposit);
            }
            deposits[_offeringContract][_investor] = DepositInfo({
                amount: msg.value,
                token: address(0) // ETH
            });
        }

        // Update investment totals
        investmentTotals[_offeringContract].totalETH += msg.value;

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
        require(!refundsEnabled[_offeringContract], "Refunds already enabled");
        require(_offeringContract != address(0), "Invalid offering contract");
        require(_investor != address(0), "Invalid investor address");
        require(
            offerings[_offeringContract].isRegistered,
            "Offering not registered"
        );
        require(
            !offerings[_offeringContract].isFinalized,
            "Offering already finalized"
        );

        require(
            IERC20(tokenAddr).transferFrom(
                _offeringContract,
                address(this),
                amount
            ),
            "Transfer failed"
        );

        // Update or add deposit
        DepositInfo storage existingDeposit = deposits[_offeringContract][
            _investor
        ];

        if (existingDeposit.amount > 0 && existingDeposit.token == tokenAddr) {
            // Add to existing token deposit of same type
            existingDeposit.amount += amount;
        } else {
            // Create new deposit (overwrites if different token type)
            if (existingDeposit.amount > 0) {
                // Refund existing different token deposit first
                _processRefund(_offeringContract, _investor, existingDeposit);
            }
            deposits[_offeringContract][_investor] = DepositInfo({
                amount: amount,
                token: tokenAddr
            });
        }

        // Update investment totals
        InvestmentTotals storage totals = investmentTotals[_offeringContract];
        totals.tokenTotals[tokenAddr] += amount;

        // Add token to array if not already present
        if (!tokenExists[_offeringContract][tokenAddr]) {
            totals.tokens.push(tokenAddr);
            tokenExists[_offeringContract][tokenAddr] = true;
        }

        emit Deposited(_offeringContract, _investor, tokenAddr, amount);
    }

    // Internal function to process refunds
    function _processRefund(
        address _offeringContract,
        address _investor,
        DepositInfo memory depositInfo
    ) internal {
        if (depositInfo.token == address(0)) {
            // Update ETH totals
            investmentTotals[_offeringContract].totalETH -= depositInfo.amount;

            (bool sent, ) = payable(_investor).call{value: depositInfo.amount}(
                ""
            );
            require(sent, "ETH refund failed");
        } else {
            // Update token totals
            InvestmentTotals storage totals = investmentTotals[
                _offeringContract
            ];
            totals.tokenTotals[depositInfo.token] -= depositInfo.amount;

            require(
                IERC20(depositInfo.token).transfer(
                    _investor,
                    depositInfo.amount
                ),
                "Token refund failed"
            );
        }

        emit Refunded(
            _offeringContract,
            _investor,
            depositInfo.token,
            depositInfo.amount
        );
    }

    // Finalize offering and transfer all funds to offering owner
    function finalizeOffering(
        address _offeringContract
    ) external onlyOwner nonReentrant {
        require(_offeringContract != address(0), "Invalid offering contract");
        require(
            offerings[_offeringContract].isRegistered,
            "Offering not registered"
        );
        require(
            !offerings[_offeringContract].isFinalized,
            "Offering already finalized"
        );
        require(
            !refundsEnabled[_offeringContract],
            "Refunds enabled - cannot finalize"
        );

        offerings[_offeringContract].isFinalized = true;
        address offeringOwner = offerings[_offeringContract].owner;
        InvestmentTotals storage totals = investmentTotals[_offeringContract];

        IOffering(_offeringContract).finalizeOffering();

        // Prepare arrays for event emission
        address[] memory tokens = new address[](totals.tokens.length);
        uint256[] memory amounts = new uint256[](totals.tokens.length);

        // Transfer ETH if any
        if (totals.totalETH > 0) {
            require(
                address(this).balance >= totals.totalETH,
                "Insufficient ETH balance"
            );
            (bool sentETH, ) = payable(offeringOwner).call{
                value: totals.totalETH
            }("");
            require(sentETH, "ETH transfer to offering owner failed");
        }

        // Transfer all tokens
        for (uint256 i = 0; i < totals.tokens.length; i++) {
            address token = totals.tokens[i];
            uint256 amount = totals.tokenTotals[token];

            tokens[i] = token;
            amounts[i] = amount;

            if (amount > 0) {
                require(
                    IERC20(token).balanceOf(address(this)) >= amount,
                    "Insufficient token balance"
                );
                require(
                    IERC20(token).transfer(offeringOwner, amount),
                    "Token transfer failed"
                );
            }
        }

        emit OfferingFinalized(
            _offeringContract,
            offeringOwner,
            totals.totalETH,
            tokens,
            amounts
        );
    }

    // Owner can enable refunds for a specific offering contract
    function enableRefunds(address _offeringContract) external onlyOwner {
        require(_offeringContract != address(0), "Invalid offering contract");
        require(
            offerings[_offeringContract].isRegistered,
            "Offering not registered"
        );
        require(
            !offerings[_offeringContract].isFinalized,
            "Cannot enable refunds - offering finalized"
        );

        refundsEnabled[_offeringContract] = true;
        emit RefundsEnabled(_offeringContract);
        // Notify InvestmentManager that refunds are enabled for this offering
        if (investmentManager != address(0)) {
            IInvestmentManager(investmentManager).notifyRefundsEnabled(_offeringContract);
        }
    }

    // Allow offering contract to enable refunds (for cancellation)
    function enableRefunds(address _offeringContract) external {
        require(_offeringContract != address(0), "Invalid offering contract");
        require(
            msg.sender == owner() || msg.sender == _offeringContract,
            "Only owner or offering contract can enable refunds"
        );
        require(
            offerings[_offeringContract].isRegistered,
            "Offering not registered"
        );
        require(
            !offerings[_offeringContract].isFinalized,
            "Cannot enable refunds - offering finalized"
        );

        refundsEnabled[_offeringContract] = true;
        emit RefundsEnabled(_offeringContract);
        
        // Notify InvestmentManager that refunds are enabled for this offering
        if (investmentManager != address(0)) {
            IInvestmentManager(investmentManager).notifyRefundsEnabled(_offeringContract);
        }
    }

    // Initiates refund to a specific investor for a specific offering contract
    function refund(
        address _offeringContract,
        address _investor
    ) external onlyInvestmentManager nonReentrant { // Add modifier
        require(refundsEnabled[_offeringContract], "Refunds not enabled");
        require(_offeringContract != address(0), "Invalid offering contract");
        require(_investor != address(0), "Invalid investor address");

        DepositInfo memory userDeposit = deposits[_offeringContract][_investor];
        require(userDeposit.amount > 0, "Nothing to refund");

        // Clear the deposit first
        deposits[_offeringContract][_investor] = DepositInfo({
            amount: 0,
            token: address(0)
        });

        // Update totals
        if (userDeposit.token == address(0)) {
            investmentTotals[_offeringContract].totalETH -= userDeposit.amount;
        } else {
            investmentTotals[_offeringContract].tokenTotals[
                userDeposit.token
            ] -= userDeposit.amount;
        }

        // Process refund
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

    // Owner withdraws ETH or ERC20 tokens from the contract (emergency function)
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

    // Finalize offering and transfer all funds to offering owner
    function finalizeOffering(
        address _offeringContract
    ) external nonReentrant {
        require(_offeringContract != address(0), "Invalid offering contract");
        require(
            offerings[_offeringContract].isRegistered,
            "Offering not registered"
        );
        require(
            !offerings[_offeringContract].isFinalized,
            "Offering already finalized"
        );
        require(
            !refundsEnabled[_offeringContract],
            "Refunds enabled - cannot finalize"
        );
        
        // Allow either escrow owner OR offering owner to finalize
        require(
            msg.sender == owner() || msg.sender == offerings[_offeringContract].owner,
            "Only escrow owner or offering owner can finalize"
        );

        offerings[_offeringContract].isFinalized = true;
        address offeringOwner = offerings[_offeringContract].owner;
        InvestmentTotals storage totals = investmentTotals[_offeringContract];

        IOffering(_offeringContract).finalizeOffering();

        // Prepare arrays for event emission
        address[] memory tokens = new address[](totals.tokens.length);
        uint256[] memory amounts = new uint256[](totals.tokens.length);

        // Transfer ETH if any
        if (totals.totalETH > 0) {
            require(
                address(this).balance >= totals.totalETH,
                "Insufficient ETH balance"
            );
            (bool sentETH, ) = payable(offeringOwner).call{
                value: totals.totalETH
            }("");
            require(sentETH, "ETH transfer to offering owner failed");
        }

        // Transfer all tokens
        for (uint256 i = 0; i < totals.tokens.length; i++) {
            address token = totals.tokens[i];
            uint256 amount = totals.tokenTotals[token];

            tokens[i] = token;
            amounts[i] = amount;

            if (amount > 0) {
                require(
                    IERC20(token).balanceOf(address(this)) >= amount,
                    "Insufficient token balance"
                );
                require(
                    IERC20(token).transfer(offeringOwner, amount),
                    "Token transfer failed"
                );
            }
        }

        emit OfferingFinalized(
            _offeringContract,
            offeringOwner,
            totals.totalETH,
            tokens,
            amounts
        );
    }

    // Owner can enable refunds for a specific offering contract
    function enableRefundsByOwner(address _offeringContract) external onlyOwner {
        require(_offeringContract != address(0), "Invalid offering contract");
        require(
            offerings[_offeringContract].isRegistered,
            "Offering not registered"
        );
        require(
            !offerings[_offeringContract].isFinalized,
            "Cannot enable refunds - offering finalized"
        );

        refundsEnabled[_offeringContract] = true;
        emit RefundsEnabled(_offeringContract);
        // Notify InvestmentManager that refunds are enabled for this offering
        if (investmentManager != address(0)) {
            IInvestmentManager(investmentManager).notifyRefundsEnabled(_offeringContract);
        }
    }

    // Allow offering contract to enable refunds (for cancellation)
    function enableRefundsByOffering(address _offeringContract) external {
        require(_offeringContract != address(0), "Invalid offering contract");
        require(
            msg.sender == _offeringContract,
            "Only offering contract can enable refunds"
        );
        require(
            offerings[_offeringContract].isRegistered,
            "Offering not registered"
        );
        require(
            !offerings[_offeringContract].isFinalized,
            "Cannot enable refunds - offering finalized"
        );

        refundsEnabled[_offeringContract] = true;
        emit RefundsEnabled(_offeringContract);
        
        // Notify InvestmentManager that refunds are enabled for this offering
        if (investmentManager != address(0)) {
            IInvestmentManager(investmentManager).notifyRefundsEnabled(_offeringContract);
        }
    }

    // Get offering info
    function getOfferingInfo(
        address _offeringContract
    ) external view returns (OfferingInfo memory) {
        return offerings[_offeringContract];
    }

    // Check if offering is registered
    function isOfferingRegistered(
        address _offeringContract
    ) external view returns (bool) {
        return offerings[_offeringContract].isRegistered;
    }

    // Check if offering is finalized
    function isOfferingFinalized(
        address _offeringContract
    ) external view returns (bool) {
        return offerings[_offeringContract].isFinalized;
    }

    // Get total ETH invested in an offering
    function getTotalETH(
        address _offeringContract
    ) external view returns (uint256) {
        return investmentTotals[_offeringContract].totalETH;
    }

    // Get total amount of specific token invested in an offering
    function getTotalTokenAmount(
        address _offeringContract,
        address token
    ) external view returns (uint256) {
        return investmentTotals[_offeringContract].tokenTotals[token];
    }

    // Get all tokens invested in an offering
    function getInvestedTokens(
        address _offeringContract
    ) external view returns (address[] memory) {
        return investmentTotals[_offeringContract].tokens;
    }

    // Get complete investment summary for an offering
    function getInvestmentSummary(
        address _offeringContract
    )
        external
        view
        returns (
            uint256 totalETH,
            address[] memory tokens,
            uint256[] memory tokenAmounts
        )
    {
        InvestmentTotals storage totals = investmentTotals[_offeringContract];
        totalETH = totals.totalETH;
        tokens = totals.tokens;

        tokenAmounts = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            tokenAmounts[i] = totals.tokenTotals[tokens[i]];
        }
    }

    // Get deposit info for a specific investor and offering
    function getDepositInfo(
        address _offeringContract,
        address _investor
    ) external view returns (DepositInfo memory) {
        return deposits[_offeringContract][_investor];
    }

    // Allow contract to receive ETH
    receive() external payable {}
}
