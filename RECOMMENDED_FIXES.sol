// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Security Fixes and Improvements
 * @dev This file contains recommended fixes for identified security issues
 */

// ============================================================================
// 1. ORACLE SECURITY IMPROVEMENTS
// ============================================================================

contract ImprovedOracleManager {
    struct OracleConfig {
        address primary;
        address secondary;
        address tertiary;
        uint256 maxStaleness;
        uint256 maxDeviation; // in basis points
    }
    
    mapping(address => OracleConfig) public tokenOracles;
    mapping(address => uint256) public lastValidPrices;
    
    uint256 private constant MAX_PRICE_STALENESS = 1 hours; // Reduced from 24h
    uint256 private constant MAX_PRICE_DEVIATION = 500; // 5% max deviation
    uint256 private constant BASIS_POINTS = 10000;
    
    error PriceTooStale(uint256 staleness, uint256 maxStaleness);
    error PriceDeviationTooHigh(uint256 deviation, uint256 maxDeviation);
    error InsufficientOracles(uint256 available, uint256 required);
    
    function getSecureUSDValue(
        address token,
        uint256 amount
    ) internal view returns (uint256 usdValue) {
        OracleConfig memory config = tokenOracles[token];
        require(config.primary != address(0), "No oracle configured");
        
        uint256[] memory prices = new uint256[](3);
        uint256 validPrices = 0;
        
        // Get prices from multiple oracles
        if (config.primary != address(0)) {
            (int224 value, uint32 timestamp) = IApi3ReaderProxy(config.primary).read();
            if (value > 0 && block.timestamp - timestamp <= MAX_PRICE_STALENESS) {
                prices[validPrices++] = uint256(int256(value));
            }
        }
        
        if (config.secondary != address(0)) {
            (int224 value, uint32 timestamp) = IApi3ReaderProxy(config.secondary).read();
            if (value > 0 && block.timestamp - timestamp <= MAX_PRICE_STALENESS) {
                prices[validPrices++] = uint256(int256(value));
            }
        }
        
        if (config.tertiary != address(0)) {
            (int224 value, uint32 timestamp) = IApi3ReaderProxy(config.tertiary).read();
            if (value > 0 && block.timestamp - timestamp <= MAX_PRICE_STALENESS) {
                prices[validPrices++] = uint256(int256(value));
            }
        }
        
        if (validPrices < 2) revert InsufficientOracles(validPrices, 2);
        
        // Use median price for security
        uint256 medianPrice = _getMedianPrice(prices, validPrices);
        
        // Check price deviation from last valid price
        uint256 lastPrice = lastValidPrices[token];
        if (lastPrice > 0) {
            uint256 deviation = medianPrice > lastPrice 
                ? ((medianPrice - lastPrice) * BASIS_POINTS) / lastPrice
                : ((lastPrice - medianPrice) * BASIS_POINTS) / lastPrice;
            
            if (deviation > MAX_PRICE_DEVIATION) {
                revert PriceDeviationTooHigh(deviation, MAX_PRICE_DEVIATION);
            }
        }
        
        // Calculate USD value with overflow protection
        uint8 tokenDecimals = token == address(0) ? 18 : IERC20Metadata(token).decimals();
        usdValue = Math.mulDiv(amount, medianPrice, 10 ** tokenDecimals);
        
        require(usdValue > 0, "USD value calculation failed");
    }
    
    function _getMedianPrice(uint256[] memory prices, uint256 length) 
        internal pure returns (uint256) {
        // Simple bubble sort for small arrays
        for (uint256 i = 0; i < length - 1; i++) {
            for (uint256 j = 0; j < length - i - 1; j++) {
                if (prices[j] > prices[j + 1]) {
                    uint256 temp = prices[j];
                    prices[j] = prices[j + 1];
                    prices[j + 1] = temp;
                }
            }
        }
        
        return length % 2 == 0 
            ? (prices[length / 2 - 1] + prices[length / 2]) / 2
            : prices[length / 2];
    }
}

// ============================================================================
// 2. IMPROVED ACCESS CONTROL
// ============================================================================

contract MultiSigAccessControl {
    struct MultiSigConfig {
        address[] signers;
        uint256 requiredSignatures;
        mapping(bytes32 => uint256) confirmations;
        mapping(bytes32 => mapping(address => bool)) hasConfirmed;
    }
    
    MultiSigConfig private multiSig;
    
    modifier requireMultiSig(bytes32 operation) {
        bytes32 txHash = keccak256(abi.encodePacked(operation, block.timestamp));
        
        if (multiSig.confirmations[txHash] < multiSig.requiredSignatures) {
            if (!multiSig.hasConfirmed[txHash][msg.sender]) {
                multiSig.hasConfirmed[txHash][msg.sender] = true;
                multiSig.confirmations[txHash]++;
            }
            
            require(
                multiSig.confirmations[txHash] >= multiSig.requiredSignatures,
                "Insufficient confirmations"
            );
        }
        _;
    }
    
    function emergencyPauseWithMultiSig() 
        external 
        requireMultiSig(keccak256("EMERGENCY_PAUSE")) 
    {
        _pause();
    }
}

// ============================================================================
// 3. ENHANCED EXTERNAL CALL SAFETY
// ============================================================================

contract SafeExternalCalls {
    using Address for address;
    
    uint256 private constant MAX_GAS_FOR_EXTERNAL_CALL = 50000;
    
    function safeDepositToEscrow(
        address escrowAddress,
        address offeringContract,
        address investor,
        uint256 amount
    ) internal returns (bool success) {
        // Use interface instead of low-level call
        try IEscrow(escrowAddress).depositNative{gas: MAX_GAS_FOR_EXTERNAL_CALL}(
            offeringContract,
            investor
        ) {
            return true;
        } catch Error(string memory reason) {
            emit ExternalCallFailed("depositNative", reason);
            return false;
        } catch (bytes memory) {
            emit ExternalCallFailed("depositNative", "Unknown error");
            return false;
        }
    }
    
    function safeTokenTransfer(
        address token,
        address to,
        uint256 amount
    ) internal returns (bool success) {
        if (token == address(0)) {
            // Native transfer with gas limit
            (success, ) = to.call{value: amount, gas: MAX_GAS_FOR_EXTERNAL_CALL}("");
        } else {
            // ERC20 transfer with proper validation
            try IERC20(token).transfer(to, amount) returns (bool result) {
                success = result;
            } catch {
                success = false;
            }
        }
        
        if (!success) {
            emit TransferFailed(token, to, amount);
        }
    }
    
    event ExternalCallFailed(string functionName, string reason);
    event TransferFailed(address token, address to, uint256 amount);
}

// ============================================================================
// 4. CIRCUIT BREAKER IMPLEMENTATION
// ============================================================================

contract CircuitBreaker {
    struct CircuitBreakerConfig {
        uint256 maxDailyVolume;
        uint256 maxHourlyVolume;
        uint256 maxSingleTransaction;
        bool enabled;
    }
    
    CircuitBreakerConfig public circuitBreaker;
    mapping(uint256 => uint256) public dailyVolume; // day => volume
    mapping(uint256 => uint256) public hourlyVolume; // hour => volume
    
    error CircuitBreakerTripped(string reason, uint256 attempted, uint256 limit);
    
    modifier withinCircuitBreakerLimits(uint256 amount) {
        if (circuitBreaker.enabled) {
            // Check single transaction limit
            if (amount > circuitBreaker.maxSingleTransaction) {
                revert CircuitBreakerTripped(
                    "Single transaction limit",
                    amount,
                    circuitBreaker.maxSingleTransaction
                );
            }
            
            // Check hourly limit
            uint256 currentHour = block.timestamp / 1 hours;
            if (hourlyVolume[currentHour] + amount > circuitBreaker.maxHourlyVolume) {
                revert CircuitBreakerTripped(
                    "Hourly volume limit",
                    hourlyVolume[currentHour] + amount,
                    circuitBreaker.maxHourlyVolume
                );
            }
            
            // Check daily limit
            uint256 currentDay = block.timestamp / 1 days;
            if (dailyVolume[currentDay] + amount > circuitBreaker.maxDailyVolume) {
                revert CircuitBreakerTripped(
                    "Daily volume limit",
                    dailyVolume[currentDay] + amount,
                    circuitBreaker.maxDailyVolume
                );
            }
            
            // Update volumes
            hourlyVolume[currentHour] += amount;
            dailyVolume[currentDay] += amount;
        }
        _;
    }
    
    function setCircuitBreakerConfig(
        uint256 maxDaily,
        uint256 maxHourly,
        uint256 maxSingle,
        bool enabled
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(maxSingle <= maxHourly, "Invalid single transaction limit");
        require(maxHourly <= maxDaily, "Invalid hourly limit");
        
        circuitBreaker = CircuitBreakerConfig({
            maxDailyVolume: maxDaily,
            maxHourlyVolume: maxHourly,
            maxSingleTransaction: maxSingle,
            enabled: enabled
        });
    }
}

// ============================================================================
// 5. IMPROVED INPUT VALIDATION
// ============================================================================

library ValidationLibrary {
    error InvalidAddress(address addr);
    error InvalidAmount(uint256 amount, uint256 min, uint256 max);
    error InvalidTimestamp(uint256 timestamp, uint256 current);
    error InvalidPercentage(uint256 percentage, uint256 max);
    
    function validateAddress(address addr) internal pure {
        if (addr == address(0)) revert InvalidAddress(addr);
    }
    
    function validateAmount(uint256 amount, uint256 min, uint256 max) internal pure {
        if (amount < min || amount > max) {
            revert InvalidAmount(amount, min, max);
        }
    }
    
    function validateFutureTimestamp(uint256 timestamp) internal view {
        if (timestamp <= block.timestamp) {
            revert InvalidTimestamp(timestamp, block.timestamp);
        }
    }
    
    function validatePercentage(uint256 percentage, uint256 maxBasisPoints) internal pure {
        if (percentage > maxBasisPoints) {
            revert InvalidPercentage(percentage, maxBasisPoints);
        }
    }
    
    function validateArrayLengths(uint256 length1, uint256 length2) internal pure {
        require(length1 == length2, "Array length mismatch");
        require(length1 > 0, "Empty arrays not allowed");
    }
}

// ============================================================================
// 6. ENHANCED PAYOUT SYSTEM WITH PAGINATION
// ============================================================================

contract ImprovedPayoutSystem {
    uint256 private constant MAX_PERIODS_PER_CLAIM = 50;
    
    struct PayoutClaim {
        uint256 fromPeriod;
        uint256 toPeriod;
        uint256 totalAmount;
        uint256 timestamp;
    }
    
    mapping(address => PayoutClaim[]) public userPayoutHistory;
    
    function claimPayoutsInRange(
        uint256 fromPeriod,
        uint256 toPeriod
    ) external nonReentrant whenNotPaused {
        require(fromPeriod <= toPeriod, "Invalid period range");
        require(toPeriod - fromPeriod <= MAX_PERIODS_PER_CLAIM, "Too many periods");
        require(fromPeriod > userLastClaimedPeriod[msg.sender], "Already claimed");
        require(toPeriod <= currentPayoutPeriod, "Future period");
        
        uint256 totalClaimable = 0;
        
        for (uint256 period = fromPeriod; period <= toPeriod; period++) {
            uint256 periodFunds = payoutFundsPerPeriod[period];
            uint256 totalUSDTAtPeriod = totalUSDTSnapshot[period];
            
            if (periodFunds > 0 && totalUSDTAtPeriod > 0) {
                uint256 userUSDTAtPeriod = getUserUSDTAtPeriod(msg.sender, period);
                
                if (userUSDTAtPeriod > 0) {
                    uint256 userShare = Math.mulDiv(
                        periodFunds,
                        userUSDTAtPeriod,
                        totalUSDTAtPeriod
                    );
                    totalClaimable += userShare;
                }
            }
        }
        
        require(totalClaimable > 0, "No claimable amount");
        
        // Update state before external call
        userLastClaimedPeriod[msg.sender] = toPeriod;
        investors[msg.sender].totalPayoutsClaimed += totalClaimable;
        
        // Record claim history
        userPayoutHistory[msg.sender].push(PayoutClaim({
            fromPeriod: fromPeriod,
            toPeriod: toPeriod,
            totalAmount: totalClaimable,
            timestamp: block.timestamp
        }));
        
        // External call last
        bool transferSuccess = payoutToken.transfer(msg.sender, totalClaimable);
        require(transferSuccess, "Payout transfer failed");
        
        emit PayoutClaimed(msg.sender, totalClaimable, toPeriod);
    }
    
    function getClaimablePeriodsCount(address user) external view returns (uint256) {
        uint256 lastClaimed = userLastClaimedPeriod[user];
        return currentPayoutPeriod > lastClaimed ? currentPayoutPeriod - lastClaimed : 0;
    }
    
    function getOptimalClaimRange(address user) 
        external view returns (uint256 fromPeriod, uint256 toPeriod) {
        uint256 lastClaimed = userLastClaimedPeriod[user];
        fromPeriod = lastClaimed + 1;
        
        uint256 maxClaimable = lastClaimed + MAX_PERIODS_PER_CLAIM;
        toPeriod = currentPayoutPeriod > maxClaimable ? maxClaimable : currentPayoutPeriod;
    }
}

// ============================================================================
// 7. TIMELOCK GOVERNANCE
// ============================================================================

contract TimelockGovernance {
    struct QueuedTransaction {
        address target;
        bytes data;
        uint256 executeAfter;
        bool executed;
    }
    
    mapping(bytes32 => QueuedTransaction) public queuedTransactions;
    
    uint256 public constant MIN_DELAY = 2 days;
    uint256 public constant MAX_DELAY = 30 days;
    uint256 public delay = 2 days;
    
    event TransactionQueued(
        bytes32 indexed txHash,
        address indexed target,
        bytes data,
        uint256 executeAfter
    );
    
    event TransactionExecuted(bytes32 indexed txHash, address indexed target);
    event TransactionCancelled(bytes32 indexed txHash);
    
    function queueTransaction(
        address target,
        bytes calldata data
    ) external onlyRole(DEFAULT_ADMIN_ROLE) returns (bytes32) {
        bytes32 txHash = keccak256(abi.encode(target, data, block.timestamp));
        
        require(queuedTransactions[txHash].executeAfter == 0, "Transaction already queued");
        
        uint256 executeAfter = block.timestamp + delay;
        queuedTransactions[txHash] = QueuedTransaction({
            target: target,
            data: data,
            executeAfter: executeAfter,
            executed: false
        });
        
        emit TransactionQueued(txHash, target, data, executeAfter);
        return txHash;
    }
    
    function executeTransaction(bytes32 txHash) 
        external onlyRole(DEFAULT_ADMIN_ROLE) {
        QueuedTransaction storage txn = queuedTransactions[txHash];
        
        require(txn.executeAfter != 0, "Transaction not queued");
        require(!txn.executed, "Transaction already executed");
        require(block.timestamp >= txn.executeAfter, "Transaction still locked");
        require(
            block.timestamp <= txn.executeAfter + 7 days,
            "Transaction expired"
        );
        
        txn.executed = true;
        
        (bool success, bytes memory returnData) = txn.target.call(txn.data);
        require(success, string(returnData));
        
        emit TransactionExecuted(txHash, txn.target);
    }
    
    function cancelTransaction(bytes32 txHash) 
        external onlyRole(DEFAULT_ADMIN_ROLE) {
        QueuedTransaction storage txn = queuedTransactions[txHash];
        
        require(txn.executeAfter != 0, "Transaction not queued");
        require(!txn.executed, "Transaction already executed");
        
        delete queuedTransactions[txHash];
        emit TransactionCancelled(txHash);
    }
}

// ============================================================================
// 8. IMPROVED INVESTMENT MANAGER WITH BETTER KYB
// ============================================================================

contract ImprovedInvestmentManager {
    struct KYBValidator {
        bool active;
        uint256 addedAt;
        uint256 validationCount;
        string name;
    }
    
    mapping(address => KYBValidator) public kybValidators;
    address[] public validatorList;
    
    struct SignatureInfo {
        bool used;
        uint256 usedAt;
        address validator;
    }
    
    mapping(bytes32 => SignatureInfo) public signatureRegistry;
    
    // Enhanced signature validation
    function verifyKYBSignatureEnhanced(
        address _wallet,
        uint256 _nonce,
        uint256 _expiry,
        bytes memory _signature
    ) public view returns (bool isValid, address validator) {
        require(validatorList.length > 0, "No KYB validators set");
        require(block.timestamp <= _expiry, "Signature expired");
        require(_expiry <= block.timestamp + 24 hours, "Expiry too far in future");
        
        // Validate chain ID and contract address
        uint256 currentChainId = block.chainid;
        require(currentChainId != 0, "Invalid chain ID");
        
        // Create message hash with additional entropy
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "KYB_VALIDATION_V2", // Version to prevent old signature reuse
                _wallet,
                _nonce,
                _expiry,
                currentChainId,
                address(this),
                block.number / 100 // Add block range for additional security
            )
        );
        
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address recoveredSigner = ethSignedMessageHash.recover(_signature);
        
        if (kybValidators[recoveredSigner].active) {
            return (true, recoveredSigner);
        }
        
        return (false, address(0));
    }
    
    function routeInvestmentWithEnhancedKYB(
        address _offeringAddress,
        address _paymentToken,
        uint256 _paymentAmount,
        uint256 _nonce,
        uint256 _expiry,
        bytes memory _signature
    ) external payable {
        (bool isValid, address validator) = verifyKYBSignatureEnhanced(
            msg.sender, _nonce, _expiry, _signature
        );
        require(isValid, "Invalid KYB signature");
        
        // Create signature hash for tracking
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "KYB_VALIDATION_V2",
                msg.sender,
                _nonce,
                _expiry,
                block.chainid,
                address(this),
                block.number / 100
            )
        );
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        
        // Check and mark signature as used
        require(!signatureRegistry[ethSignedMessageHash].used, "Signature already used");
        signatureRegistry[ethSignedMessageHash] = SignatureInfo({
            used: true,
            usedAt: block.timestamp,
            validator: validator
        });
        
        // Update validator stats
        kybValidators[validator].validationCount++;
        
        // Proceed with investment
        Offering offering = Offering(payable(_offeringAddress));
        uint256 tokensReceivedAmount;
        
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
        
        emit KYBValidatedInvestment(
            msg.sender,
            _offeringAddress,
            _paymentToken,
            _paymentAmount,
            tokensReceivedAmount,
            keccak256(_signature),
            validator
        );
    }
    
    event KYBValidatedInvestment(
        address indexed investor,
        address indexed offeringAddress,
        address indexed paymentToken,
        uint256 paidAmount,
        uint256 tokensReceived,
        bytes32 signatureHash,
        address validator
    );
}

// ============================================================================
// 9. ENHANCED ERROR HANDLING
// ============================================================================

library ErrorLibrary {
    // Investment errors
    error InvestmentBelowMinimum(uint256 provided, uint256 minimum);
    error InvestmentAboveMaximum(uint256 provided, uint256 maximum);
    error InvestmentExceedsCap(uint256 provided, uint256 remaining);
    error SaleNotActive(uint256 currentTime, uint256 startTime, uint256 endTime);
    
    // Oracle errors
    error OracleNotSet(address token);
    error OraclePriceInvalid(int224 price);
    error OraclePriceStale(uint256 staleness, uint256 maxStaleness);
    error OraclePriceDeviation(uint256 deviation, uint256 maxDeviation);
    
    // Payout errors
    error PayoutPeriodNotAvailable(uint256 currentTime, uint256 nextPayoutTime);
    error PayoutAmountTooLarge(uint256 amount, uint256 maxAmount);
    error PayoutCalculationOverflow(uint256 value1, uint256 value2);
    
    // Access control errors
    error UnauthorizedCaller(address caller, address expected);
    error InsufficientPermissions(address caller, bytes32 requiredRole);
    error MultiSigThresholdNotMet(uint256 confirmations, uint256 required);
    
    function validateInvestmentAmount(
        uint256 amount,
        uint256 minInvestment,
        uint256 maxInvestment
    ) internal pure {
        if (amount < minInvestment) {
            revert InvestmentBelowMinimum(amount, minInvestment);
        }
        if (amount > maxInvestment) {
            revert InvestmentAboveMaximum(amount, maxInvestment);
        }
    }
    
    function validateSaleActive(
        uint256 startDate,
        uint256 endDate,
        bool isClosed,
        bool isCancelled
    ) internal view {
        require(!isClosed, "Sale is closed");
        require(!isCancelled, "Sale is cancelled");
        
        if (block.timestamp < startDate || block.timestamp >= endDate) {
            revert SaleNotActive(block.timestamp, startDate, endDate);
        }
    }
}

// ============================================================================
// 10. COMPREHENSIVE MONITORING SYSTEM
// ============================================================================

contract MonitoringSystem {
    struct SystemMetrics {
        uint256 totalInvestments;
        uint256 totalVolume;
        uint256 totalPayouts;
        uint256 totalEmergencyUnlocks;
        uint256 lastUpdated;
    }
    
    SystemMetrics public metrics;
    
    // Risk scoring system
    mapping(address => uint256) public userRiskScores;
    mapping(address => uint256) public contractRiskScores;
    
    event RiskAlert(
        address indexed entity,
        string riskType,
        uint256 riskScore,
        string description
    );
    
    function updateRiskScore(
        address entity,
        uint256 newScore,
        string memory riskType
    ) internal {
        uint256 oldScore = userRiskScores[entity];
        userRiskScores[entity] = newScore;
        
        if (newScore > 7000) { // High risk threshold (70%)
            emit RiskAlert(entity, riskType, newScore, "High risk detected");
        }
    }
    
    function calculateInvestmentRisk(
        address investor,
        uint256 amount,
        uint256 frequency
    ) internal pure returns (uint256 riskScore) {
        // Simple risk calculation
        uint256 amountRisk = amount > 10000e18 ? 3000 : 1000; // 30% or 10%
        uint256 frequencyRisk = frequency > 10 ? 2000 : 500;   // 20% or 5%
        
        riskScore = amountRisk + frequencyRisk;
        if (riskScore > 10000) riskScore = 10000; // Cap at 100%
    }
    
    function monitorInvestment(
        address investor,
        uint256 amount
    ) internal {
        // Update metrics
        metrics.totalInvestments++;
        metrics.totalVolume += amount;
        metrics.lastUpdated = block.timestamp;
        
        // Calculate and update risk score
        uint256 frequency = getInvestmentFrequency(investor);
        uint256 riskScore = calculateInvestmentRisk(investor, amount, frequency);
        updateRiskScore(investor, riskScore, "investment");
    }
    
    function getInvestmentFrequency(address investor) 
        internal view returns (uint256) {
        // Implementation would track investment frequency
        return 1; // Placeholder
    }
}

// ============================================================================
// USAGE EXAMPLE: SECURE OFFERING CONTRACT
// ============================================================================

contract SecureOffering is 
    ImprovedOracleManager,
    SafeExternalCalls,
    CircuitBreaker,
    TimelockGovernance,
    MonitoringSystem
{
    using ValidationLibrary for uint256;
    using ValidationLibrary for address;
    
    function secureInvest(
        address paymentToken,
        address investor,
        uint256 paymentAmount
    ) external 
        payable 
        nonReentrant 
        whenNotPaused 
        onlyInvestmentManager
        withinCircuitBreakerLimits(paymentAmount)
        returns (uint256) 
    {
        // Enhanced validation
        investor.validateAddress();
        paymentAmount.validateAmount(minInvestment, maxInvestment);
        
        ValidationLibrary.validateSaleActive(
            startDate, endDate, isSaleClosed, isOfferingCancelled
        );
        
        require(whitelistedPaymentTokens[paymentToken], "Token not whitelisted");
        
        // Secure USD value calculation
        uint256 usdValue = getSecureUSDValue(paymentToken, paymentAmount);
        
        // Rest of investment logic with enhanced security...
        
        // Monitor the investment
        monitorInvestment(investor, usdValue);
        
        return tokensToReceive;
    }
}