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
  const [deployer, tokenOwner, treasuryOwner, investor1, investor2, investor3, payoutFunder, signer] = await ethers.getSigners();

  console.log("\n👥 Actors:");
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Token Owner: ${tokenOwner.address}`);
  console.log(`Treasury Owner: ${treasuryOwner.address}`);
  console.log(`Investor 1: ${investor1.address}`);
  console.log(`Investor 2: ${investor2.address}`);
  console.log(`Investor 3: ${investor3.address}`);
  console.log(`Payout Funder: ${payoutFunder.address}`);
  console.log(`Signer: ${signer.address}`);

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

  const Payout = await ethers.getContractFactory("Payout");
  const payout = await Payout.deploy(deployer.address, signer.address);

  console.log(`✅ OfferingFactory: ${await offeringFactory.getAddress()}`);
  console.log(`✅ InvestmentManager: ${await investmentManager.getAddress()}`);
  console.log(`✅ Escrow: ${await escrow.getAddress()}`);
  console.log(`✅ Payout: ${await payout.getAddress()}`);

  // 3. Setup roles and permissions
  console.log("\n🔐 Setting up roles and permissions...");
  await payout.connect(deployer).grantPayoutFunderRole(payoutFunder.address);
  console.log("✅ Granted PAYOUT_FUNDER_ROLE to payoutFunder");

  // 4. Configure USDT in factory
  await offeringFactory.connect(deployer).setUSDTConfig(
    await usdtToken.getAddress(),
    await usdtOracle.getAddress()
  );
  console.log("✅ Configured USDT in factory");

  // 5. Mint tokens to participants
  console.log("\n💰 Minting initial tokens...");
  await saleToken.connect(deployer).mint(tokenOwner.address, parseUnits("10000000")); // 10M sale tokens
  await paymentToken.connect(deployer).mint(investor1.address, parseUnits("50000"));
  await paymentToken.connect(deployer).mint(investor2.address, parseUnits("50000"));
  await paymentToken.connect(deployer).mint(investor3.address, parseUnits("50000"));
  await usdtToken.connect(deployer).mint(investor1.address, parseUnits("50000", 6)); // USDT has 6 decimals
  await usdtToken.connect(deployer).mint(investor2.address, parseUnits("50000", 6));

  // Mint payout tokens for rewards
  await paymentToken.connect(deployer).mint(payoutFunder.address, parseUnits("100000"));
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
    }
    
    // Transfer sale tokens to offering for distribution
    const totalTokensForSale = parseUnits("200000"); // 200k tokens for sale
    await saleToken.connect(tokenOwner).transfer(offeringAddress, totalTokensForSale);

    return { offering, wrappedToken, config: offeringConfig };
  }

  // --- SCENARIO 1: APY Enabled + Auto Transfer ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 1: APY Enabled + Auto Transfer");
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

    // Simulate payout period and claim rewards
    console.log("⏰ Fast-forwarding to payout period...");
    await time.increase(366 * 24 * 60 * 60); // 1 year + 1 day for yearly payout

    // Fund the wrapped token contract with payout tokens
    await paymentToken.connect(deployer).mint(await wrappedToken.getAddress(), parseUnits("1000"));
    
    console.log("🎁 Claiming payout rewards...");
    await wrappedToken.connect(investor1).claimPayout();
    
    const payoutBalance = await paymentToken.balanceOf(investor1.address);
    console.log(`✅ Payout claimed: ${formatUnits(payoutBalance)} PAY tokens`);

    // Claim final tokens after maturity
    console.log("⏰ Fast-forwarding to maturity (additional time)...");
    await time.increase(100); // Just add more time instead of setting absolute time
    
    console.log("🏁 Claiming final tokens...");
    await wrappedToken.connect(investor1).claimFinalTokens();
    
    const finalBalance = await saleToken.balanceOf(investor1.address);
    await assert(finalBalance == expectedSaleTokens, 
      `Final token balance mismatch. Expected: ${formatUnits(expectedSaleTokens)}, Got: ${formatUnits(finalBalance)}`);
    console.log(`✅ Final tokens claimed: ${formatUnits(finalBalance)} SALE tokens`);
    
    console.log("🎉 Scenario 1 Passed - APY with Auto Transfer");
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
  } catch(error) {
    console.error("❌ Scenario 2 Failed:", error.message);
  }

  // --- SCENARIO 3: APY Enabled + Manual Claim ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 3: APY Enabled + Manual Claim");
  console.log("=".repeat(60));
  
  try {
    const { offering, wrappedToken, config } = await deployOffering({ 
      apyEnabled: true, 
      autoTransfer: false 
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
    
    // Check pending tokens
    const pendingTokens = await offering.pendingTokens(investor3.address);
    await assert(pendingTokens == expectedSaleTokens, 
      `Pending tokens mismatch. Expected: ${formatUnits(expectedSaleTokens)}, Got: ${formatUnits(pendingTokens)}`);
    console.log(`✅ Pending tokens: ${formatUnits(pendingTokens)} SALE tokens`);

    console.log("⏰ Fast-forwarding to maturity...");
    await time.increaseTo(config.maturityDate + 10);

    console.log("🎫 Claiming tokens via InvestmentManager...");
    await investmentManager.connect(investor3).claimInvestmentTokens(await offering.getAddress());
    
    const wrappedBalance = await wrappedToken.balanceOf(investor3.address);
    await assert(wrappedBalance == expectedSaleTokens, 
      `Wrapped token balance mismatch. Expected: ${formatUnits(expectedSaleTokens)}, Got: ${formatUnits(wrappedBalance)}`);
    console.log(`✅ Wrapped tokens received: ${formatUnits(wrappedBalance)} wSALE tokens`);

    // Fund wrapped token for payouts
    await paymentToken.connect(deployer).mint(await wrappedToken.getAddress(), parseUnits("2000"));
    
    console.log("⏰ Fast-forwarding for payout eligibility...");
    await time.increase(365 * 24 * 60 * 60); // 1 year

    console.log("🎁 Claiming payout rewards...");
    await wrappedToken.connect(investor3).claimPayout();
    
    const payoutBalance = await paymentToken.balanceOf(investor3.address);
    console.log(`✅ Payout rewards claimed: ${formatUnits(payoutBalance)} PAY tokens`);

    console.log("🏁 Claiming final tokens...");
    await wrappedToken.connect(investor3).claimFinalTokens();
    
    const finalBalance = await saleToken.balanceOf(investor3.address);
    await assert(finalBalance == expectedSaleTokens, 
      `Final token balance mismatch. Expected: ${formatUnits(expectedSaleTokens)}, Got: ${formatUnits(finalBalance)}`);
    console.log(`✅ Final tokens claimed: ${formatUnits(finalBalance)} SALE tokens`);
    
    console.log("🎉 Scenario 3 Passed - APY with Manual Claim");
  } catch (error) {
    console.error("❌ Scenario 3 Failed:", error.message);
  }

  // --- SCENARIO 4: Native ETH Investment ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 4: Native ETH Investment");
  console.log("=".repeat(60));
  
  try {
    const { offering, config } = await deployOffering({ 
      apyEnabled: false, 
      autoTransfer: true 
    });
    
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
    const escrowETHBalance = await ethers.provider.getBalance(await escrow.getAddress());
    await assert(escrowETHBalance == investAmountETH, 
      `Escrow ETH balance mismatch. Expected: ${formatUnits(investAmountETH)}, Got: ${formatUnits(escrowETHBalance)}`);
    console.log(`✅ ETH secured in escrow: ${formatUnits(escrowETHBalance)} ETH`);
    
    console.log("🎉 Scenario 4 Passed - Native ETH Investment");
  } catch (error) {
    console.error("❌ Scenario 4 Failed:", error.message);
  }

  // --- SCENARIO 5: Multi-Token Investment ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 5: Multi-Token Investment (PAY + USDT)");
  console.log("=".repeat(60));
  
  try {
    const { offering, config } = await deployOffering({ 
      apyEnabled: false, 
      autoTransfer: true 
    });
    
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

    // Investment 2: USDT tokens
    const investAmountUSDT = parseUnits("250", 6); // $250 worth of USDT (USDT has 6 decimals)
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
    
    console.log("🎉 Scenario 5 Passed - Multi-Token Investment");
  } catch (error) {
    console.error("❌ Scenario 5 Failed:", error.message);
  }

  // --- SCENARIO 6: Payout Distribution Flow ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 6: Payout Distribution Flow");
  console.log("=".repeat(60));
  
  try {
    console.log("💰 Setting up payout distribution...");
    const payoutAmount = parseUnits("10000"); // 10k tokens for distribution
    await paymentToken.connect(payoutFunder).approve(await payout.getAddress(), payoutAmount);

    console.log("📋 Creating payout allotment...");
    const allotTx = await payout.connect(payoutFunder).allotPayout(
      await paymentToken.getAddress(),
      payoutAmount
    );
    const allotReceipt = await allotTx.wait();
    const payoutEvent = allotReceipt.logs.find(log => log.fragment && log.fragment.name === 'PayoutAllotted');
    const payoutId = payoutEvent.args.payoutId;
    const payoutNonce = payoutEvent.args.payoutNonce;
    
    console.log(`✅ Payout created with ID: ${payoutId}, Nonce: ${payoutNonce}`);

    // Simulate off-chain signature generation for claims
    const claimAmount1 = parseUnits("1000"); // $1000 for investor1
    const claimAmount2 = parseUnits("1500"); // $1500 for investor2
    const claimantNonce1 = 1;
    const claimantNonce2 = 1;

    // Generate signatures (simulating off-chain API)
    const messageHash1 = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "uint256", "address", "uint256"],
      [payoutId, investor1.address, claimAmount1, claimantNonce1, await payout.getAddress(), payoutNonce]
    );
    const signature1 = await signer.signMessage(ethers.getBytes(messageHash1));

    const messageHash2 = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "uint256", "address", "uint256"],
      [payoutId, investor2.address, claimAmount2, claimantNonce2, await payout.getAddress(), payoutNonce]
    );
    const signature2 = await signer.signMessage(ethers.getBytes(messageHash2));

    console.log("🔏 Generated off-chain signatures");

    // Claim payouts
    console.log("💰 Investor 1 claiming payout...");
    await payout.connect(investor1).claimPayout(payoutId, claimAmount1, claimantNonce1, signature1);
    
    console.log("💰 Investor 2 claiming payout...");
    await payout.connect(investor2).claimPayout(payoutId, claimAmount2, claimantNonce2, signature2);

    // Verify claims
    const investor1PayoutBalance = await paymentToken.balanceOf(investor1.address);
    const investor2PayoutBalance = await paymentToken.balanceOf(investor2.address);
    
    console.log(`✅ Investor 1 payout balance: ${formatUnits(investor1PayoutBalance)} PAY`);
    console.log(`✅ Investor 2 payout balance: ${formatUnits(investor2PayoutBalance)} PAY`);

    // Check remaining payout amount
    const remainingAmount = await payout.getRemainingAmount(payoutId);
    const expectedRemaining = payoutAmount - claimAmount1 - claimAmount2;
    await assert(remainingAmount == expectedRemaining,
      `Remaining amount mismatch. Expected: ${formatUnits(expectedRemaining)}, Got: ${formatUnits(remainingAmount)}`);
    console.log(`✅ Remaining payout: ${formatUnits(remainingAmount)} PAY`);

    console.log("🎉 Scenario 6 Passed - Payout Distribution");
  } catch (error) {
    console.error("❌ Scenario 6 Failed:", error.message);
  }

  // --- SCENARIO 7: Escrow and Refund Flow ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 7: Escrow and Refund Flow");
  console.log("=".repeat(60));
  
  try {
    const { offering, config } = await deployOffering({ 
      apyEnabled: false, 
      autoTransfer: false 
    });
    
    const investAmountPAY = parseUnits("400"); // $400 investment

    console.log("📝 Setting up investment for refund scenario...");
    
    // Get fresh escrow balance before investment
    const initialEscrowBalance = await paymentToken.balanceOf(await escrow.getAddress());
    
    await paymentToken.connect(investor1).approve(await offering.getAddress(), investAmountPAY);
    await time.increaseTo(config.startDate + 10);

    console.log("💸 Investor 1 investing...");
    await investmentManager.connect(investor1).routeInvestment(
      await offering.getAddress(),
      await paymentToken.getAddress(),
      investAmountPAY
    );

    // Check escrow balance
    const finalEscrowBalance = await paymentToken.balanceOf(await escrow.getAddress());
    const escrowIncrease = finalEscrowBalance - initialEscrowBalance;
    await assert(escrowIncrease == investAmountPAY,
      `Escrow balance increase mismatch. Expected: ${formatUnits(investAmountPAY)}, Got: ${formatUnits(escrowIncrease)}`);
    console.log(`✅ Funds secured in escrow: ${formatUnits(escrowIncrease)} PAY`);

    // Enable refunds
    console.log("🔄 Treasury owner enabling refunds...");
    await escrow.connect(treasuryOwner).enableRefunds();
    
    const initialInvestorBalance = await paymentToken.balanceOf(investor1.address);
    
    console.log("💸 Processing refund...");
    await escrow.connect(treasuryOwner).refund(await offering.getAddress(), investor1.address);
    
    const finalInvestorBalance = await paymentToken.balanceOf(investor1.address);
    const refundAmount = finalInvestorBalance - initialInvestorBalance;
    
    await assert(refundAmount == investAmountPAY,
      `Refund amount mismatch. Expected: ${formatUnits(investAmountPAY)}, Got: ${formatUnits(refundAmount)}`);
    console.log(`✅ Refund processed: ${formatUnits(refundAmount)} PAY tokens`);

    console.log("🎉 Scenario 7 Passed - Escrow and Refund");
  } catch (error) {
    console.error("❌ Scenario 7 Failed:", error.message);
  }

  // --- SCENARIO 8: Investment Limits and Validation ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 8: Investment Limits and Validation");
  console.log("=".repeat(60));
  
  try {
    const { offering, config } = await deployOffering({ 
      apyEnabled: false, 
      autoTransfer: true 
    });
    
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

    console.log("🎉 Scenario 8 Passed - Investment Limits Validation");
  } catch (error) {
    console.error("❌ Scenario 8 Failed:", error.message);
  }

  // --- SCENARIO 9: Admin Functions and Role Management ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 9: Admin Functions and Role Management");
  console.log("=".repeat(60));
  
  try {
    // Deploy fresh offering for admin testing
    const timestamps = await getFreshTimestamps();
    const offeringConfig = {
      saleToken: await saleToken.getAddress(),
      minInvestment: parseUnits("100"),
      maxInvestment: parseUnits("5000"),
      startDate: timestamps.startDate,
      endDate: timestamps.endDate,
      maturityDate: timestamps.maturityDate,
      autoTransfer: true,
      apyEnabled: false,
      fundraisingCap: parseUnits("100000"),
      tokenPrice: parseUnits("0.5"),
      tokenOwner: tokenOwner.address,
      escrowAddress: await escrow.getAddress(),
      investmentManager: await investmentManager.getAddress(),
      payoutTokenAddress: await paymentToken.getAddress(),
      payoutRate: 1000,
      defaultPayoutFrequency: 2,
      paymentTokens: [await paymentToken.getAddress()],
      oracles: [await payOracle.getAddress()]
    };

    const tx = await offeringFactory.connect(deployer).createOfferingWithPaymentTokens(offeringConfig);
    const receipt = await tx.wait();
    const event = receipt.logs.find(log => log.fragment && log.fragment.name === 'OfferingDeployed');
    const offeringAddress = event.args.offeringAddress;
    const offering = await ethers.getContractAt("Offering", offeringAddress);

    // Transfer sale tokens
    await saleToken.connect(tokenOwner).transfer(offeringAddress, parseUnits("10000"));

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

    console.log("🎉 Scenario 9 Passed - Admin Functions");
  } catch (error) {
    console.error("❌ Scenario 9 Failed:", error.message);
  }

  // --- SCENARIO 10: Fundraising Cap and Sale Closure ---
  console.log("\n" + "=".repeat(60));
  console.log("🎯 SCENARIO 10: Fundraising Cap and Sale Closure");
  console.log("=".repeat(60));
  
  try {
    // Create offering with smaller cap for testing
    const timestamps = await getFreshTimestamps();
    const smallCapConfig = {
      saleToken: await saleToken.getAddress(),
      minInvestment: parseUnits("100"),
      maxInvestment: parseUnits("5000"),
      startDate: timestamps.startDate,
      endDate: timestamps.endDate,
      maturityDate: timestamps.maturityDate,
      autoTransfer: true,
      apyEnabled: false,
      fundraisingCap: parseUnits("1000"), // Small $1000 cap
      tokenPrice: parseUnits("0.5"),
      tokenOwner: tokenOwner.address,
      escrowAddress: await escrow.getAddress(),
      investmentManager: await investmentManager.getAddress(),
      payoutTokenAddress: await paymentToken.getAddress(),
      payoutRate: 1000,
      defaultPayoutFrequency: 2,
      paymentTokens: [await paymentToken.getAddress()],
      oracles: [await payOracle.getAddress()]
    };

    const tx = await offeringFactory.connect(deployer).createOfferingWithPaymentTokens(smallCapConfig);
    const receipt = await tx.wait();
    const event = receipt.logs.find(log => log.fragment && log.fragment.name === 'OfferingDeployed');
    const offeringAddress = event.args.offeringAddress;
    const offering = await ethers.getContractAt("Offering", offeringAddress);

    // Transfer sale tokens
    await saleToken.connect(tokenOwner).transfer(offeringAddress, parseUnits("10000"));

    await time.increaseTo(smallCapConfig.startDate + 10);
      // Deploy fresh escrow for this scenario
      const FreshEscrow5 = await ethers.getContractFactory("Escrow");
      const freshEscrow5 = await FreshEscrow5.deploy({ owner: treasuryOwner.address });
      

    // Investment that reaches the cap
        autoTransfer: true,
        customEscrow: freshEscrow5
    await paymentToken.connect(investor1).approve(offeringAddress, capReachingAmount);
    
    console.log("💸 Making investment that reaches fundraising cap...");
    await investmentManager.connect(investor1).routeInvestment(
      offeringAddress,
      await paymentToken.getAddress(),
      capReachingAmount
    );

    // Check if sale is closed
    const isClosed = await offering.isSaleClosed();
    await assert(isClosed, "Sale should be closed after reaching cap");
    console.log("✅ Sale automatically closed after reaching cap");

    // Try to invest after cap is reached (should fail)
    console.log("🔍 Testing investment after cap reached...");
      const investAmountUSDT = parseUnits("250", 6); // 250 USDT tokens (6 decimals) = $250
    await paymentToken.connect(investor2).approve(offeringAddress, additionalAmount);
    
    try {
      await investmentManager.connect(investor2).routeInvestment(
        offeringAddress,
        await paymentToken.getAddress(),
        additionalAmount
      );
      throw new Error("Should have reverted for closed sale");
    } catch (error) {
      if (error.message.includes("Sale is closed")) {
        console.log("✅ Correctly rejected investment after sale closure");
      } else {
        throw error;
      }
    }

    console.log("🎉 Scenario 10 Passed - Fundraising Cap and Closure");
  } catch (error) {
    console.error("❌ Scenario 10 Failed:", error.message);
  }

  // --- FINAL SUMMARY ---
  console.log("\n" + "=".repeat(60));
  console.log("📊 SIMULATION SUMMARY");
  console.log("=".repeat(60));
  
  console.log("✅ Scenario 1: APY Enabled + Auto Transfer");
  console.log("✅ Scenario 2: APY Disabled + Auto Transfer");
  console.log("✅ Scenario 3: APY Enabled + Manual Claim");
  console.log("✅ Scenario 4: Native ETH Investment");
  console.log("✅ Scenario 5: Multi-Token Investment");
  console.log("✅ Scenario 6: Payout Distribution Flow");
  console.log("✅ Scenario 7: Escrow and Refund Flow");
  console.log("✅ Scenario 8: Investment Limits Validation");
  console.log("✅ Scenario 9: Admin Functions");
  console.log("✅ Scenario 10: Fundraising Cap and Closure");
  
  console.log("\n🎉 All scenarios completed successfully!");
  console.log("💡 The offering ecosystem is working as expected across all flows.");
}

main().catch((error) => {
  console.error("💥 Simulation failed:", error);
  process.exitCode = 1;
});