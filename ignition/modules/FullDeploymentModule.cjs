const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");
const { ethers } = require("hardhat");

module.exports = buildModule("FullDeploymentModule", (m) => {
  const deployer = m.getAccount(0);

  // 1) Deploy MockERC20 tokens for testing
  const mockToken = m.contract("MockERC20", ["Mock Sale Token", "MST"], { id: "MockERC20_SaleToken" });

  
  const usdtOracle = m.contract("MockV3Aggregator", [
    ethers.parseUnits("1.0", 18), // 1 USDT = 1 USD
    true // fresh data
  ], { id: "MockV3Aggregator_UsdtOracle" });

  // Calculate future dates for WrappedToken
  const now = Math.floor(Date.now() / 1000); // Current timestamp in seconds
  const oneDay = 24 * 60 * 60;
  const oneYear = 365 * oneDay;

  // 3) Deploy a WrappedToken contract directly
  const wrappedTokenConfig = {
    name: "Directly Deployed Wrapped USDT",
    symbol: "DD-wUSDT",
    peggedToken: mockToken,
    payoutToken: mockToken,
    maturityDate: now + 2 * oneYear, // Matures in 2 years
    payoutAPR: 500, // 5% APY (500 basis points)
    offeringContract: deployer, // Placeholder, will be updated if an Offering is deployed directly
    admin: deployer,
    payoutPeriodDuration: oneYear, // Yearly payouts
  };
  const directWrappedToken = m.contract("WRAPPEDTOKEN", [wrappedTokenConfig], { id: "DirectWrappedToken" });

  // 4) Deploy the WrappedTokenFactory contract
  const wrappedTokenFactory = m.contract("WrappedTokenFactory");

  // 5) Deploy the OfferingFactory contract with WrappedTokenFactory address
  const offeringFactory = m.contract("OfferingFactory", [wrappedTokenFactory]);

  // 6) Deploy the InvestmentManager contract
  const investmentManager = m.contract("InvestmentManager");

  // 7) Deploy the Escrow contract with proper config
  const escrow = m.contract("Escrow", [{ owner: deployer }]);

  // 8) Deploy an Offering contract directly
  const directOffering = m.contract("Offering", [], { id: "DirectOffering" });



  return { 
    // Core contracts
    offeringFactory, 
    wrappedTokenFactory, 
    investmentManager, 
    escrow,
    directWrappedToken, // Return the directly deployed WrappedToken
    directOffering, // Return the directly deployed Offering

    // Mock tokens for testing
    mockToken,
    // Mock oracles for testing
    usdtOracle
  };
});
