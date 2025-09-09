// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@api3/contracts/interfaces/IApi3ReaderProxy.sol";

interface IWRAPEDTOKEN {
    enum PayoutFrequency {
        Daily,
        Monthly,
        Yearly
    }

    function registerInvestment(
        address user,
        uint256 amount,
        PayoutFrequency _payoutFrequency
    ) external;

    function claimPayout() external;
}

interface IEscrow {
    function depositNative(
        address _offeringContract,
        address _investor
    ) external payable;
    function depositToken(
        address _offeringContract,
        address _investor,
        address tokenAddr,
        uint256 amount
    ) external;
    function refund(address _offeringContract, address _investor) external; // Also update refund to match Escrow.sol
}

struct InitConfig {
    address saleToken;
    uint256 minInvestment;
    uint256 maxInvestment;
    uint256 startDate;
    uint256 endDate;
    uint256 maturityDate;
    bool autoTransfer;
    uint256 fundraisingCap;
    uint256 tokenPrice;
    address tokenOwner;
    address escrowAddress;
    bool apyEnabled;
    address wrappedTokenAddress;
    address investmentManager;
    address payoutTokenAddress;
    uint256 payoutRate;
    IWRAPEDTOKEN.PayoutFrequency defaultPayoutFrequency;
}

contract Offering is AccessControl, Pausable, ReentrancyGuard {
    IERC20 public saleToken;

    bytes32 public constant TOKEN_OWNER_ROLE = keccak256("TOKEN_OWNER_ROLE");

    uint256 public minInvestment;
    uint256 public maxInvestment;
    uint256 public startDate;
    uint256 public endDate;
    uint256 public maturityDate;
    bool public autoTransfer;

    uint256 public fundraisingCap;
    uint256 public totalRaised;
    uint256 public totalPendingTokens;
    bool public isSaleClosed;
    bool public apyEnabled;
    address public wrappedTokenAddress;
    address public investmentManager;
    address public payoutTokenAddress; // New state variable
    uint256 public payoutRate; // New state variable
    IWRAPEDTOKEN.PayoutFrequency public defaultPayoutFrequency; // New state variable
    bool private initialized;

    address public treasury;
    address public escrowAddress;
    uint256 public tokenPrice;

    mapping(address => bool) public whitelistedPaymentTokens;
    mapping(address => uint256) public pendingTokens;
    mapping(address => uint256) public totalInvested;

    mapping(address => address) public tokenOracles; // token => API3 reader proxy

    event Invested(
        address indexed investor,
        address paymentToken,
        uint256 paidAmount,
        uint256 tokensReceived
    );
    event Claimed(address indexed investor, uint256 amount);
    event SaleClosed(uint256 totalRaised);
    event TokenPriceUpdated(uint256 newPrice);
    event PaymentTokenWhitelisted(address indexed token, bool status);
    event OracleSet(address indexed token, address oracle);
    event Rescue(address indexed token, uint256 amount, address indexed to);
    event UnclaimedTokensReclaimed(address indexed to, uint256 amount);

    modifier onlyInvestMentmanager() {
        if (msg.sender != investmentManager)
            revert("Caller is not the investmentManager contract");
        _;
    }

    function initialize(InitConfig memory config) external {
        require(!initialized, "Already initialized");

        require(config.saleToken != address(0), "Invalid sale token");
        require(config.tokenOwner != address(0), "Invalid token owner");
        require(config.escrowAddress != address(0), "Invalid escrow address");
        require(
            config.investmentManager != address(0),
            "Invalid investment manager address"
        );
        require(config.fundraisingCap > 0, "Fundraising cap must be positive");
        require(config.tokenPrice > 0, "Token price must be positive");
        require(
            config.minInvestment <= config.maxInvestment,
            "Min > max investment"
        );
        require(
            block.timestamp <= config.startDate,
            "Start date must be in the future"
        );
        require(
            config.startDate < config.endDate,
            "Start date must be before end date"
        );
        require(
            config.payoutTokenAddress != address(0),
            "Invalid payout token address"
        );

        saleToken = IERC20(config.saleToken);
        minInvestment = config.minInvestment;
        maxInvestment = config.maxInvestment;
        startDate = config.startDate;
        endDate = config.endDate;
        maturityDate = config.maturityDate;
        autoTransfer = config.autoTransfer;
        fundraisingCap = config.fundraisingCap;
        tokenPrice = config.tokenPrice;
        escrowAddress = config.escrowAddress;
        apyEnabled = config.apyEnabled;
        wrappedTokenAddress = config.wrappedTokenAddress;
        investmentManager = config.investmentManager;
        payoutTokenAddress = config.payoutTokenAddress;
        payoutRate = config.payoutRate;
        defaultPayoutFrequency = config.defaultPayoutFrequency;
        payoutPeriodDuration = config.payoutPeriodDuration;
        firstPayoutDate = config.firstPayoutDate;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(TOKEN_OWNER_ROLE, config.tokenOwner);

        initialized = true;
    }

    // Emergency pause/unpause, only admin
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
        emit Paused(msg.sender);
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
        emit Unpaused(msg.sender);
    }

    /**
     * @dev Invest in the offering. Can be called with native LUMIA or ERC20.
     *      Checks for sale token sufficiency and paused state.
     */
    function invest(
        address paymentToken,
        address investor,
        uint256 paymentAmount
    )
        external
        payable
        nonReentrant
        whenNotPaused
        onlyInvestMentmanager
        returns (uint256)
    {
        require(investor != address(0), "Invalid investor address");
        require(!isSaleClosed, "Sale is closed");
        require(block.timestamp >= startDate, "Sale not started");
        require(block.timestamp < endDate, "Sale ended");
        require(
            whitelistedPaymentTokens[paymentToken],
            "Token not whitelisted"
        );
        require(paymentAmount > 0, "Zero amount");

        uint256 usdValue = getUSDValue(paymentToken, paymentAmount);
        require(usdValue >= minInvestment, "Below min investment");
        require(
            totalInvested[investor] + usdValue <= maxInvestment,
            "Exceeds max investment"
        );
        require(totalRaised + usdValue <= fundraisingCap, "Exceeds cap");

        uint256 tokensToReceive = (usdValue * 1e18) / tokenPrice;
        require(tokensToReceive > 0, "Token amount too low");

        // Update investment tracking
        totalRaised += usdValue;
        totalInvested[investor] += usdValue;

        // Ensure enough sale tokens if auto-transfer mode
        if (autoTransfer) {
            require(
                saleToken.balanceOf(address(this)) >= tokensToReceive,
                "Insufficient sale tokens"
            );
        }

        // Handle payments
        if (paymentToken == address(0)) {
            // Native currency to Escrow
            require(msg.value == paymentAmount, "Incorrect native amount");
            IEscrow(escrowAddress).depositNative{value: msg.value}(
                address(this),
                investor
            );
        } else {
            // ERC20 payment to Escrow
            require(msg.value == 0, "Do not send ETH for token payment");
            IERC20(paymentToken).transferFrom(
                investor,
                address(this),
                paymentAmount
            );
            IERC20(paymentToken).approve(escrowAddress, paymentAmount);
            IEscrow(escrowAddress).depositToken(
                address(this),
                investor,
                paymentToken,
                paymentAmount
            );
        }
        // Handle token distribution
        if (autoTransfer) {
            if (apyEnabled) {
                // Wrapped token investment
                require(
                    saleToken.approve(wrappedTokenAddress, tokensToReceive),
                    "Approve failed"
                );
                IWRAPEDTOKEN(wrappedTokenAddress).registerInvestment(
                    investor,
                    tokensToReceive,
                    defaultPayoutFrequency
                );
            } else {
                // Direct transfer of sale token
                require(
                    saleToken.transfer(investor, tokensToReceive),
                    "Auto-transfer failed"
                );
            }
        } else {
            // Pending distribution
            pendingTokens[investor] += tokensToReceive;
            totalPendingTokens += tokensToReceive;
        }

        emit Invested(investor, paymentToken, paymentAmount, tokensToReceive);

        // Close sale if cap reached
        if (totalRaised >= fundraisingCap) {
            isSaleClosed = true;
            emit SaleClosed(totalRaised);
        }
        return tokensToReceive;
    }

    /**
     * @dev Get USD value of a token using API3 oracle. Validates price freshness.
     */
    function getUSDValue(
        address token,
        uint256 amount
    ) internal view returns (uint256 usdValue) {
        address oracle = tokenOracles[token];
        require(oracle != address(0), "Oracle not set");

        (int224 value, ) = IApi3ReaderProxy(oracle).read();
        require(value > 0, "Invalid price");

        uint8 tokenDecimals = token == address(0)
            ? 18
            : IERC20Metadata(token).decimals();

        usdValue =
            (amount * uint256(int256(value)) * 1e18) /
            (10 ** tokenDecimals) /
            1e18;
    }

    /**
     * @dev Set new token price. Only owner. Must be positive.
     */
    function setTokenPrice(
        uint256 newPrice
    ) external onlyRole(TOKEN_OWNER_ROLE) {
        require(newPrice > 0, "Invalid price");
        tokenPrice = newPrice;
        emit TokenPriceUpdated(newPrice);
    }

    /**
     * @dev Whitelist or remove payment tokens. Only owner.
     */
    function setWhitelistedPaymentToken(
        address token,
        bool status
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistedPaymentTokens[token] = status;
        emit PaymentTokenWhitelisted(token, status);
    }

    /**
     * @dev Set API3 oracle for a token. Only owner.
     */
    function setTokenOracle(
        address token,
        address oracle
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(oracle != address(0), "Invalid oracle address");
        tokenOracles[token] = oracle;
        emit OracleSet(token, oracle);
    }

    /**
     * @dev Remove the oracle for a payment token.
     */
    function removeTokenOracle(
        address token
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(tokenOracles[token] != address(0), "No oracle to remove");
        tokenOracles[token] = address(0);
        emit OracleSet(token, address(0));
    }

    /**
     * @dev Claim tokens after maturity.
     */
    function claimTokens(
        address _investor
    )
        external
        nonReentrant
        whenNotPaused
        onlyInvestMentmanager
        returns (uint256)
    {
        require(block.timestamp >= maturityDate, "Maturity not reached");

        uint256 amount = pendingTokens[_investor];
        require(amount > 0, "No tokens to claim");
        require(
            saleToken.balanceOf(address(this)) >= amount,
            "Insufficient sale tokens"
        );

        pendingTokens[_investor] = 0;
        totalPendingTokens -= amount;
        if (apyEnabled) {
            saleToken.approve(wrappedTokenAddress, amount);
            IWRAPEDTOKEN(wrappedTokenAddress).registerInvestment(
                _investor,
                amount,
                defaultPayoutFrequency
            ); // Added semicolon here
        } else {
            require(
                saleToken.transfer(_investor, amount),
                "Token transfer failed"
            );
        }
        emit Claimed(_investor, amount);
        return amount;
    }

    /**
     * @dev Reclaim unclaimed tokens after maturity. Only owner.
     */
    function reclaimUnclaimedTokens(
        address to
    ) external onlyRole(TOKEN_OWNER_ROLE) nonReentrant {
        require(block.timestamp > maturityDate, "Not matured");
        require(to != address(0), "Invalid address");

        uint256 available = saleToken.balanceOf(address(this)) -
            totalPendingTokens;
        require(available > 0, "No unclaimed tokens");
        require(saleToken.transfer(to, available), "Reclaim failed");
        emit UnclaimedTokensReclaimed(to, available);
    }

    /**
     * @dev Rescue any stuck ERC20 tokens (not saleToken) or Lumia sent by mistake.
     *      Only admin can call.
     */
    function rescueTokens(
        address token,
        uint256 amount,
        address to
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(to != address(0), "Invalid recipient");
        if (token == address(0)) {
            // Rescue LUMIA
            require(address(this).balance >= amount, "Not enough LUMIA");
            (bool sent, ) = to.call{value: amount}("");
            require(sent, "LUMIA rescue failed");
        } else {
            require(token != address(saleToken), "Cannot rescue saleToken");
            require(
                IERC20(token).balanceOf(address(this)) >= amount,
                "Not enough tokens"
            );
            require(IERC20(token).transfer(to, amount), "ERC20 rescue failed");
        }
        emit Rescue(token, amount, to);
    }

    /**
     * @dev Receive and fallback - revert to prevent accidental LUMIA sending.
     */
    receive() external payable {
        revert("Direct LUMIA not accepted");
    }

    fallback() external payable {
        revert("Fallback not accepted");
    }

    /**
     * @dev Grant TOKEN_OWNER_ROLE to other addresses. Only admin.
     */
    function grantTokenOwner(
        address newOwner
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newOwner != address(0), "Zero address");
        _grantRole(TOKEN_OWNER_ROLE, newOwner);
    }

    /**
     * @dev Revoke TOKEN_OWNER_ROLE. Only admin.
     */
    function revokeTokenOwner(
        address owner
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(owner != address(0), "Zero address");
        _revokeRole(TOKEN_OWNER_ROLE, owner);
    }

    /**
     * @dev Update investment limits.
     */
    function setInvestmentLimits(
        uint256 _minInvestment,
        uint256 _maxInvestment
    ) external onlyRole(TOKEN_OWNER_ROLE) {
        require(_minInvestment <= _maxInvestment, "Min > max investment");
        minInvestment = _minInvestment;
        maxInvestment = _maxInvestment;
    }

    /**
     * @dev Update end date.
     */
    function setEndDate(
        uint256 _endDate
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_endDate > block.timestamp, "Invalid end date");
        require(_endDate > endDate, "New end date must be after current");
        require(_endDate < maturityDate, "End date must be before maturity");
        endDate = _endDate;
    }
}
