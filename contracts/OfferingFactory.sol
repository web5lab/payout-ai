// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Offering.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./WrapedToken.sol";
/**
 * @title OfferingFactory
 * @dev Factory contract to deploy and manage Offering contracts.
 */
contract OfferingFactory is Ownable {
    uint256 public offeringCount;
    mapping(uint256 => address) public offerings;
    mapping(address => address) public offeringOwners;
    mapping(address => uint256[]) public offeringsByTokenOwner;

    // USDT configuration
    address public usdtAddress;
    address public usdtOracleAddress;

    event OfferingDeployed(
        uint256 indexed offeringId,
        address indexed creator,
        address indexed offeringAddress,
        address tokenOwner
    );

    event USDTConfigUpdated(
        address indexed usdtAddress,
        address indexed usdtOracleAddress
    );

    // ✅ For OpenZeppelin v5.x
    constructor() Ownable(msg.sender) {}

    /**
     * @dev Set USDT contract address and oracle address
     * @param _usdtAddress The USDT token contract address
     * @param _usdtOracleAddress The API3 oracle address for USDT/USD price feed
     */
    function setUSDTConfig(
        address _usdtAddress,
        address _usdtOracleAddress
    ) external onlyOwner {
        require(_usdtAddress != address(0), "Invalid USDT address");
        require(_usdtOracleAddress != address(0), "Invalid oracle address");

        usdtAddress = _usdtAddress;
        usdtOracleAddress = _usdtOracleAddress;

        emit USDTConfigUpdated(_usdtAddress, _usdtOracleAddress);
    }

    function createOffering(
        address saleToken,
        uint256 minInvestment,
        uint256 maxInvestment,
        uint256 startDate,
        uint256 endDate,
        uint256 maturityDate,
        bool autoTransfer,
        bool apyEnabled,
        uint256 fundraisingCap,
        uint256 tokenPrice,
        address tokenOwner,
        address _escrowAddress,
        address investmentManager,
        address _payoutTokenAddress, // New parameter
        uint256 _payoutRate, // New parameter
        IWRAPEDTOKEN.PayoutFrequency _defaultPayoutFrequency // New parameter
    ) external onlyOwner returns (address offeringAddress) {
        require(_escrowAddress != address(0), "Invalid escrow address");
        require(_payoutTokenAddress != address(0), "Invalid payout token address");

        address wrappedTokenAddress = address(0);

        Offering offering = new Offering();
        if (apyEnabled) {
            wrappedTokenAddress = address(
                new WRAPEDTOKEN(
                    "Wrapped Token",
                    "WRT",
                    saleToken,
                    _payoutTokenAddress, // New parameter
                    maturityDate,
                    _payoutRate, // New parameter
                    address(offering)
                )
            );
        }
        offering.initialize(
            saleToken,
            minInvestment,
            maxInvestment,
            startDate,
            endDate,
            maturityDate,
            autoTransfer,
            fundraisingCap,
            tokenPrice,
            tokenOwner,
            _escrowAddress,
            apyEnabled,
            wrappedTokenAddress,
            investmentManager,
            _payoutTokenAddress, // New parameter
            _payoutRate, // New parameter
            _defaultPayoutFrequency // New parameter
        );

        offeringAddress = address(offering);

        offerings[offeringCount] = offeringAddress;
        offeringOwners[offeringAddress] = msg.sender;
        offeringsByTokenOwner[tokenOwner].push(offeringCount);

        emit OfferingDeployed(
            offeringCount,
            msg.sender,
            offeringAddress,
            tokenOwner
        );
        offeringCount++;
    }

    /**
     * @dev Create offering with multiple payment tokens and their oracles
     * @param saleToken Address of the token being sold
     * @param minInvestment Minimum investment amount in USD (18 decimals)
     * @param maxInvestment Maximum investment amount in USD (18 decimals)
     * @param maturityDate Timestamp when tokens can be claimed
     * @param autoTransfer Whether to auto-transfer tokens or require claiming
     * @param fundraisingCap Maximum amount to raise in USD (18 decimals)
     * @param tokenPrice Price per token in USD (18 decimals)
     * @param tokenOwner Address with token owner privileges
     * @param paymentTokens Array of payment token addresses
     * @param oracles Array of oracle addresses corresponding to payment tokens
     * @return offeringAddress Address of the deployed offering contract
     */
    function createOfferingWithPaymentTokens(
        address saleToken,
        uint256 minInvestment,
        uint256 maxInvestment,
        uint256 startDate,
        uint256 endDate,
        uint256 maturityDate,
        bool autoTransfer,
        bool apyEnabled,
        uint256 fundraisingCap,
        uint256 tokenPrice,
        address tokenOwner,
        address _escrowAddress,
        address investmentManager,
        address _payoutTokenAddress, // New parameter
        uint256 _payoutRate, // New parameter
        IWRAPEDTOKEN.PayoutFrequency _defaultPayoutFrequency, // New parameter
        address[] calldata paymentTokens,
        address[] calldata oracles
    ) external onlyOwner returns (address offeringAddress) {
        require(
            paymentTokens.length == oracles.length,
            "Array length mismatch"
        );
        require(paymentTokens.length > 0, "No payment tokens provided");
        require(_escrowAddress != address(0), "Invalid escrow address");
        require(_payoutTokenAddress != address(0), "Invalid payout token address");

        address wrappedTokenAddress = address(0);

        // Deploy the offering contract
        Offering offering = new Offering();

        if (apyEnabled) {
            wrappedTokenAddress = address(
                new WRAPEDTOKEN(
                    "Wrapped Token",
                    "WRT",
                    saleToken,
                    _payoutTokenAddress, // New parameter
                    maturityDate,
                    _payoutRate, // New parameter
                    address(offering)
                )
            );
        }
        offering.initialize(
            saleToken,
            minInvestment,
            maxInvestment,
            startDate,
            endDate,
            maturityDate,
            autoTransfer,
            fundraisingCap,
            tokenPrice,
            tokenOwner,
            _escrowAddress,
            apyEnabled,
            wrappedTokenAddress,
            investmentManager,
            _payoutTokenAddress, // New parameter
            _payoutRate, // New parameter
            _defaultPayoutFrequency // New parameter
        );

        offeringAddress = address(offering);

        // Configure all payment tokens and their oracles
        for (uint256 i = 0; i < paymentTokens.length; i++) {
            // Allow address(0) for native ETH, but ensure a valid oracle is provided for non-native tokens
            if (paymentTokens[i] != address(0)) {
                require(oracles[i] != address(0), "Invalid oracle for ERC20 token");
                offering.setTokenOracle(paymentTokens[i], oracles[i]);
            } else {
                // For native ETH (address(0)), an oracle is still required by Offering.sol's getUSDValue
                // The oracle address for native ETH should be a valid mock oracle in the test.
                require(oracles[i] != address(0), "Invalid oracle for native ETH");
                offering.setTokenOracle(paymentTokens[i], oracles[i]);
            }
            offering.setWhitelistedPaymentToken(paymentTokens[i], true);
        }

        // Store offering data
        offerings[offeringCount] = offeringAddress;
        offeringOwners[offeringAddress] = msg.sender;
        offeringsByTokenOwner[tokenOwner].push(offeringCount);

        emit OfferingDeployed(
            offeringCount,
            msg.sender,
            offeringAddress,
            tokenOwner
        );
        offeringCount++;
    }

    function getOfferingAddress(
        uint256 offeringId
    ) external view returns (address) {
        return offerings[offeringId];
    }

    function getOfferingOwner(
        address offeringAddress
    ) external view returns (address) {
        return offeringOwners[offeringAddress];
    }

    function getOfferingIdsByTokenOwner(
        address tokenOwner
    ) external view returns (uint256[] memory) {
        return offeringsByTokenOwner[tokenOwner];
    }

    function getAllOfferings() external view returns (address[] memory) {
        address[] memory result = new address[](offeringCount);
        for (uint256 i = 0; i < offeringCount; i++) {
            result[i] = offerings[i];
        }
        return result;
    }

    /**
     * @dev Get USDT configuration
     * @return usdtToken USDT contract address
     * @return usdtOracle USDT oracle address
     */
    function getUSDTConfig()
        external
        view
        returns (address usdtToken, address usdtOracle)
    {
        return (usdtAddress, usdtOracleAddress);
    }
}
