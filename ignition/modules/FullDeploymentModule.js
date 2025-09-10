const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("FullDeploymentModule", (m) => {
  const deployer = m.getAccount(0);

  // 1) Deploy MockERC20 tokens for testing
  const mockSaleToken = m.contract("MockERC20", ["Mock Sale Token", "MST"]);
  const mockPaymentToken = m.contract("MockERC20", ["Mock Payment Token", "MPT"]);
  const mockUSDT = m.contract("MockERC20", ["Mock USDT", "MUSDT"]);
  const mockPayoutToken = m.contract("MockERC20", ["Mock Payout Token", "MPAYOUT"]);

  // 2) Deploy Mock Oracles for price feeds
  const paymentOracle = m.contract("MockV3Aggregator", [
    ethers.parseUnits("1.0", 18), // 1 MPT = 1 USD
    true // fresh data
  ]);
  
  const ethOracle = m.contract("MockV3Aggregator", [
    ethers.parseUnits("2000", 18), // 1 ETH = 2000 USD
    true // fresh data
  ]);
  
  const usdtOracle = m.contract("MockV3Aggregator", [
    ethers.parseUnits("1.0", 18), // 1 USDT = 1 USD
    true // fresh data
  ]);

  // 3) Deploy the WrappedTokenFactory contract first
  const wrappedTokenFactory = m.contract("WrappedTokenFactory");

  // 4) Deploy the OfferingFactory contract with WrappedTokenFactory address
  const offeringFactory = m.contract("OfferingFactory", [wrappedTokenFactory]);

  // 5) Deploy the InvestmentManager contract
  const investmentManager = m.contract("InvestmentManager");

  // 6) Deploy the Escrow contract with proper config
  const escrow = m.contract("Escrow", [{ owner: deployer }]);

  return { 
    // Core contracts
    offeringFactory, 
    wrappedTokenFactory, 
    investmentManager, 
    escrow,
    
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