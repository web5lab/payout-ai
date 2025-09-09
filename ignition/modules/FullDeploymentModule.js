const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("FullDeploymentModule", (m) => {
  const deployer = m.getAccount(0);
  const thirtyDaysInFuture = Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 30);

  // 1) Deploy MockERC20
  const mockERC20 = m.contract("MockERC20", ["Mock Stablecoin", "MSC"]);

  // 2) Deploy the OfferingFactory contract
  const factory = m.contract("OfferingFactory");

  // 3) Deploy the InvestmentManager contract
  const investmentManager = m.contract("InvestmentManager");

  // 4) Deploy the Escrow contract
  const escrow = m.contract("Escrow", [{ owner: deployer }]);

  // 5) Deploy the WrappedToken contract
  const wrappedToken = m.contract("WRAPEDTOKEN", [{
    name: "Wrapped Token",
    symbol: "WTOK",
    peggedToken: mockERC20,
    payoutToken: mockERC20,
    maturityDate: thirtyDaysInFuture,
    payoutRate: 100, // 1% payout rate
    offeringContract: factory,
  }]);

  // 6) deploy the Payout contract

  return { factory, investmentManager, escrow, wrappedToken, mockERC20 };
});
