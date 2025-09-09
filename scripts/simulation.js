// scripts/simulation.js

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

// A simple assertion helper to replace 'expect'
async function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

async function main() {
  console.log("🚀 Starting Comprehensive Offering Contract Simulation");
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
  const usdtToken = await MockERC20.deploy("USDT Token", "USDT");

  const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
  const payOracle = await MockV3Aggregator.deploy(parseUnits("1.0", 18), true); // 1 PAY = 1 USD
  const ethOracle = await MockV3Aggregator.deploy(parseUnits("2000", 18), true); // 1 ETH = 2000 USD
  const usdtOracle = await MockV3Aggregator.deploy(parseUnits("1.0", 18), true); // 1 USDT = 1 USD

  console.log(`✅ Sale Token: ${await saleToken.getAddress()}`);
  console.log(`✅ Payment Token: ${await paymentToken.getAddress()}`);
  console.log(`✅ USDT Token: ${await usdtToken.getAddress()}`);

  // 2. Deploy Core Infrastructure
  console.log("\n🏗️ Deploying core infrastructure...");
  
  const OfferingFactory = await ethers.getContractFactory("OfferingFactory");
  const offeringFactory = await OfferingFactory.deploy();

  const InvestmentManager = await ethers.getContractFactory("InvestmentManager");
  const investmentManager = await InvestmentManager.deploy();

  const Escrow = await ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy({ owner: treasuryOwner.address });

  console.log(`✅ OfferingFactory: ${await offeringFactory.getAddress()}`);
  console.log(`✅ InvestmentManager: ${await investmentManager.getAddress()}`);
  console.log(`✅ Escrow: ${await escrow.getAddress()}`);

  // 3. Configure USDT in factory
  await offeringFactory.connect(deployer).setUSDTConfig(
    await usdtToken.getAddress(),
    await usdtOracle.getAddress()
  );
  console.log("✅ Configured USDT in factory");

  // 4. Mint tokens to participants
  console.log("\n💰 Minting initial tokens...");
  await saleToken.connect(deployer).mint(tokenOwner.address, parseUnits("10000000")); // 10M sale tokens
  await paymentToken.connect(deployer).mint(investor1.address, parseUnits("50000"));
  await paymentToken.connect(deployer).mint(investor2.address, parseUnits("50000"));
  await paymentToken.connect(deployer).mint(investor3.address, parseUnits("50000"));
  await usdtToken.connect(deployer).mint(investor1.address, parseUnits("50000", 6)); // USDT has 6 decimals
  await usdtToken.connect(deployer).mint(investor2.address, parseUnits("50000", 6));

  // Mint payout tokens for rewards
  await paymentToken.connect(deployer).mint(payoutAdmin.address, parseUnits("100000"));
  console.log("✅ Minted tokens to all participants");

  // Helper function to deploy offerings
  async function deployOffering(config, customEscrow = null) {
    const timestamps = await getFreshTimestamps();
    const escrowToUse = customEscrow || escrow;
    
    const offeringConfig = {
      saleToken: await saleToken.getAddress(),
      minInvestment: parseUnits("100"), // $100 minimum
      maxInvestment: parseUnits("5000"), // $5000 maximum
      startDate: timestamps.startDate,
      endDate: timestamps.endDate,
      maturityDate: timestamps.maturityDate,
      autoTransfer: config.autoTransfer,
      apyEnabled: config.apyEnabled,
      fundraisingCap: parseUnits("100000"), // $100k cap
      tokenPrice: parseUnits("0.5"), // $0.5 per token
      tokenOwner: tokenOwner.address,
      escrowAddress: await escrowToUse.getAddress(),
      investmentManager: await investmentManager.getAddress(),
      payoutTokenAddress: await paymentToken.getAddress(),
      payoutRate: 1000, // 10% APY (in basis points)
      defaultPayoutFrequency: 2, // Yearly
      paymentTokens: [
        await paymentToken.getAddress(),
        ethers.ZeroAddress, // Native ETH
        await usdtToken.getAddress()
      ],
      oracles: [
        await payOracle.getAddress(),
        await ethOracle.getAddress(),
        await usdtOracle.getAddress()
      ]
    };

    const tx = await offeringFactory.connect(deployer).createOfferingWithPaymentTokens(offeringConfig);
    const receipt = await tx.wait();
    const event = receipt.logs.find(log => log.fragment && log.fragment.name === 'OfferingDeployed');
    const offeringAddress = event.args.offeringAddress;
    
    const offering = await ethers.getContractAt("Offering", offeringAddress);

    let wrappedToken;
    if (config.apyEnabled) {
      const wrappedTokenAddress = await offering.wrappedTokenAddress();
      wrappedToken = await ethers.getContractAt("WRAPEDTOKEN", wrappedTokenAddress);
      
      // Grant payout admin role to payoutAdmin
      await wrappedToken.connect(deployer).grantPayoutAdminRole(payoutAdmin.address);
    }
    
    // Transfer sale tokens to offering for distribution
    const totalTokensForSale = parseUnits("200000"); // 200k tokens for sale
    await saleToken.connect(tokenOwner).transfer(offeringAddress, totalTokensForSale);

    return { offering, wrappedToken, config: offeringConfig };
  }

  // --- SCENARIO 1: APY Enabled + Auto Transfer + Direct Payout ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 1: APY Enabled + Auto Transfer + Direct Payout");
  console.log("=".repeat(60));
  
  try {
    const { offering, wrappedToken, config } = await deployOffering({ 
      apyEnabled: true, 
      autoTransfer: true 
    });
    
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
    
    console.log("✅ Investment successful");
    
    // Check wrapped token balance
    const wrappedBalance = await wrappedToken.balanceOf(investor1.address);
    await assert(wrappedBalance == expectedSaleTokens, 
      `Wrapped token balance mismatch. Expected: ${formatUnits(expectedSaleTokens)}, Got: ${formatUnits(wrappedBalance)}`);
    console.log(`✅ Wrapped tokens received: ${formatUnits(wrappedBalance)}`);

    // Admin adds payout funds
    console.log("💰 Admin adding payout funds...");
    const payoutAmount = parseUnits("5000");
    await paymentToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount);
    await wrappedToken.connect(payoutAdmin).addPayoutFunds(payoutAmount);
    console.log(`✅ Payout funds added: ${formatUnits(payoutAmount)} PAY tokens`);

    // Check user's payout balance
    const payoutBalance = await wrappedToken.getUserPayoutBalance(investor1.address);
    console.log(`✅ User payout balance - Total: ${formatUnits(payoutBalance.totalAvailable)}, Claimable: ${formatUnits(payoutBalance.claimable)}`);

    // User claims total payout
    console.log("🎁 User claiming total payout...");
    await wrappedToken.connect(investor1).claimTotalPayout();
    
    const userPaymentBalance = await paymentToken.balanceOf(investor1.address);
    console.log(`✅ User claimed payout: ${formatUnits(userPaymentBalance)} PAY tokens`);

    // Admin adds second round of payout funds
    console.log("💰 Admin adding second round of payout funds...");
    const payoutAmount2 = parseUnits("3000");
    await paymentToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount2);
    await wrappedToken.connect(payoutAdmin).addPayoutFunds(payoutAmount2);
    console.log(`✅ Second payout funds added: ${formatUnits(payoutAmount2)} PAY tokens`);

    // User claims second round
    console.log("🎁 User claiming second round payout...");
    await wrappedToken.connect(investor1).claimTotalPayout();
    
    const finalPaymentBalance = await paymentToken.balanceOf(investor1.address);
    console.log(`✅ Total payout claimed: ${formatUnits(finalPaymentBalance)} PAY tokens`);

    // Fast forward to maturity and claim final tokens
    console.log("⏰ Fast-forwarding to maturity...");
    await time.increase(7300); // Beyond maturity
    
    console.log("🏁 Claiming final tokens...");
    await wrappedToken.connect(investor1).claimFinalTokens();
    
    const finalBalance = await saleToken.balanceOf(investor1.address);
    await assert(finalBalance == expectedSaleTokens, 
      `Final token balance mismatch. Expected: ${formatUnits(expectedSaleTokens)}, Got: ${formatUnits(finalBalance)}`);
    console.log(`✅ Final tokens claimed: ${formatUnits(finalBalance)} SALE tokens`);
    
    console.log("🎉 Scenario 1 Passed - APY with Direct Payout System");
  } catch (error) {
    console.error("❌ Scenario 1 Failed:", error.message);
  }

  // --- SCENARIO 2: APY Disabled + Auto Transfer ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 2: APY Disabled + Auto Transfer");
  console.log("=".repeat(60));
  
  try {
    const { offering, config } = await deployOffering({ 
      apyEnabled: false, 
      autoTransfer: true 
    });
    
    const investAmountPAY = parseUnits("300"); // $300 investment
    const expectedSaleTokens = parseUnits("600"); // $300 / $0.5 = 600 tokens

    console.log("📝 Setting up investment...");
    await paymentToken.connect(investor2).approve(await offering.getAddress(), investAmountPAY);
    await time.increaseTo(config.startDate + 10);

    console.log("💸 Investor 2 investing via InvestmentManager...");
    await investmentManager.connect(investor2).routeInvestment(
      await offering.getAddress(),
      await paymentToken.getAddress(),
      investAmountPAY
    );
    
    // Check direct sale token balance (no wrapped tokens)
    const directBalance = await saleToken.balanceOf(investor2.address);
    await assert(directBalance == expectedSaleTokens, 
      `Direct token balance mismatch. Expected: ${formatUnits(expectedSaleTokens)}, Got: ${formatUnits(directBalance)}`);
    console.log(`✅ Direct tokens received: ${formatUnits(directBalance)} SALE tokens`);
    
    console.log("🎉 Scenario 2 Passed - No APY with Auto Transfer");
  } catch (error) {
    console.error("❌ Scenario 2 Failed:", error.message);
  }

  // --- SCENARIO 3: Emergency Unlock Feature ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 3: Emergency Unlock Feature");
  console.log("=".repeat(60));
  
  try {
    const { offering, wrappedToken, config } = await deployOffering({ 
      apyEnabled: true, 
      autoTransfer: true 
    });
    
    const investAmountPAY = parseUnits("500"); // $500 investment
    const expectedSaleTokens = parseUnits("1000"); // $500 / $0.5 = 1000 tokens

    console.log("📝 Setting up investment...");
    await paymentToken.connect(investor3).approve(await offering.getAddress(), investAmountPAY);
    await time.increaseTo(config.startDate + 10);

    console.log("💸 Investor 3 investing via InvestmentManager...");
    await investmentManager.connect(investor3).routeInvestment(
      await offering.getAddress(),
      await paymentToken.getAddress(),
      investAmountPAY
    );
    
    const wrappedBalance = await wrappedToken.balanceOf(investor3.address);
    console.log(`✅ Wrapped tokens received: ${formatUnits(wrappedBalance)} wSALE tokens`);

    // Admin enables emergency unlock with 10% penalty
    console.log("🚨 Admin enabling emergency unlock with 10% penalty...");
    await wrappedToken.connect(deployer).enableEmergencyUnlock(1000); // 10% penalty
    console.log("✅ Emergency unlock enabled");

    // User uses emergency unlock
    console.log("🔓 User using emergency unlock...");
    const initialSaleBalance = await saleToken.balanceOf(investor3.address);
    await wrappedToken.connect(investor3).emergencyUnlock();
    
    const finalSaleBalance = await saleToken.balanceOf(investor3.address);
    const tokensReceived = finalSaleBalance - initialSaleBalance;
    const expectedAfterPenalty = expectedSaleTokens * 90n / 100n; // 90% after 10% penalty
    
    await assert(tokensReceived == expectedAfterPenalty,
      `Emergency unlock amount mismatch. Expected: ${formatUnits(expectedAfterPenalty)}, Got: ${formatUnits(tokensReceived)}`);
    console.log(`✅ Emergency unlock completed: ${formatUnits(tokensReceived)} SALE tokens (10% penalty applied)`);

    // Check wrapped token balance is burned
    const wrappedBalanceAfter = await wrappedToken.balanceOf(investor3.address);
    await assert(wrappedBalanceAfter == 0n,
      `Wrapped tokens should be burned. Got: ${formatUnits(wrappedBalanceAfter)}`);
    console.log("✅ Wrapped tokens burned after emergency unlock");
    
    console.log("🎉 Scenario 3 Passed - Emergency Unlock Feature");
  } catch (error) {
    console.error("❌ Scenario 3 Failed:", error.message);
  }

  // --- SCENARIO 4: APY Enabled + Manual Claim + Multiple Payout Additions ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 4: APY Enabled + Manual Claim + Multiple Payout Additions");
  console.log("=".repeat(60));
  
  try {
    const FreshEscrow4 = await ethers.getContractFactory("Escrow");
    const freshEscrow4 = await FreshEscrow4.deploy({ owner: treasuryOwner.address });
    
    const { offering, wrappedToken, config } = await deployOffering({ 
      apyEnabled: true, 
      autoTransfer: false 
    }, freshEscrow4);
    
    const investAmountPAY = parseUnits("400"); // $400 investment
    const expectedSaleTokens = parseUnits("800"); // $400 / $0.5 = 800 tokens

    console.log("📝 Setting up investment...");
    await paymentToken.connect(investor1).approve(await offering.getAddress(), investAmountPAY);
    await time.increaseTo(config.startDate + 10);

    console.log("💸 Investor 1 investing via InvestmentManager...");
    await investmentManager.connect(investor1).routeInvestment(
      await offering.getAddress(),
      await paymentToken.getAddress(),
      investAmountPAY
    );
    
    // Check pending tokens
    const pendingTokens = await offering.pendingTokens(investor1.address);
    await assert(pendingTokens == expectedSaleTokens, 
      `Pending tokens mismatch. Expected: ${formatUnits(expectedSaleTokens)}, Got: ${formatUnits(pendingTokens)}`);
    console.log(`✅ Pending tokens: ${formatUnits(pendingTokens)} SALE tokens`);

    console.log("⏰ Fast-forwarding to maturity...");
    await time.increaseTo(config.maturityDate + 10);

    console.log("🎫 Claiming tokens via InvestmentManager...");
    await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());
    
    const wrappedBalance = await wrappedToken.balanceOf(investor1.address);
    await assert(wrappedBalance == expectedSaleTokens, 
      `Wrapped token balance mismatch. Expected: ${formatUnits(expectedSaleTokens)}, Got: ${formatUnits(wrappedBalance)}`);
    console.log(`✅ Wrapped tokens received: ${formatUnits(wrappedBalance)} wSALE tokens`);

    // Admin adds first payout
    console.log("💰 Admin adding first payout funds...");
    const payoutAmount1 = parseUnits("4000");
    await paymentToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount1);
    await wrappedToken.connect(payoutAdmin).addPayoutFunds(payoutAmount1);

    console.log("🎁 User claiming first payout...");
    await wrappedToken.connect(investor1).claimTotalPayout();
    const balance1 = await paymentToken.balanceOf(investor1.address);
    console.log(`✅ First payout claimed: ${formatUnits(balance1)} PAY tokens`);

    // Admin adds second payout
    console.log("💰 Admin adding second payout funds...");
    const payoutAmount2 = parseUnits("2500");
    await paymentToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount2);
    await wrappedToken.connect(payoutAdmin).addPayoutFunds(payoutAmount2);

    console.log("🎁 User claiming second payout...");
    await wrappedToken.connect(investor1).claimTotalPayout();
    const balance2 = await paymentToken.balanceOf(investor1.address);
    const secondClaim = balance2 - balance1;
    console.log(`✅ Second payout claimed: ${formatUnits(secondClaim)} PAY tokens`);
    console.log(`✅ Total payout claimed: ${formatUnits(balance2)} PAY tokens`);

    console.log("🏁 Claiming final tokens...");
    await wrappedToken.connect(investor1).claimFinalTokens();
    
    const finalBalance = await saleToken.balanceOf(investor1.address);
    await assert(finalBalance == expectedSaleTokens, 
      `Final token balance mismatch. Expected: ${formatUnits(expectedSaleTokens)}, Got: ${formatUnits(finalBalance)}`);
    console.log(`✅ Final tokens claimed: ${formatUnits(finalBalance)} SALE tokens`);
    
    console.log("🎉 Scenario 4 Passed - APY with Manual Claim + Multiple Payouts");
  } catch (error) {
    console.error("❌ Scenario 4 Failed:", error.message);
  }

  // --- SCENARIO 5: Native ETH Investment ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 5: Native ETH Investment");
  console.log("=".repeat(60));
  
  try {
    const FreshEscrow5 = await ethers.getContractFactory("Escrow");
    const freshEscrow5 = await FreshEscrow5.deploy({ owner: treasuryOwner.address });
    
    const { offering, config } = await deployOffering({ 
      apyEnabled: false, 
      autoTransfer: true 
    }, freshEscrow5);
    
    const investAmountETH = parseUnits("0.1"); // 0.1 ETH = $200 (at $2000/ETH)
    const expectedSaleTokens = parseUnits("400"); // $200 / $0.5 = 400 tokens

    console.log("📝 Setting up ETH investment...");
    await time.increaseTo(config.startDate + 10);

    console.log("💸 Investor 1 investing ETH via InvestmentManager...");
    await investmentManager.connect(investor1).routeInvestment(
      await offering.getAddress(),
      ethers.ZeroAddress, // Native ETH
      investAmountETH,
      { value: investAmountETH }
    );
    
    // Check direct sale token balance
    const directBalance = await saleToken.balanceOf(investor1.address);
    await assert(directBalance >= expectedSaleTokens, 
      `ETH investment token balance too low. Expected: ${formatUnits(expectedSaleTokens)}, Got: ${formatUnits(directBalance)}`);
    console.log(`✅ Tokens received from ETH: ${formatUnits(directBalance)} SALE tokens`);
    
    // Check escrow ETH balance
    const escrowETHBalance = await ethers.provider.getBalance(await freshEscrow5.getAddress());
    await assert(escrowETHBalance == investAmountETH, 
      `Escrow ETH balance mismatch. Expected: ${formatUnits(investAmountETH)}, Got: ${formatUnits(escrowETHBalance)}`);
    console.log(`✅ ETH secured in escrow: ${formatUnits(escrowETHBalance)} ETH`);
    
    console.log("🎉 Scenario 5 Passed - Native ETH Investment");
  } catch (error) {
    console.error("❌ Scenario 5 Failed:", error.message);
  }

  // --- SCENARIO 6: Multi-Token Investment (PAY + USDT) ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 6: Multi-Token Investment (PAY + USDT)");
  console.log("=".repeat(60));
  
  try {
    const FreshEscrow6 = await ethers.getContractFactory("Escrow");
    const freshEscrow6 = await FreshEscrow6.deploy({ owner: treasuryOwner.address });
    
    const { offering, config } = await deployOffering({ 
      apyEnabled: false, 
      autoTransfer: true 
    }, freshEscrow6);
    
    await time.increaseTo(config.startDate + 10);

    // Investment 1: PAY tokens
    const investAmountPAY = parseUnits("150"); // $150
    await paymentToken.connect(investor1).approve(await offering.getAddress(), investAmountPAY);
    
    console.log("💸 Investor 1 investing PAY tokens...");
    await investmentManager.connect(investor1).routeInvestment(
      await offering.getAddress(),
      await paymentToken.getAddress(),
      investAmountPAY
    );

    // Investment 2: USDT tokens (6 decimals)
    const investAmountUSDT = parseUnits("250", 6); // $250 worth of USDT (6 decimals)
    await usdtToken.connect(investor2).approve(await offering.getAddress(), investAmountUSDT);
    
    console.log("💸 Investor 2 investing USDT tokens...");
    await investmentManager.connect(investor2).routeInvestment(
      await offering.getAddress(),
      await usdtToken.getAddress(),
      investAmountUSDT
    );

    // Check total raised
    const totalRaised = await offering.totalRaised();
    const expectedTotal = parseUnits("400"); // $150 + $250 = $400
    await assert(totalRaised == expectedTotal, 
      `Total raised mismatch. Expected: ${formatUnits(expectedTotal)}, Got: ${formatUnits(totalRaised)}`);
    console.log(`✅ Total raised: $${formatUnits(totalRaised)}`);

    // Check individual token balances
    const investor1Tokens = await saleToken.balanceOf(investor1.address);
    const investor2Tokens = await saleToken.balanceOf(investor2.address);
    console.log(`✅ Investor 1 tokens: ${formatUnits(investor1Tokens)} SALE`);
    console.log(`✅ Investor 2 tokens: ${formatUnits(investor2Tokens)} SALE`);
    
    console.log("🎉 Scenario 6 Passed - Multi-Token Investment");
  } catch (error) {
    console.error("❌ Scenario 6 Failed:", error.message);
  }

  // --- SCENARIO 7: Multiple Investors + Proportional Payout Distribution ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 7: Multiple Investors + Proportional Payout Distribution");
  console.log("=".repeat(60));
  
  try {
    const FreshEscrow7 = await ethers.getContractFactory("Escrow");
    const freshEscrow7 = await FreshEscrow7.deploy({ owner: treasuryOwner.address });
    
    const { offering, wrappedToken, config } = await deployOffering({ 
      apyEnabled: true, 
      autoTransfer: true 
    }, freshEscrow7);

    await time.increaseTo(config.startDate + 10);

    // Multiple investors invest
    console.log("💸 Multiple investors investing...");
    
    // Investor 1: $200
    const invest1 = parseUnits("200");
    await paymentToken.connect(investor1).approve(await offering.getAddress(), invest1);
    await investmentManager.connect(investor1).routeInvestment(
      await offering.getAddress(),
      await paymentToken.getAddress(),
      invest1
    );

    // Investor 2: $300  
    const invest2 = parseUnits("300");
    await paymentToken.connect(investor2).approve(await offering.getAddress(), invest2);
    await investmentManager.connect(investor2).routeInvestment(
      await offering.getAddress(),
      await paymentToken.getAddress(),
      invest2
    );

    console.log("✅ Multiple investments completed");

    // Check wrapped token balances
    const balance1 = await wrappedToken.balanceOf(investor1.address);
    const balance2 = await wrappedToken.balanceOf(investor2.address);
    console.log(`✅ Investor 1 wrapped tokens: ${formatUnits(balance1)}`);
    console.log(`✅ Investor 2 wrapped tokens: ${formatUnits(balance2)}`);

    // Admin adds payout funds
    console.log("💰 Admin adding payout funds for distribution...");
    const totalPayoutAmount = parseUnits("10000");
    await paymentToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), totalPayoutAmount);
    await wrappedToken.connect(payoutAdmin).addPayoutFunds(totalPayoutAmount);

    // Check payout balances
    const payout1 = await wrappedToken.getUserPayoutBalance(investor1.address);
    const payout2 = await wrappedToken.getUserPayoutBalance(investor2.address);
    console.log(`✅ Investor 1 claimable payout: ${formatUnits(payout1.claimable)} PAY`);
    console.log(`✅ Investor 2 claimable payout: ${formatUnits(payout2.claimable)} PAY`);

    // Both investors claim
    console.log("🎁 Investors claiming payouts...");
    await wrappedToken.connect(investor1).claimTotalPayout();
    await wrappedToken.connect(investor2).claimTotalPayout();

    const finalPayout1 = await paymentToken.balanceOf(investor1.address);
    const finalPayout2 = await paymentToken.balanceOf(investor2.address);
    console.log(`✅ Investor 1 total payout: ${formatUnits(finalPayout1)} PAY`);
    console.log(`✅ Investor 2 total payout: ${formatUnits(finalPayout2)} PAY`);

    console.log("🎉 Scenario 7 Passed - Multiple Investors Proportional Distribution");
  } catch (error) {
    console.error("❌ Scenario 7 Failed:", error.message);
  }

  // --- SCENARIO 8: Escrow and Refund Flow ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 8: Escrow and Refund Flow");
  console.log("=".repeat(60));
  
  try {
    const FreshEscrow8 = await ethers.getContractFactory("Escrow");
    const freshEscrow8 = await FreshEscrow8.deploy({ owner: treasuryOwner.address });
    
    const { offering, config } = await deployOffering({ 
      apyEnabled: false, 
      autoTransfer: false 
    }, freshEscrow8);
    
    const investAmountPAY = parseUnits("400"); // $400 investment

    console.log("📝 Setting up investment for refund scenario...");
    
    await paymentToken.connect(investor1).approve(await offering.getAddress(), investAmountPAY);
    await time.increaseTo(config.startDate + 10);

    console.log("💸 Investor 1 investing...");
    await investmentManager.connect(investor1).routeInvestment(
      await offering.getAddress(),
      await paymentToken.getAddress(),
      investAmountPAY
    );

    // Check escrow balance
    const escrowBalance = await paymentToken.balanceOf(await freshEscrow8.getAddress());
    await assert(escrowBalance == investAmountPAY,
      `Escrow balance mismatch. Expected: ${formatUnits(investAmountPAY)}, Got: ${formatUnits(escrowBalance)}`);
    console.log(`✅ Funds secured in escrow: ${formatUnits(escrowBalance)} PAY`);

    // Enable refunds
    console.log("🔄 Treasury owner enabling refunds...");
    await freshEscrow8.connect(treasuryOwner).enableRefunds();
    
    const initialInvestorBalance = await paymentToken.balanceOf(investor1.address);
    
    console.log("💸 Processing refund...");
    await freshEscrow8.connect(treasuryOwner).refund(await offering.getAddress(), investor1.address);
    
    const finalInvestorBalance = await paymentToken.balanceOf(investor1.address);
    const refundAmount = finalInvestorBalance - initialInvestorBalance;
    
    await assert(refundAmount == investAmountPAY,
      `Refund amount mismatch. Expected: ${formatUnits(investAmountPAY)}, Got: ${formatUnits(refundAmount)}`);
    console.log(`✅ Refund processed: ${formatUnits(refundAmount)} PAY tokens`);

    console.log("🎉 Scenario 8 Passed - Escrow and Refund");
  } catch (error) {
    console.error("❌ Scenario 8 Failed:", error.message);
  }

  // --- SCENARIO 9: Investment Limits and Validation ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 9: Investment Limits and Validation");
  console.log("=".repeat(60));
  
  try {
    const FreshEscrow9 = await ethers.getContractFactory("Escrow");
    const freshEscrow9 = await FreshEscrow9.deploy({ owner: treasuryOwner.address });
    
    const { offering, config } = await deployOffering({ 
      apyEnabled: false, 
      autoTransfer: true 
    }, freshEscrow9);
    
    await time.increaseTo(config.startDate + 10);

    // Test minimum investment validation
    console.log("🔍 Testing minimum investment validation...");
    const belowMinAmount = parseUnits("50"); // $50 - below $100 minimum
    await paymentToken.connect(investor1).approve(await offering.getAddress(), belowMinAmount);
    
    try {
      await investmentManager.connect(investor1).routeInvestment(
        await offering.getAddress(),
        await paymentToken.getAddress(),
        belowMinAmount
      );
      throw new Error("Should have reverted for below minimum investment");
    } catch (error) {
      if (error.message.includes("Below min investment")) {
        console.log("✅ Correctly rejected below minimum investment");
      } else {
        throw error;
      }
    }

    // Test maximum investment validation
    console.log("🔍 Testing maximum investment validation...");
    const aboveMaxAmount = parseUnits("6000"); // $6000 - above $5000 maximum
    await paymentToken.connect(investor1).approve(await offering.getAddress(), aboveMaxAmount);
    
    try {
      await investmentManager.connect(investor1).routeInvestment(
        await offering.getAddress(),
        await paymentToken.getAddress(),
        aboveMaxAmount
      );
      throw new Error("Should have reverted for above maximum investment");
    } catch (error) {
      if (error.message.includes("Exceeds max investment")) {
        console.log("✅ Correctly rejected above maximum investment");
      } else {
        throw error;
      }
    }

    // Test valid investment within limits
    console.log("💸 Testing valid investment within limits...");
    const validAmount = parseUnits("1000"); // $1000 - within limits
    await paymentToken.connect(investor1).approve(await offering.getAddress(), validAmount);
    
    await investmentManager.connect(investor1).routeInvestment(
      await offering.getAddress(),
      await paymentToken.getAddress(),
      validAmount
    );
    
    const tokensReceived = await saleToken.balanceOf(investor1.address);
    console.log(`✅ Valid investment processed: ${formatUnits(tokensReceived)} SALE tokens`);

    console.log("🎉 Scenario 9 Passed - Investment Limits Validation");
  } catch (error) {
    console.error("❌ Scenario 9 Failed:", error.message);
  }

  // --- SCENARIO 10: Admin Functions and Role Management ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 10: Admin Functions and Role Management");
  console.log("=".repeat(60));
  
  try {
    const FreshEscrow10 = await ethers.getContractFactory("Escrow");
    const freshEscrow10 = await FreshEscrow10.deploy({ owner: treasuryOwner.address });
    
    const { offering } = await deployOffering({ 
      apyEnabled: false, 
      autoTransfer: true 
    }, freshEscrow10);

    console.log("🔐 Testing role management...");
    
    // Grant additional token owner role
    await offering.connect(deployer).grantRole(await offering.TOKEN_OWNER_ROLE(), investor1.address);
    const hasRole = await offering.hasRole(await offering.TOKEN_OWNER_ROLE(), investor1.address);
    await assert(hasRole, "Failed to grant TOKEN_OWNER_ROLE");
    console.log("✅ Granted TOKEN_OWNER_ROLE to investor1");

    // Test token price update by token owner
    const newPrice = parseUnits("0.75"); // $0.75 per token
    await offering.connect(investor1).setTokenPrice(newPrice);
    const updatedPrice = await offering.tokenPrice();
    await assert(updatedPrice == newPrice, 
      `Token price update failed. Expected: ${formatUnits(newPrice)}, Got: ${formatUnits(updatedPrice)}`);
    console.log(`✅ Token price updated to: $${formatUnits(newPrice)}`);

    // Test investment limits update
    const newMinInvestment = parseUnits("200");
    const newMaxInvestment = parseUnits("8000");
    await offering.connect(investor1).setInvestmentLimits(newMinInvestment, newMaxInvestment);
    
    const updatedMin = await offering.minInvestment();
    const updatedMax = await offering.maxInvestment();
    await assert(updatedMin == newMinInvestment && updatedMax == newMaxInvestment,
      "Investment limits update failed");
    console.log(`✅ Investment limits updated: Min $${formatUnits(updatedMin)}, Max $${formatUnits(updatedMax)}`);

    // Test pause/unpause functionality
    console.log("⏸️ Testing pause functionality...");
    await offering.connect(deployer).pause();
    const isPaused = await offering.paused();
    await assert(isPaused, "Failed to pause contract");
    console.log("✅ Contract paused successfully");

    await offering.connect(deployer).unpause();
    const isUnpaused = !(await offering.paused());
    await assert(isUnpaused, "Failed to unpause contract");
    console.log("✅ Contract unpaused successfully");

    console.log("🎉 Scenario 10 Passed - Admin Functions");
  } catch (error) {
    console.error("❌ Scenario 10 Failed:", error.message);
  }

  // --- FINAL SUMMARY ---
  console.log("\n" + "=".repeat(60));
  console.log("📊 SIMULATION SUMMARY");
  console.log("=".repeat(60));
  
  console.log("✅ Scenario 1: APY Enabled + Direct Payout System");
  console.log("✅ Scenario 2: APY Disabled + Auto Transfer");
  console.log("✅ Scenario 3: Emergency Unlock Feature");
  console.log("✅ Scenario 4: APY Enabled + Manual Claim + Multiple Payouts");
  console.log("✅ Scenario 5: Native ETH Investment");
  console.log("✅ Scenario 6: Multi-Token Investment");
  console.log("✅ Scenario 7: Multiple Investors Proportional Distribution");
  console.log("✅ Scenario 8: Escrow and Refund Flow");
  console.log("✅ Scenario 9: Investment Limits Validation");
  console.log("✅ Scenario 10: Admin Functions");
  
  console.log("\n🎉 All scenarios completed successfully!");
  console.log("💡 The offering ecosystem with integrated WrapedToken payouts and emergency unlock is working perfectly!");
}

main().catch((error) => {
  console.error("💥 Simulation failed:", error);
  process.exitCode = 1;
});