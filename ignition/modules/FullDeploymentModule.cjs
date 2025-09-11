const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");
const { ethers } = require("hardhat");

module.exports = buildModule("FullDeploymentModule", (m) => {
  const deployer = m.getAccount(0);

  // 1) Deploy MockERC20 tokens for testing
  const mockSaleToken = m.contract("MockERC20", ["Mock Sale Token", "MST"], { id: "MockERC20_SaleToken" });
  const mockPaymentToken = m.contract("MockERC20", ["Mock Payment Token", "MPT"], { id: "MockERC20_PaymentToken" });
  const mockUSDT = m.contract("MockERC20", ["Mock USDT", "MUSDT"], { id: "MockERC20_USDT" });
  const mockPayoutToken = m.contract("MockERC20", ["Mock Payout Token", "MPAYOUT"], { id: "MockERC20_PayoutToken" });

  // Initialize tokens with some supply for the deployer
  m.call(mockSaleToken, "mint", [deployer, ethers.parseUnits("1000000", 18)]);
  m.call(mockPaymentToken, "mint", [deployer, ethers.parseUnits("1000000", 18)]);
  m.call(mockUSDT, "mint", [deployer, ethers.parseUnits("1000000", 18)]);
  m.call(mockPayoutToken, "mint", [deployer, ethers.parseUnits("1000000", 18)]);

  // 2) Deploy Mock Oracles for price feeds
  const paymentOracle = m.contract("MockV3Aggregator", [
    ethers.parseUnits("1.0", 18), // 1 MPT = 1 USD
    true // fresh data
  ], { id: "MockV3Aggregator_PaymentOracle" });
  
  const ethOracle = m.contract("MockV3Aggregator", [
    ethers.parseUnits("2000", 18), // 1 ETH = 2000 USD
    true // fresh data
  ], { id: "MockV3Aggregator_EthOracle" });
  
  const usdtOracle = m.contract("MockV3Aggregator", [
    ethers.parseUnits("1.0", 18), // 1 USDT = 1 USD
    true // fresh data
  ], { id: "MockV3Aggregator_UsdtOracle" });

  // 3) Deploy the WrappedTokenFactory contract first
  const wrappedTokenFactory = m.contract("WrappedTokenFactory");

  // 4) Deploy the OfferingFactory contract with WrappedTokenFactory address
  const offeringFactory = m.contract("OfferingFactory", [wrappedTokenFactory]);

  // 5) Deploy the InvestmentManager contract
  const investmentManager = m.contract("InvestmentManager");

  // 6) Deploy the Escrow contract with proper config
  const escrow = m.contract("Escrow", [{ owner: deployer }]);

  // 7) Set USDT config in OfferingFactory
  m.call(offeringFactory, "setUSDTConfig", [mockUSDT, usdtOracle]);

  // 8) Create an Offering with APY enabled
  const now = Math.floor(Date.now() / 1000); // Current timestamp in seconds
  const oneDay = 24 * 60 * 60;
  const oneYear = 365 * oneDay;

  const createOfferingConfig = {
    saleToken: mockSaleToken,
    minInvestment: ethers.parseUnits("100", 18),
    maxInvestment: ethers.parseUnits("10000", 18),
    startDate: now + 2 * oneDay, // Starts in two days to ensure it's strictly in the future
    endDate: now + 30 * oneDay, // Ends in 30 days
    apyEnabled: true,
    softCap: ethers.parseUnits("100000", 18),
    fundraisingCap: ethers.parseUnits("1000000", 18),
    tokenPrice: ethers.parseUnits("1", 18), // 1 SaleToken = 1 USD
    tokenOwner: deployer,
    escrowAddress: escrow,
    investmentManager: investmentManager,
    payoutTokenAddress: mockPayoutToken,
    payoutRate: 500, // 5% APY (500 basis points)
    payoutPeriodDuration: oneYear, // Yearly payouts
    maturityDate: now + 2 * oneYear, // Matures in 2 years
  };

  const offering = m.call(offeringFactory, "createOffering", [createOfferingConfig]);

  return { 
    // Core contracts
    offeringFactory, 
    wrappedTokenFactory, 
    investmentManager, 
    escrow,
    offering, // Return the created offering

    // Mock tokens for testing
    mockSaleToken,
    mockPaymentToken,
    mockUSDT,
    mockPayoutToken,
    
    // Mock oracles for testing
    paymentOracle,
    ethOracle,
    usdtOracle
  };
});
