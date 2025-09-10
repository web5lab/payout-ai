// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Offering.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "./interfaces/IWrappedTokenFactory.sol";

// Import the WrapedTokenConfig struct
import {WrapedTokenConfig} from "./WrapedToken.sol";

struct CreateOfferingConfig {
    address saleToken;
    uint256 minInvestment;
    uint256 maxInvestment;
    uint256 startDate;
    uint256 endDate;
    uint256 maturityDate;
    bool apyEnabled;
    uint256 fundraisingCap;
    uint256 tokenPrice;
    address tokenOwner;
    address escrowAddress;
    address investmentManager;
    address payoutTokenAddress;
    uint256 payoutRate;
    uint256 payoutPeriodDuration; // Duration between payouts (e.g., 30 days = 2592000 seconds)
    uint256 firstPayoutDate; // When first payout becomes available
    // Optional custom names - if empty, will use token name + "Wrapped"
    string customWrappedName;
    string customWrappedSymbol;
}

/**
 * @title OfferingFactory
 * @dev Factory contract to deploy and manage Offering contracts.
 */
contract OfferingFactory is Ownable {
    uint256 public count;
    mapping(uint256 => address) public offerings;
    mapping(address => address) public owners;
    mapping(address => uint256[]) public byOwner;

    // USDT configuration
    address public usdtAddress;
    address public usdtOracleAddress;

    // WrappedTokenFactory reference
    IWrappedTokenFactory public wrappedTokenFactory;

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

    event WrappedTokenFactoryUpdated(
        address indexed oldFactory,
        address indexed newFactory
    );

    constructor(address _wrappedTokenFactory) Ownable(msg.sender) {
        require(_wrappedTokenFactory != address(0), "Invalid factory");
        wrappedTokenFactory = IWrappedTokenFactory(_wrappedTokenFactory);
    }

    function setWrappedTokenFactory(
        address _wrappedTokenFactory
    ) external onlyOwner {
        require(_wrappedTokenFactory != address(0), "Invalid factory");
        address oldFactory = address(wrappedTokenFactory);
        wrappedTokenFactory = IWrappedTokenFactory(_wrappedTokenFactory);
        emit WrappedTokenFactoryUpdated(oldFactory, _wrappedTokenFactory);
    }

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

    /**
     * @dev Generate wrapped token name and symbol based on the sale token
     * @param saleToken Address of the sale token
     * @param customName Custom name (if empty, will generate from token name)
     * @param customSymbol Custom symbol (if empty, will generate from token symbol)
     * @return name The generated or custom name
     * @return symbol The generated or custom symbol
     */
    function _generateWrappedTokenNames(
        address saleToken,
        string memory customName,
        string memory customSymbol
    ) internal view returns (string memory name, string memory symbol) {
        // If custom names are provided, use them
        if (bytes(customName).length > 0) {
            name = customName;
        } else {
            // Generate name from sale token
            try IERC20Metadata(saleToken).name() returns (string memory tokenName) {
                name = string(abi.encodePacked(tokenName, " Wrapped"));
            } catch {
                name = "Wrapped Token"; // Fallback name
            }
        }

        if (bytes(customSymbol).length > 0) {
            symbol = customSymbol;
        } else {
            // Generate symbol from sale token
            try IERC20Metadata(saleToken).symbol() returns (string memory tokenSymbol) {
                symbol = string(abi.encodePacked("w", tokenSymbol));
            } catch {
                symbol = "WRT"; // Fallback symbol
            }
        }
    }

    function createOffering(
        CreateOfferingConfig memory config
    ) external onlyOwner returns (address offeringAddress) {
        require(config.escrowAddress != address(0), "Invalid escrow address");
        require(
            config.payoutTokenAddress != address(0),
            "Invalid payout token address"
        );

        address wrappedTokenAddress = address(0);

        Offering offering = new Offering();
        if (config.apyEnabled) {
            // Generate wrapped token names
            (string memory wrappedName, string memory wrappedSymbol) = _generateWrappedTokenNames(
                config.saleToken,
                config.customWrappedName,
                config.customWrappedSymbol
            );

            WrapedTokenConfig memory wrappedConfig = WrapedTokenConfig({
                name: wrappedName,
                symbol: wrappedSymbol,
                peggedToken: config.saleToken,
                payoutToken: config.payoutTokenAddress,
                maturityDate: config.maturityDate,
                payoutRate: config.payoutRate,
                offeringContract: address(offering),
                admin: msg.sender,
                payoutPeriodDuration: config.payoutPeriodDuration,
                firstPayoutDate: config.firstPayoutDate
            });
            wrappedTokenAddress = wrappedTokenFactory.createWrappedToken(
                wrappedConfig
            );
        }

        InitConfig memory initConfig = InitConfig({
            saleToken: config.saleToken,
            minInvestment: config.minInvestment,
            maxInvestment: config.maxInvestment,
            startDate: config.startDate,
            endDate: config.endDate,
            maturityDate: config.maturityDate,
            fundraisingCap: config.fundraisingCap,
            tokenPrice: config.tokenPrice,
            tokenOwner: config.tokenOwner,
            escrowAddress: config.escrowAddress,
            apyEnabled: config.apyEnabled,
            wrappedTokenAddress: wrappedTokenAddress,
            investmentManager: config.investmentManager,
            payoutTokenAddress: config.payoutTokenAddress,
            payoutRate: config.payoutRate
        });

        offering.initialize(initConfig);
        offeringAddress = address(offering);

        _storeOffering(offeringAddress, config.tokenOwner);
    }

    function createOfferingWithPaymentTokens(
        CreateOfferingConfig memory config,
        address[] memory paymentTokens,
        address[] memory oracles
    ) external onlyOwner returns (address offeringAddress) {
        require(
            paymentTokens.length == oracles.length,
            "Array length mismatch"
        );
        require(paymentTokens.length > 0, "No payment tokens provided");
        require(config.escrowAddress != address(0), "Invalid escrow address");
        require(
            config.payoutTokenAddress != address(0),
            "Invalid payout token address"
        );

        address wrappedTokenAddress = address(0);
        Offering offering = new Offering();

        if (config.apyEnabled) {
            // Generate wrapped token names
            (string memory wrappedName, string memory wrappedSymbol) = _generateWrappedTokenNames(
                config.saleToken,
                config.customWrappedName,
                config.customWrappedSymbol
            );

            WrapedTokenConfig memory wrappedConfig = WrapedTokenConfig({
                name: wrappedName,
                symbol: wrappedSymbol,
                peggedToken: config.saleToken,
                payoutToken: config.payoutTokenAddress,
                maturityDate: config.maturityDate,
                payoutRate: config.payoutRate,
                offeringContract: address(offering),
                admin: msg.sender,
                payoutPeriodDuration: config.payoutPeriodDuration,
                firstPayoutDate: config.firstPayoutDate
            });
            wrappedTokenAddress = wrappedTokenFactory.createWrappedToken(
                wrappedConfig
            );
        }

        InitConfig memory initConfig = InitConfig({
            saleToken: config.saleToken,
            minInvestment: config.minInvestment,
            maxInvestment: config.maxInvestment,
            startDate: config.startDate,
            endDate: config.endDate,
            maturityDate: config.maturityDate,
            fundraisingCap: config.fundraisingCap,
            tokenPrice: config.tokenPrice,
            tokenOwner: config.tokenOwner,
            escrowAddress: config.escrowAddress,
            apyEnabled: config.apyEnabled,
            wrappedTokenAddress: wrappedTokenAddress,
            investmentManager: config.investmentManager,
            payoutTokenAddress: config.payoutTokenAddress,
            payoutRate: config.payoutRate
        });

        offering.initialize(initConfig);
        offeringAddress = address(offering);

        _configurePaymentTokens(offering, paymentTokens, oracles);
        _storeOffering(offeringAddress, config.tokenOwner);
    }

    function _configurePaymentTokens(
        Offering offering,
        address[] memory paymentTokens,
        address[] memory oracles
    ) internal {
        for (uint256 i = 0; i < paymentTokens.length; i++) {
            if (paymentTokens[i] != address(0)) {
                require(
                    oracles[i] != address(0),
                    "Invalid oracle for ERC20 token"
                );
            } else {
                require(
                    oracles[i] != address(0),
                    "Invalid oracle for native ETH"
                );
            }
            offering.setTokenOracle(paymentTokens[i], oracles[i]);
            offering.setWhitelistedPaymentToken(paymentTokens[i], true);
        }
    }

    function _storeOffering(
        address offeringAddress,
        address tokenOwner
    ) internal {
        offerings[count] = offeringAddress;
        owners[offeringAddress] = msg.sender;
        byOwner[tokenOwner].push(count);

        emit OfferingDeployed(count, msg.sender, offeringAddress, tokenOwner);
        count++;
    }

    function getOfferingAddress(
        uint256 offeringId
    ) external view returns (address) {
        return offerings[offeringId];
    }

    function getOfferingOwner(
        address offeringAddress
    ) external view returns (address) {
        return owners[offeringAddress];
    }

    function getOfferingIdsByTokenOwner(
        address tokenOwner
    ) external view returns (uint256[] memory) {
        return byOwner[tokenOwner];
    }

    function getAllOfferings() external view returns (address[] memory) {
        address[] memory result = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = offerings[i];
        }
        return result;
    }

    function getUSDTConfig()
        external
        view
        returns (address usdtToken, address usdtOracle)
    {
        return (usdtAddress, usdtOracleAddress);
    }
}