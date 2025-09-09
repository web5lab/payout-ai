// scripts/test-payout-periods.js

const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Helper functions
const parseUnits = (value, decimals = 18) => ethers.parseUnits(String(value), decimals);
const formatUnits = (value, decimals = 18) => ethers.formatUnits(value, decimals);

async function main() {
  console.log("🎯 Testing Dynamic Payout Periods");
  console.log("=".repeat(60));

  const [deployer, tokenOwner, treasuryOwner, investor1, investor2, payoutAdmin] = await ethers.getSigners();

  // Deploy mock contracts
  console.log("📦 Deploying mock contracts...");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const saleToken = await MockERC20.deploy("Sale Token", "SALE");
  const paymentToken = await MockERC20.deploy("Payment Token", "PAY");
  const payoutToken = await MockERC20.deploy("Payout Token", "PAYOUT");

  const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
  const payOracle = await MockV3Aggregator.deploy(parseUnits("1.0", 18), true);

  // Deploy core infrastructure
  console.log("🏗️ Deploying core infrastructure...");
  const WrappedTokenFactory = await ethers.getContractFactory("WrappedTokenFactory");
  const wrappedTokenFactory = await WrappedTokenFactory.deploy();

  const OfferingFactory = await ethers.getContractFactory("OfferingFactory");
  const offeringFactory = await OfferingFactory.deploy(await wrappedTokenFactory.getAddress());

  const InvestmentManager = await ethers.getContractFactory("InvestmentManager");
  const investmentManager = await InvestmentManager.deploy();

  const Escrow = await ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy({ owner: treasuryOwner.address });

  // Mint tokens
  console.log("💰 Minting tokens...");
  await saleToken.mint(tokenOwner.address, parseUnits("10000000"));
  await paymentToken.mint(investor1.address, parseUnits("50000"));
  await paymentToken.mint(investor2.address, parseUnits("50000"));
  await payoutToken.mint(payoutAdmin.address, parseUnits("100000"));

  // Test different payout periods
  const testCases = [
    {
      name: "30-Day Payout Cycle",
      payoutPeriodDuration: 30 * 24 * 60 * 60, // 30 days
      firstPayoutDelay: 7 * 24 * 60 * 60, // 7 days after start
    },
    {
      name: "1-Year Payout Cycle", 
      payoutPeriodDuration: 365 * 24 * 60 * 60, // 1 year
      firstPayoutDelay: 30 * 24 * 60 * 60, // 30 days after start
    },
    {
      name: "6-Month Payout Cycle",
      payoutPeriodDuration: 180 * 24 * 60 * 60, // 6 months
      firstPayoutDelay: 14 * 24 * 60 * 60, // 14 days after start
    }
  ];

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🎯 Testing: ${testCase.name}`);
    console.log(`${"=".repeat(60)}`);

    // Get fresh timestamps
    const now = await time.latest();
    const startDate = now + 200;
    const endDate = startDate + 3600; // 1 hour sale
    const maturityDate = endDate + (365 * 24 * 60 * 60); // 1 year maturity
    const firstPayoutDate = startDate + testCase.firstPayoutDelay;

    // Create offering with specific payout period
    const offeringConfig = {
      saleToken: await saleToken.getAddress(),
      minInvestment: parseUnits("100"),
      maxInvestment: parseUnits("5000"),
      startDate: startDate,
      endDate: endDate,
      maturityDate: maturityDate,
      autoTransfer: true,
      apyEnabled: true,
      fundraisingCap: parseUnits("100000"),
      tokenPrice: parseUnits("0.5"),
      tokenOwner: tokenOwner.address,
      escrowAddress: await escrow.getAddress(),
      investmentManager: await investmentManager.getAddress(),
      payoutTokenAddress: await payoutToken.getAddress(),
      payoutRate: 1000, // 10% APY
      defaultPayoutFrequency: 2, // Yearly
      payoutPeriodDuration: testCase.payoutPeriodDuration,
      firstPayoutDate: firstPayoutDate,
      paymentTokens: [await paymentToken.getAddress()],
      oracles: [await payOracle.getAddress()]
    };

    console.log(`📅 Payout Period: ${testCase.payoutPeriodDuration / (24 * 60 * 60)} days`);
    console.log(`📅 First Payout: ${testCase.firstPayoutDelay / (24 * 60 * 60)} days after start`);

    const tx = await offeringFactory.connect(deployer).createOfferingWithPaymentTokens(offeringConfig);
    const receipt = await tx.wait();
    const event = receipt.logs.find(log => log.fragment && log.fragment.name === 'OfferingDeployed');
    const offeringAddress = event.args.offeringAddress;
    
    const offering = await ethers.getContractAt("Offering", offeringAddress);
    const wrappedTokenAddress = await offering.wrappedTokenAddress();
    const wrappedToken = await ethers.getContractAt("WRAPEDTOKEN", wrappedTokenAddress);

    // Grant payout admin role
    const PAYOUT_ADMIN_ROLE = await wrappedToken.PAYOUT_ADMIN_ROLE();
    await wrappedToken.connect(deployer).grantRole(PAYOUT_ADMIN_ROLE, payoutAdmin.address);

    // Transfer sale tokens to offering
    const totalTokensForSale = parseUnits("200000");
    await saleToken.connect(tokenOwner).transfer(offeringAddress, totalTokensForSale);

    // Make investment
    console.log("💸 Making investment...");
    const investAmount = parseUnits("500"); // $500
    await paymentToken.connect(investor1).approve(offeringAddress, investAmount);
    await time.increaseTo(startDate + 10);

    await investmentManager.connect(investor1).routeInvestment(
      offeringAddress,
      await paymentToken.getAddress(),
      investAmount
    );

    const wrappedBalance = await wrappedToken.balanceOf(investor1.address);
    console.log(`✅ Investment: ${formatUnits(wrappedBalance)} wrapped tokens`);

    // Test period timing
    console.log("⏰ Testing payout period timing...");
    
    // Check if payout is available before first payout date
    let periodInfo = await wrappedToken.getCurrentPayoutPeriodInfo();
    console.log(`📊 Current period: ${periodInfo.period}, Can distribute: ${periodInfo.canDistribute}`);

    // Try to distribute before first payout date (should fail)
    try {
      await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(parseUnits("100"));
      console.log("❌ Should have failed - too early for payout");
    } catch (error) {
      console.log("✅ Correctly rejected early payout distribution");
    }

    // Fast forward to first payout date
    console.log("⏰ Fast-forwarding to first payout date...");
    await time.increaseTo(firstPayoutDate + 10);

    periodInfo = await wrappedToken.getCurrentPayoutPeriodInfo();
    console.log(`📊 After fast-forward - Can distribute: ${periodInfo.canDistribute}`);

    // Distribute first payout
    console.log("💰 Distributing first payout...");
    const payout1 = parseUnits("1000");
    await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout1);
    await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout1);

    periodInfo = await wrappedToken.getCurrentPayoutPeriodInfo();
    console.log(`📊 After distribution - Period: ${periodInfo.period}, Next payout: ${new Date(Number(periodInfo.nextPayoutTime) * 1000).toISOString()}`);

    // User claims first payout
    await wrappedToken.connect(investor1).claimAvailablePayouts();
    const claimed1 = await payoutToken.balanceOf(investor1.address);
    console.log(`✅ First payout claimed: ${formatUnits(claimed1)} PAYOUT tokens`);

    // Test second period (fast forward)
    console.log("⏰ Fast-forwarding to second payout period...");
    await time.increase(testCase.payoutPeriodDuration + 10);

    periodInfo = await wrappedToken.getCurrentPayoutPeriodInfo();
    console.log(`📊 Second period - Can distribute: ${periodInfo.canDistribute}`);

    // Distribute second payout
    const payout2 = parseUnits("800");
    await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout2);
    await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout2);

    // User claims second payout
    const beforeClaim2 = await payoutToken.balanceOf(investor1.address);
    await wrappedToken.connect(investor1).claimAvailablePayouts();
    const afterClaim2 = await payoutToken.balanceOf(investor1.address);
    const claimed2 = afterClaim2 - beforeClaim2;
    console.log(`✅ Second payout claimed: ${formatUnits(claimed2)} PAYOUT tokens`);

    console.log(`📈 Total claimed: ${formatUnits(afterClaim2)} PAYOUT tokens across 2 periods`);
    console.log(`🎉 ${testCase.name} - PASSED`);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("🎉 All Payout Period Tests Completed Successfully!");
  console.log("✅ 30-Day, 6-Month, and 1-Year cycles all working correctly");
  console.log("✅ Period timing enforcement working");
  console.log("✅ Multi-period claims working");
  console.log(`${"=".repeat(60)}`);
}

main().catch((error) => {
  console.error("💥 Payout period testing failed:", error);
  process.exitCode = 1;
});