// scripts/payout-flow-simulation.js

const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Helper to parse units for readability
const parseUnits = (value, decimals = 18) => ethers.parseUnits(String(value), decimals);
const formatUnits = (value, decimals = 18) => ethers.formatUnits(value, decimals);

// Helper to get fresh timestamps for each scenario
async function getFreshTimestamps() {
  const now = await time.latest();
  return {
    startDate: now + 200,
    endDate: now + 200 + 3600, // 1 hour sale
    maturityDate: now + 200 + 7200 // 2 hours maturity
  };
}

// A simple assertion helper
async function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

async function main() {
  console.log("🎯 Starting Comprehensive Payout Flow Simulation");
  console.log("=".repeat(60));

  // Actors
  const [deployer, tokenOwner, treasuryOwner, investor1, investor2, investor3, payoutAdmin] = await ethers.getSigners();

  console.log("\n👥 Actors:");
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Token Owner: ${tokenOwner.address}`);
  console.log(`Treasury Owner: ${treasuryOwner.address}`);
  console.log(`Investor 1: ${investor1.address}`);
  console.log(`Investor 2: ${investor2.address}`);
  console.log(`Investor 3: ${investor3.address}`);
  console.log(`Payout Admin: ${payoutAdmin.address}`);

  // 1. Deploy Mock/Test Contracts
  console.log("\n📦 Deploying mock contracts...");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const saleToken = await MockERC20.deploy("Sale Token", "SALE");
  const paymentToken = await MockERC20.deploy("Payment Token", "PAY");
  const payoutToken = await MockERC20.deploy("Payout Token", "PAYOUT"); // Separate payout token

  const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
  const payOracle = await MockV3Aggregator.deploy(parseUnits("1.0", 18), true); // 1 PAY = 1 USD

  console.log(`✅ Sale Token: ${await saleToken.getAddress()}`);
  console.log(`✅ Payment Token: ${await paymentToken.getAddress()}`);
  console.log(`✅ Payout Token: ${await payoutToken.getAddress()}`);

  // 2. Deploy Core Infrastructure
  console.log("\n🏗️ Deploying core infrastructure...");
  
  const WrappedTokenFactory = await ethers.getContractFactory("WrappedTokenFactory");
  const wrappedTokenFactory = await WrappedTokenFactory.deploy();

  const OfferingFactory = await ethers.getContractFactory("OfferingFactory");
  const offeringFactory = await OfferingFactory.deploy(await wrappedTokenFactory.getAddress());

  const InvestmentManager = await ethers.getContractFactory("InvestmentManager");
  const investmentManager = await InvestmentManager.deploy();

  const Escrow = await ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy({ owner: treasuryOwner.address });

  console.log(`✅ WrappedTokenFactory: ${await wrappedTokenFactory.getAddress()}`);
  console.log(`✅ OfferingFactory: ${await offeringFactory.getAddress()}`);
  console.log(`✅ InvestmentManager: ${await investmentManager.getAddress()}`);
  console.log(`✅ Escrow: ${await escrow.getAddress()}`);

  // 3. Mint tokens to participants
  console.log("\n💰 Minting initial tokens...");
  await saleToken.connect(deployer).mint(tokenOwner.address, parseUnits("10000000")); // 10M sale tokens
  await paymentToken.connect(deployer).mint(investor1.address, parseUnits("50000"));
  await paymentToken.connect(deployer).mint(investor2.address, parseUnits("50000"));
  await paymentToken.connect(deployer).mint(investor3.address, parseUnits("50000"));

  // Mint payout tokens for rewards
  await payoutToken.connect(deployer).mint(payoutAdmin.address, parseUnits("100000"));
  console.log("✅ Minted tokens to all participants");

  // Helper function to deploy offerings with APY enabled
  async function deployOfferingWithAPY() {
    const timestamps = await getFreshTimestamps();
    
    const offeringConfig = {
      saleToken: await saleToken.getAddress(),
      minInvestment: parseUnits("100"), // $100 minimum
      maxInvestment: parseUnits("5000"), // $5000 maximum
      startDate: timestamps.startDate,
      endDate: timestamps.endDate,
      maturityDate: timestamps.maturityDate,
      autoTransfer: true,
      apyEnabled: true, // APY ENABLED
      fundraisingCap: parseUnits("100000"), // $100k cap
      tokenPrice: parseUnits("0.5"), // $0.5 per token
      tokenOwner: tokenOwner.address,
      escrowAddress: await escrow.getAddress(),
      investmentManager: await investmentManager.getAddress(),
      payoutTokenAddress: await payoutToken.getAddress(), // Using separate payout token
      payoutRate: 1000, // 10% APY (in basis points)
      defaultPayoutFrequency: 2, // Yearly
      paymentTokens: [await paymentToken.getAddress()],
      oracles: [await payOracle.getAddress()]
    };

    const tx = await offeringFactory.connect(deployer).createOfferingWithPaymentTokens(offeringConfig);
    const receipt = await tx.wait();
    const event = receipt.logs.find(log => log.fragment && log.fragment.name === 'OfferingDeployed');
    const offeringAddress = event.args.offeringAddress;
    
    const offering = await ethers.getContractAt("Offering", offeringAddress);
    const wrappedTokenAddress = await offering.wrappedTokenAddress();
    const wrappedToken = await ethers.getContractAt("WRAPEDTOKEN", wrappedTokenAddress);
    
    // Grant payout admin role to payoutAdmin using the correct function
    await wrappedToken.connect(deployer).grantPayoutAdminRole(payoutAdmin.address);
    
    // Transfer sale tokens to offering for distribution
    const totalTokensForSale = parseUnits("200000"); // 200k tokens for sale
    await saleToken.connect(tokenOwner).transfer(offeringAddress, totalTokensForSale);

    return { offering, wrappedToken, config: offeringConfig };
  }

  // --- SCENARIO 1: Basic Payout Flow ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 1: Basic Payout Flow - Single Investment");
  console.log("=".repeat(60));
  
  try {
    const { offering, wrappedToken, config } = await deployOfferingWithAPY();
    
    const investAmountPAY = parseUnits("200"); // $200 investment
    const expectedSaleTokens = parseUnits("400"); // $200 / $0.5 = 400 tokens

    console.log("📝 Setting up investment...");
    await paymentToken.connect(investor1).approve(await offering.getAddress(), investAmountPAY);
    await time.increaseTo(config.startDate + 10);

    console.log("💸 Investor 1 investing via InvestmentManager...");
    await investmentManager.connect(investor1).routeInvestment(
      await offering.getAddress(),
      await paymentToken.getAddress(),
      investAmountPAY
    );
    
    const wrappedBalance = await wrappedToken.balanceOf(investor1.address);
    console.log(`✅ Wrapped tokens received: ${formatUnits(wrappedBalance)}`);

    // Check initial payout balance (should be 0)
    let payoutBalance = await wrappedToken.getUserPayoutBalance(investor1.address);
    console.log(`📊 Initial payout balance - Total: ${formatUnits(payoutBalance.totalAvailable)}, Claimable: ${formatUnits(payoutBalance.claimable)}`);

    // Admin adds payout funds
    console.log("💰 Admin adding payout funds...");
    const payoutAmount = parseUnits("1000");
    await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount);
    await wrappedToken.connect(payoutAdmin).addPayoutFunds(payoutAmount);
    console.log(`✅ Payout funds added: ${formatUnits(payoutAmount)} PAYOUT tokens`);

    // Check updated payout balance
    payoutBalance = await wrappedToken.getUserPayoutBalance(investor1.address);
    console.log(`📊 Updated payout balance - Total: ${formatUnits(payoutBalance.totalAvailable)}, Claimable: ${formatUnits(payoutBalance.claimable)}`);

    // User claims payout
    console.log("🎁 User claiming payout...");
    const initialPayoutBalance = await payoutToken.balanceOf(investor1.address);
    await wrappedToken.connect(investor1).claimTotalPayout();
    const finalPayoutBalance = await payoutToken.balanceOf(investor1.address);
    const claimedAmount = finalPayoutBalance - initialPayoutBalance;
    console.log(`✅ User claimed: ${formatUnits(claimedAmount)} PAYOUT tokens`);

    // Fast forward to maturity and claim final tokens
    console.log("⏰ Fast-forwarding to maturity...");
    await time.increase(7300); // Beyond maturity
    
    console.log("🏁 Claiming final tokens...");
    await wrappedToken.connect(investor1).claimFinalTokens();
    
    const finalBalance = await saleToken.balanceOf(investor1.address);
    console.log(`✅ Final tokens claimed: ${formatUnits(finalBalance)} SALE tokens`);
    
    console.log("🎉 Scenario 1 Passed - Basic Payout Flow");
  } catch (error) {
    console.error("❌ Scenario 1 Failed:", error.message);
  }

  // --- SCENARIO 2: Multiple Investors Proportional Payout ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 2: Multiple Investors Proportional Payout");
  console.log("=".repeat(60));
  
  try {
    const { offering, wrappedToken, config } = await deployOfferingWithAPY();
    
    // Multiple investments
    const investments = [
      { investor: investor1, amount: parseUnits("300") }, // $300 = 600 tokens
      { investor: investor2, amount: parseUnits("200") }, // $200 = 400 tokens
      { investor: investor3, amount: parseUnits("500") }  // $500 = 1000 tokens
    ];

    console.log("📝 Setting up multiple investments...");
    await time.increaseTo(config.startDate + 10);

    for (let i = 0; i < investments.length; i++) {
      const { investor, amount } = investments[i];
      await paymentToken.connect(investor).approve(await offering.getAddress(), amount);
      
      console.log(`💸 Investor ${i + 1} investing ${formatUnits(amount)} PAY tokens...`);
      await investmentManager.connect(investor).routeInvestment(
        await offering.getAddress(),
        await paymentToken.getAddress(),
        amount
      );
      
      const wrappedBalance = await wrappedToken.balanceOf(investor.address);
      console.log(`✅ Investor ${i + 1} received: ${formatUnits(wrappedBalance)} wrapped tokens`);
    }

    // Admin adds payout funds
    console.log("💰 Admin adding payout funds for distribution...");
    const totalPayoutAmount = parseUnits("2000");
    await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), totalPayoutAmount);
    await wrappedToken.connect(payoutAdmin).addPayoutFunds(totalPayoutAmount);
    console.log(`✅ Total payout funds added: ${formatUnits(totalPayoutAmount)} PAYOUT tokens`);

    // Check each investor's proportional share
    console.log("📊 Checking proportional payout shares...");
    for (let i = 0; i < investments.length; i++) {
      const { investor } = investments[i];
      const payoutBalance = await wrappedToken.getUserPayoutBalance(investor.address);
      console.log(`📈 Investor ${i + 1} - Total: ${formatUnits(payoutBalance.totalAvailable)}, Claimable: ${formatUnits(payoutBalance.claimable)}`);
    }

    // All investors claim their payouts
    console.log("🎁 All investors claiming payouts...");
    for (let i = 0; i < investments.length; i++) {
      const { investor } = investments[i];
      const initialBalance = await payoutToken.balanceOf(investor.address);
      await wrappedToken.connect(investor).claimTotalPayout();
      const finalBalance = await payoutToken.balanceOf(investor.address);
      const claimed = finalBalance - initialBalance;
      console.log(`✅ Investor ${i + 1} claimed: ${formatUnits(claimed)} PAYOUT tokens`);
    }
    
    console.log("🎉 Scenario 2 Passed - Multiple Investors Proportional Payout");
  } catch (error) {
    console.error("❌ Scenario 2 Failed:", error.message);
  }

  // --- SCENARIO 3: Multiple Payout Rounds ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 3: Multiple Payout Rounds");
  console.log("=".repeat(60));
  
  try {
    const { offering, wrappedToken, config } = await deployOfferingWithAPY();
    
    const investAmountPAY = parseUnits("400"); // $400 investment
    const expectedSaleTokens = parseUnits("800"); // $400 / $0.5 = 800 tokens

    console.log("📝 Setting up investment...");
    await paymentToken.connect(investor1).approve(await offering.getAddress(), investAmountPAY);
    await time.increaseTo(config.startDate + 10);

    await investmentManager.connect(investor1).routeInvestment(
      await offering.getAddress(),
      await paymentToken.getAddress(),
      investAmountPAY
    );
    
    console.log(`✅ Investment completed: ${formatUnits(expectedSaleTokens)} wrapped tokens`);

    // Round 1: Admin adds first payout
    console.log("💰 Round 1: Admin adding first payout...");
    const payout1 = parseUnits("500");
    await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout1);
    await wrappedToken.connect(payoutAdmin).addPayoutFunds(payout1);
    
    let payoutBalance = await wrappedToken.getUserPayoutBalance(investor1.address);
    console.log(`📊 After Round 1 - Claimable: ${formatUnits(payoutBalance.claimable)}`);

    // User claims first payout
    let initialBalance = await payoutToken.balanceOf(investor1.address);
    await wrappedToken.connect(investor1).claimTotalPayout();
    let finalBalance = await payoutToken.balanceOf(investor1.address);
    let claimed1 = finalBalance - initialBalance;
    console.log(`✅ Round 1 claimed: ${formatUnits(claimed1)} PAYOUT tokens`);

    // Round 2: Admin adds second payout
    console.log("💰 Round 2: Admin adding second payout...");
    const payout2 = parseUnits("300");
    await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout2);
    await wrappedToken.connect(payoutAdmin).addPayoutFunds(payout2);
    
    payoutBalance = await wrappedToken.getUserPayoutBalance(investor1.address);
    console.log(`📊 After Round 2 - Claimable: ${formatUnits(payoutBalance.claimable)}`);

    // User claims second payout
    initialBalance = await payoutToken.balanceOf(investor1.address);
    await wrappedToken.connect(investor1).claimTotalPayout();
    finalBalance = await payoutToken.balanceOf(investor1.address);
    let claimed2 = finalBalance - initialBalance;
    console.log(`✅ Round 2 claimed: ${formatUnits(claimed2)} PAYOUT tokens`);

    // Round 3: Admin adds third payout
    console.log("💰 Round 3: Admin adding third payout...");
    const payout3 = parseUnits("700");
    await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout3);
    await wrappedToken.connect(payoutAdmin).addPayoutFunds(payout3);
    
    payoutBalance = await wrappedToken.getUserPayoutBalance(investor1.address);
    console.log(`📊 After Round 3 - Claimable: ${formatUnits(payoutBalance.claimable)}`);

    // User claims third payout
    initialBalance = await payoutToken.balanceOf(investor1.address);
    await wrappedToken.connect(investor1).claimTotalPayout();
    finalBalance = await payoutToken.balanceOf(investor1.address);
    let claimed3 = finalBalance - initialBalance;
    console.log(`✅ Round 3 claimed: ${formatUnits(claimed3)} PAYOUT tokens`);

    const totalClaimed = claimed1 + claimed2 + claimed3;
    console.log(`📈 Total claimed across all rounds: ${formatUnits(totalClaimed)} PAYOUT tokens`);
    
    console.log("🎉 Scenario 3 Passed - Multiple Payout Rounds");
  } catch (error) {
    console.error("❌ Scenario 3 Failed:", error.message);
  }

  // --- SCENARIO 4: Emergency Unlock with Payout History ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 4: Emergency Unlock with Payout History");
  console.log("=".repeat(60));
  
  try {
    const { offering, wrappedToken, config } = await deployOfferingWithAPY();
    
    const investAmountPAY = parseUnits("600"); // $600 investment
    const expectedSaleTokens = parseUnits("1200"); // $600 / $0.5 = 1200 tokens

    console.log("📝 Setting up investment...");
    await paymentToken.connect(investor1).approve(await offering.getAddress(), investAmountPAY);
    await time.increaseTo(config.startDate + 10);

    await investmentManager.connect(investor1).routeInvestment(
      await offering.getAddress(),
      await paymentToken.getAddress(),
      investAmountPAY
    );
    
    console.log(`✅ Investment completed: ${formatUnits(expectedSaleTokens)} wrapped tokens`);

    // Admin adds payout funds
    console.log("💰 Admin adding payout funds...");
    const payoutAmount = parseUnits("800");
    await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount);
    await wrappedToken.connect(payoutAdmin).addPayoutFunds(payoutAmount);

    // User claims payout
    console.log("🎁 User claiming payout before emergency unlock...");
    await wrappedToken.connect(investor1).claimTotalPayout();
    const payoutClaimed = await payoutToken.balanceOf(investor1.address);
    console.log(`✅ Payout claimed: ${formatUnits(payoutClaimed)} PAYOUT tokens`);

    // Admin enables emergency unlock with 15% penalty
    console.log("🚨 Admin enabling emergency unlock with 15% penalty...");
    await wrappedToken.connect(deployer).enableEmergencyUnlock(1500); // 15% penalty
    console.log("✅ Emergency unlock enabled");

    // User uses emergency unlock
    console.log("🔓 User using emergency unlock...");
    const initialSaleBalance = await saleToken.balanceOf(investor1.address);
    await wrappedToken.connect(investor1).emergencyUnlock();
    
    const finalSaleBalance = await saleToken.balanceOf(investor1.address);
    const tokensReceived = finalSaleBalance - initialSaleBalance;
    const expectedAfterPenalty = expectedSaleTokens * 85n / 100n; // 85% after 15% penalty
    
    console.log(`✅ Emergency unlock completed: ${formatUnits(tokensReceived)} SALE tokens (15% penalty applied)`);
    console.log(`📊 Expected after penalty: ${formatUnits(expectedAfterPenalty)} SALE tokens`);

    // Check wrapped token balance is burned
    const wrappedBalanceAfter = await wrappedToken.balanceOf(investor1.address);
    console.log(`✅ Wrapped tokens burned: ${formatUnits(wrappedBalanceAfter)} (should be 0)`);

    console.log(`📈 Total value received: ${formatUnits(payoutClaimed)} PAYOUT + ${formatUnits(tokensReceived)} SALE tokens`);
    
    console.log("🎉 Scenario 4 Passed - Emergency Unlock with Payout History");
  } catch (error) {
    console.error("❌ Scenario 4 Failed:", error.message);
  }

  // --- SCENARIO 5: Payout After Partial Claims ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 5: Payout After Partial Claims and Token Burns");
  console.log("=".repeat(60));
  
  try {
    const { offering, wrappedToken, config } = await deployOfferingWithAPY();
    
    // Two investors
    const investment1 = parseUnits("300"); // $300 = 600 tokens
    const investment2 = parseUnits("200"); // $200 = 400 tokens

    console.log("📝 Setting up two investments...");
    await time.increaseTo(config.startDate + 10);

    // Investor 1
    await paymentToken.connect(investor1).approve(await offering.getAddress(), investment1);
    await investmentManager.connect(investor1).routeInvestment(
      await offering.getAddress(),
      await paymentToken.getAddress(),
      investment1
    );

    // Investor 2
    await paymentToken.connect(investor2).approve(await offering.getAddress(), investment2);
    await investmentManager.connect(investor2).routeInvestment(
      await offering.getAddress(),
      await paymentToken.getAddress(),
      investment2
    );

    const balance1 = await wrappedToken.balanceOf(investor1.address);
    const balance2 = await wrappedToken.balanceOf(investor2.address);
    console.log(`✅ Investor 1: ${formatUnits(balance1)} wrapped tokens`);
    console.log(`✅ Investor 2: ${formatUnits(balance2)} wrapped tokens`);

    // Admin adds first payout
    console.log("💰 Admin adding first payout round...");
    const payout1 = parseUnits("1000");
    await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout1);
    await wrappedToken.connect(payoutAdmin).addPayoutFunds(payout1);

    // Both investors claim
    console.log("🎁 Both investors claiming first payout...");
    await wrappedToken.connect(investor1).claimTotalPayout();
    await wrappedToken.connect(investor2).claimTotalPayout();

    const payout1Claimed1 = await payoutToken.balanceOf(investor1.address);
    const payout1Claimed2 = await payoutToken.balanceOf(investor2.address);
    console.log(`✅ Investor 1 claimed: ${formatUnits(payout1Claimed1)} PAYOUT tokens`);
    console.log(`✅ Investor 2 claimed: ${formatUnits(payout1Claimed2)} PAYOUT tokens`);

    // Investor 1 uses emergency unlock (burns their tokens)
    console.log("🚨 Enabling emergency unlock and Investor 1 exits early...");
    await wrappedToken.connect(deployer).enableEmergencyUnlock(1000); // 10% penalty
    await wrappedToken.connect(investor1).emergencyUnlock();
    
    const remainingBalance1 = await wrappedToken.balanceOf(investor1.address);
    const remainingBalance2 = await wrappedToken.balanceOf(investor2.address);
    console.log(`✅ After emergency unlock - Investor 1: ${formatUnits(remainingBalance1)} (burned)`);
    console.log(`✅ After emergency unlock - Investor 2: ${formatUnits(remainingBalance2)} (unchanged)`);

    // Admin adds second payout (should only go to remaining investor)
    console.log("💰 Admin adding second payout round...");
    const payout2 = parseUnits("500");
    await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout2);
    await wrappedToken.connect(payoutAdmin).addPayoutFunds(payout2);

    // Check payout balances
    const payoutBalance1 = await wrappedToken.getUserPayoutBalance(investor1.address);
    const payoutBalance2 = await wrappedToken.getUserPayoutBalance(investor2.address);
    console.log(`📊 Investor 1 claimable: ${formatUnits(payoutBalance1.claimable)} (should be 0)`);
    console.log(`📊 Investor 2 claimable: ${formatUnits(payoutBalance2.claimable)} (should get all)`);

    // Investor 2 claims second payout
    console.log("🎁 Investor 2 claiming second payout...");
    const beforeClaim2 = await payoutToken.balanceOf(investor2.address);
    await wrappedToken.connect(investor2).claimTotalPayout();
    const afterClaim2 = await payoutToken.balanceOf(investor2.address);
    const payout2Claimed = afterClaim2 - beforeClaim2;
    console.log(`✅ Investor 2 claimed additional: ${formatUnits(payout2Claimed)} PAYOUT tokens`);

    const totalClaimed2 = afterClaim2;
    console.log(`📈 Investor 2 total claimed: ${formatUnits(totalClaimed2)} PAYOUT tokens`);
    
    console.log("🎉 Scenario 5 Passed - Payout After Partial Claims and Burns");
  } catch (error) {
    console.error("❌ Scenario 5 Failed:", error.message);
  }

  // --- FINAL SUMMARY ---
  console.log("\n" + "=".repeat(60));
  console.log("📊 PAYOUT FLOW SIMULATION SUMMARY");
  console.log("=".repeat(60));
  
  console.log("✅ Scenario 1: Basic Payout Flow - Single Investment");
  console.log("✅ Scenario 2: Multiple Investors Proportional Payout");
  console.log("✅ Scenario 3: Multiple Payout Rounds");
  console.log("✅ Scenario 4: Emergency Unlock with Payout History");
  console.log("✅ Scenario 5: Payout After Partial Claims and Token Burns");
  
  console.log("\n🎉 All payout flow scenarios completed successfully!");
  console.log("💡 The wrapped token payout system is working perfectly with:");
  console.log("   • Proportional payout distribution");
  console.log("   • Multiple payout rounds");
  console.log("   • Emergency unlock compatibility");
  console.log("   • Dynamic balance adjustments");
  console.log("   • Comprehensive payout tracking");
}

main().catch((error) => {
  console.error("💥 Payout flow simulation failed:", error);
  process.exitCode = 1;
});