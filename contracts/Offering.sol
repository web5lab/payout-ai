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
        uint256 usdValue
    ) external;

    function claimPayout() external;
    function setFirstPayoutDate() external;
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
    function enableRefundsByOffering() external;
}

struct InitConfig {
    address saleToken;
    uint256 minInvestment;
    uint256 maxInvestment;
    uint256 startDate;
    uint256 endDate;
    uint256 softCap;
    uint256 fundraisingCap;
    uint256 tokenPrice;
    address tokenOwner;
    address escrowAddress;
    bool apyEnabled;
    address wrappedTokenAddress;
    address investmentManager;
    address payoutTokenAddress;
    uint256 payoutRate;
}

contract Offering is AccessControl, Pausable, ReentrancyGuard {
    IERC20 public saleToken;

    bytes32 public constant TOKEN_OWNER_ROLE = keccak256("TOKEN_OWNER_ROLE");

    uint256 public minInvestment;
    uint256 public maxInvestment;
    uint256 public startDate;
    uint256 public endDate;
    uint256 public softCap;

    uint256 public fundraisingCap;
    uint256 public totalRaised;
    uint256 public totalPendingTokens;
    bool public isSaleClosed;
    bool public isOfferingFinalized;
    bool public isOfferingCancelled;
    bool public apyEnabled;
    address public wrappedTokenAddress;
    address public investmentManager;
    address public payoutTokenAddress;
    uint256 public payoutRate;
    IWRAPEDTOKEN.PayoutFrequency public defaultPayoutFrequency;
    bool private initialized;

    address public treasury;
    address public escrowAddress;
    uint256 public tokenPrice;

    /// @dev Maximum allowed price staleness (24 hours)
    uint256 private constant MAX_PRICE_STALENESS = 24 hours;

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
    event OfferingFinalized(uint256 timestamp); // New event
    event OfferingCancelled(uint256 timestamp);
    event SoftCapReached(uint256 totalRaised, uint256 softCap);
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
        require(config.softCap > 0, "Soft cap must be positive");
        require(config.fundraisingCap > 0, "Fundraising cap must be positive");
        require(
            config.softCap <= config.fundraisingCap,
            "Soft cap cannot exceed fundraising cap"
        );
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
        softCap = config.softCap;
        softCap = config.softCap;
        fundraisingCap = config.fundraisingCap;
        tokenPrice = config.tokenPrice;
        escrowAddress = config.escrowAddress;
        apyEnabled = config.apyEnabled;
        wrappedTokenAddress = config.wrappedTokenAddress;
        investmentManager = config.investmentManager;
        payoutTokenAddress = config.payoutTokenAddress;
        payoutRate = config.payoutRate;

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
     * @dev Finalize the offering. Can only be called after end date by admin or token owner.
     *      Once finalized, users can claim their tokens.
     */
    function finalizeOffering() external {
        require(msg.sender == escrowAddress, "Not authorized to finalize");
        require(block.timestamp >= endDate, "Sale not ended yet");
        require(!isOfferingFinalized, "Already finalized");
        require(!isOfferingCancelled, "Offering is cancelled");

        isOfferingFinalized = true;
        isSaleClosed = true; // Ensure sale is closed when finalized

        // Set first payout date in WrappedToken
        if (apyEnabled && wrappedTokenAddress != address(0)) {
            IWRAPEDTOKEN(wrappedTokenAddress).setFirstPayoutDate();
        }

        emit OfferingFinalized(block.timestamp);
        emit SaleClosed(totalRaised);
    }

    /**
     * @dev Cancel the offering and enable refunds. Only token owner can call.
     *      Can be called anytime before finalization.
     */
    function cancelOffering() external onlyRole(TOKEN_OWNER_ROLE) {
        require(!isOfferingFinalized, "Already finalized");
        require(!isOfferingCancelled, "Already cancelled");

        isOfferingCancelled = true;
        isSaleClosed = true;

        // Enable refunds in escrow
        IEscrow(escrowAddress).enableRefundsByOffering();

        emit OfferingCancelled(block.timestamp);
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
        require(!isOfferingCancelled, "Offering is cancelled");
        require(!isOfferingCancelled, "Offering is cancelled");
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

        // Additional safety checks for investment limits
        require(
            usdValue <= type(uint128).max,
            "Investment amount too large"
        );
        require(
            totalRaised <= type(uint128).max - usdValue,
            "Total raised would overflow"
        );
        
        uint256 tokensToReceive = (usdValue * 1e18) / tokenPrice;
        require(tokensToReceive > 0, "Token amount too low");
        require(
            tokensToReceive <= type(uint128).max,
            "Token amount too large"
        );

        // Update investment tracking
        totalRaised += usdValue;
        totalInvested[investor] += usdValue;

        // Handle payments
        if (paymentToken == address(0)) {
            // Native currency to Escrow
            require(msg.value == paymentAmount, "Incorrect native amount");
            (bool success, ) = escrowAddress.call{value: msg.value}(
                abi.encodeWithSignature(
                    "depositNative(address,address)",
                    address(this),
                    investor
                )
            );
            require(success, "Escrow deposit failed");
        } else {
            // ERC20 payment to Escrow
            require(msg.value == 0, "Do not send ETH for token payment");
            
            // Check transfer success
            bool transferSuccess = IERC20(paymentToken).transferFrom(
                investor,
                address(this),
                paymentAmount
            );
            require(transferSuccess, "Payment token transfer failed");
            
            // Check approval success
            bool approvalSuccess = IERC20(paymentToken).approve(escrowAddress, paymentAmount);
            require(approvalSuccess, "Payment token approval failed");
            
            // Use low-level call for escrow interaction
            (bool success, ) = escrowAddress.call(
                abi.encodeWithSignature(
                    "depositToken(address,address,address,uint256)",
                    address(this),
                    investor,
                    paymentToken,
                    paymentAmount
                )
            );
            require(success, "Escrow token deposit failed");
        }
                address(this),
                investor,
                paymentToken,
                paymentAmount
            );
        }

        pendingTokens[investor] += tokensToReceive;
        totalPendingTokens += tokensToReceive;

        emit Invested(investor, paymentToken, paymentAmount, tokensToReceive);

        // Check if soft cap is reached
        if (totalRaised >= softCap && totalRaised < softCap + usdValue) {
            emit SoftCapReached(totalRaised, softCap);
        }

        // Check if soft cap is reached
        if (totalRaised >= softCap && totalRaised < softCap + usdValue) {
            emit SoftCapReached(totalRaised, softCap);
        }

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

        (int224 value, uint32 timestamp) = IApi3ReaderProxy(oracle).read();
        require(value > 0, "Invalid price");
        
        // Validate price freshness to prevent stale price exploitation
        require(
            block.timestamp - timestamp <= MAX_PRICE_STALENESS,
            "Price data too stale"
        );

        uint8 tokenDecimals = token == address(0)
            ? 18
            : IERC20Metadata(token).decimals();

        // Use checked arithmetic to prevent overflow
        usdValue =
            (amount * uint256(int256(value)) * 1e18) /
            (10 ** tokenDecimals) /
            1e18;
        
        // Additional overflow check
        require(usdValue > 0, "USD value calculation overflow");
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
     * @dev Claim tokens after offering is finalized.
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
        require(isOfferingFinalized, "Offering not finalized yet");
        require(!isOfferingCancelled, "Offering is cancelled");

        require(isOfferingFinalized, "Offering not finalized yet");
        require(!isOfferingCancelled, "Offering is cancelled");

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
            uint256 usdValue = (amount * tokenPrice) / 1e18;
            IWRAPEDTOKEN(wrappedTokenAddress).registerInvestment(
                _investor,
                amount,
                usdValue
            );
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
     * @dev Reclaim unclaimed tokens after offering is finalized. Only owner.
     */
    function reclaimUnclaimedTokens(
        address to
    ) external onlyRole(TOKEN_OWNER_ROLE) nonReentrant {
        require(isOfferingFinalized, "Offering not finalized");
        require(isOfferingFinalized, "Offering not finalized");
        require(to != address(0), "Invalid address");

        uint256 available = saleToken.balanceOf(address(this)) -
            totalPendingTokens;
        require(available > 0, "No unclaimed tokens");
        bool transferSuccess = saleToken.transfer(to, available);
        require(transferSuccess, "Reclaim transfer failed");
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
            bool transferSuccess = IERC20(token).transfer(to, amount);
            require(transferSuccess, "ERC20 rescue transfer failed");
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
     * @dev Finalize offering early if soft cap is reached. Only token owner can call.
     */
    function finalizeOfferingSoftCap() external onlyRole(TOKEN_OWNER_ROLE) {
        require(totalRaised >= softCap, "Soft cap not reached");
        require(!isOfferingFinalized, "Already finalized");
        require(!isOfferingCancelled, "Offering is cancelled");
        require(!isSaleClosed, "Sale already closed");

        isOfferingFinalized = true;
        isSaleClosed = true;

        // Set first payout date in WrappedToken
        if (apyEnabled && wrappedTokenAddress != address(0)) {
            IWRAPEDTOKEN(wrappedTokenAddress).setFirstPayoutDate();
        }

        emit OfferingFinalized(block.timestamp);
        emit SaleClosed(totalRaised);
    }
    /**
     * @dev Check if offering can be finalized (end date reached and not already finalized).
     */
    function canFinalize() external view returns (bool) {
        return
            (block.timestamp >= endDate || totalRaised >= softCap) &&
            !isOfferingFinalized &&
            !isOfferingCancelled;
    }

    /**
     * @dev Check if soft cap has been reached.
     */
    function isSoftCapReached() external view returns (bool) {
        return totalRaised >= softCap;
    }

    /**
     * @dev Check if offering can be cancelled by token owner.
     */
    function canCancel() external view returns (bool) {
        return !isOfferingFinalized && !isOfferingCancelled;
    }

    /**
     * @dev Get offering status information.
     */
    function getOfferingStatus()
        external
        view
        returns (
            bool saleActive,
            bool saleClosed,
            bool finalized,
            bool cancelled,
            bool softCapReached,
            uint256 raised,
            uint256 softCapAmount,
            uint256 cap,
            uint256 endTime
        )
    {
        saleActive =
            block.timestamp >= startDate &&
            block.timestamp < endDate &&
            !isSaleClosed &&
            !isOfferingCancelled;
        saleClosed = isSaleClosed;
        finalized = isOfferingFinalized;
        cancelled = isOfferingCancelled;
        softCapReached = totalRaised >= softCap;
        raised = totalRaised;
        softCapAmount = softCap;
        cap = fundraisingCap;
        endTime = endDate;
    }
}
