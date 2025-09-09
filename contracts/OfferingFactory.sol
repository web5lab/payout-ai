// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Offering.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./WrapedToken.sol";

// Import the WrapedTokenConfig struct
import {WrapedTokenConfig} from "./WrapedToken.sol";

struct CreateOfferingConfig {
    address saleToken;
    uint256 minInvestment;
    uint256 maxInvestment;
    uint256 startDate;
    uint256 endDate;
    uint256 maturityDate;
    bool autoTransfer;
    bool apyEnabled;
    uint256 fundraisingCap;
    uint256 tokenPrice;
    address tokenOwner;
    address escrowAddress;
    address investmentManager;
    address payoutTokenAddress;
    uint256 payoutRate;
    IWRAPEDTOKEN.PayoutFrequency defaultPayoutFrequency;
}

struct CreateOfferingWithTokensConfig {
    address saleToken;
    uint256 minInvestment;
    uint256 maxInvestment;
    uint256 startDate;
    uint256 endDate;
    uint256 maturityDate;
    bool autoTransfer;
    bool apyEnabled;
    uint256 fundraisingCap;
    uint256 tokenPrice;
    address tokenOwner;
    address escrowAddress;
    address investmentManager;
    address payoutTokenAddress;
    uint256 payoutRate;
    IWRAPEDTOKEN.PayoutFrequency defaultPayoutFrequency;
    address[] paymentTokens;
    address[] oracles;
}

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

    function createOffering(CreateOfferingConfig memory config) external onlyOwner returns (address offeringAddress) {
        require(config.escrowAddress != address(0), "Invalid escrow address");
        require(config.payoutTokenAddress != address(0), "Invalid payout token address");

        address wrappedTokenAddress = address(0);

        Offering offering = new Offering();
        if (config.apyEnabled) {
            wrappedTokenAddress = address(
                new WRAPEDTOKEN(
                    "Wrapped Token",
                    "WRT",
                    config.saleToken,
                    config.payoutTokenAddress,
                    config.maturityDate,
                    config.payoutRate,
                    address(offering)
                )
            );
        }
        
        InitConfig memory initConfig = InitConfig({
            saleToken: config.saleToken,
            minInvestment: config.minInvestment,
            maxInvestment: config.maxInvestment,
            startDate: config.startDate,
            endDate: config.endDate,
            maturityDate: config.maturityDate,
            autoTransfer: config.autoTransfer,
            fundraisingCap: config.fundraisingCap,
            tokenPrice: config.tokenPrice,
            tokenOwner: config.tokenOwner,
            escrowAddress: config.escrowAddress,
            apyEnabled: config.apyEnabled,
            wrappedTokenAddress: wrappedTokenAddress,
            investmentManager: config.investmentManager,
            payoutTokenAddress: config.payoutTokenAddress,
            payoutRate: config.payoutRate,
            defaultPayoutFrequency: config.defaultPayoutFrequency
        });
        
        offering.initialize(initConfig);

        offeringAddress = address(offering);

        offerings[offeringCount] = offeringAddress;
        offeringOwners[offeringAddress] = msg.sender;
        offeringsByTokenOwner[config.tokenOwner].push(offeringCount);

        emit OfferingDeployed(
            offeringCount,
            msg.sender,
            offeringAddress,
            config.tokenOwner
        );
        offeringCount++;
    }

    /**
     * @dev Create offering with multiple payment tokens and their oracles
     * @param config Configuration struct containing all offering parameters
     * @return offeringAddress Address of the deployed offering contract
     */
    function createOfferingWithPaymentTokens(CreateOfferingWithTokensConfig memory config) external onlyOwner returns (address offeringAddress) {
        require(
            config.paymentTokens.length == config.oracles.length,
            "Array length mismatch"
        );
        require(config.paymentTokens.length > 0, "No payment tokens provided");
        require(config.escrowAddress != address(0), "Invalid escrow address");
        require(config.payoutTokenAddress != address(0), "Invalid payout token address");

        address wrappedTokenAddress = address(0);

        // Deploy the offering contract
        Offering offering = new Offering();

        if (config.apyEnabled) {
            wrappedTokenAddress = address(
                new WRAPEDTOKEN(
                    "Wrapped Token",
                    "WRT",
                    config.saleToken,
                    config.payoutTokenAddress,
                    config.maturityDate,
                    config.payoutRate,
                    address(offering)
                )
            );
        }
        
        InitConfig memory initConfig = InitConfig({
            saleToken: config.saleToken,
            minInvestment: config.minInvestment,
            maxInvestment: config.maxInvestment,
            startDate: config.startDate,
            endDate: config.endDate,
            maturityDate: config.maturityDate,
            autoTransfer: config.autoTransfer,
            fundraisingCap: config.fundraisingCap,
            tokenPrice: config.tokenPrice,
            tokenOwner: config.tokenOwner,
            escrowAddress: config.escrowAddress,
            apyEnabled: config.apyEnabled,
            wrappedTokenAddress: wrappedTokenAddress,
            investmentManager: config.investmentManager,
            payoutTokenAddress: config.payoutTokenAddress,
            payoutRate: config.payoutRate,
            defaultPayoutFrequency: config.defaultPayoutFrequency
        });
        
        offering.initialize(initConfig);

        offeringAddress = address(offering);

        // Configure all payment tokens and their oracles
        for (uint256 i = 0; i < config.paymentTokens.length; i++) {
            // Allow address(0) for native ETH, but ensure a valid oracle is provided for non-native tokens
            if (config.paymentTokens[i] != address(0)) {
                require(config.oracles[i] != address(0), "Invalid oracle for ERC20 token");
                offering.setTokenOracle(config.paymentTokens[i], config.oracles[i]);
            } else {
                // For native ETH (address(0)), an oracle is still required by Offering.sol's getUSDValue
                // The oracle address for native ETH should be a valid mock oracle in the test.
                require(config.oracles[i] != address(0), "Invalid oracle for native ETH");
                offering.setTokenOracle(config.paymentTokens[i], config.oracles[i]);
            }
            offering.setWhitelistedPaymentToken(config.paymentTokens[i], true);
        }

        // Store offering data
        offerings[offeringCount] = offeringAddress;
        offeringOwners[offeringAddress] = msg.sender;
        offeringsByTokenOwner[config.tokenOwner].push(offeringCount);

        emit OfferingDeployed(
            offeringCount,
            msg.sender,
            offeringAddress,
            config.tokenOwner
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
