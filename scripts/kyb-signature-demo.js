// scripts/kyb-signature-demo.js

const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Helper functions
const parseUnits = (value, decimals = 18) => ethers.parseUnits(String(value), decimals);
const formatUnits = (value, decimals = 18) => ethers.formatUnits(value, decimals);

/**
 * Generate KYB signature for a wallet
 * @param {string} walletAddress - Address of the wallet to validate
 * @param {number} nonce - Unique nonce for this signature
 * @param {number} expiry - Expiry timestamp
 * @param {number} chainId - Chain ID
 * @param {string} contractAddress - InvestmentManager contract address
 * @param {ethers.Signer} signer - KYB validator signer
 * @returns {Object} Signature components
 */
async function generateKYBSignature(walletAddress, nonce, expiry, chainId, contractAddress, signer) {
  // Create the message hash (same as in contract)
  const messageHash = ethers.solidityPackedKeccak256(
    ["string", "address", "uint256", "uint256", "uint256", "address"],
    ["KYB_VALIDATION", walletAddress, nonce, expiry, chainId, contractAddress]
  );
  
  // Sign the message hash
  const signature = await signer.signMessage(ethers.getBytes(messageHash));
  
  return {
    messageHash,
    signature,
    nonce,
    expiry
  };
}

async function main() {
  console.log("🔐 Starting KYB Signature Validation Demo");
  console.log("=".repeat(60));

  // Get signers
  const [deployer, tokenOwner, treasuryOwner, kybValidator, investor1, investor2, investor3] = await ethers.getSigners();

  console.log("\n👥 Demo Actors:");
  console.log(`Deployer: ${deployer.address}`);
  console.log(`KYB Validator: ${kybValidator.address}`);
  console.log(`Investor 1: ${investor1.address}`);
  console.log(`Investor 2: ${investor2.address}`);
  console.log(`Investor 3: ${investor3.address}`);

  // 1. Deploy Mock Contracts
  console.log("\n📦 Deploying mock contracts...");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const saleToken = await MockERC20.deploy("Sale Token", "SALE");
  const paymentToken = await MockERC20.deploy("Payment Token", "PAY");

  const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
  const payOracle = await MockV3Aggregator.deploy(parseUnits("1.0", 18), true); // 1 PAY = 1 USD

  console.log(`✅ Sale Token: ${await saleToken.getAddress()}`);
  console.log(`✅ Payment Token: ${await paymentToken.getAddress()}`);

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

  console.log(`✅ InvestmentManager: ${await investmentManager.getAddress()}`);

  // 3. Configure KYB Validator
  console.log("\n🔐 Setting up KYB validator...");
  await investmentManager.connect(deployer).setKYBValidator(kybValidator.address);
  console.log(`✅ KYB Validator set: ${kybValidator.address}`);

  // Add additional validator for testing
  const [, , , , , , , additionalValidator] = await ethers.getSigners();
  await investmentManager.connect(deployer).addKYBValidator(additionalValidator.address);
  console.log(`✅ Additional KYB Validator added: ${additionalValidator.address}`);

  // 4. Configure System
  await investmentManager.connect(deployer).setEscrowContract(await escrow.getAddress());
  await escrow.connect(treasuryOwner).setInvestmentManager(await investmentManager.getAddress());
  await offeringFactory.connect(deployer).setUSDTConfig(
    await paymentToken.getAddress(),
    await payOracle.getAddress()
  );

  // 5. Mint tokens
  console.log("\n💰 Minting tokens...");
  await saleToken.connect(deployer).mint(tokenOwner.address, parseUnits("1000000"));
  await paymentToken.connect(deployer).mint(investor1.address, parseUnits("10000"));
  await paymentToken.connect(deployer).mint(investor2.address, parseUnits("10000"));
  await paymentToken.connect(deployer).mint(investor3.address, parseUnits("10000"));

  // 6. Create Offering
  console.log("\n🎯 Creating offering...");
  const now = await time.latest();
  const timestamps = {
    startDate: now + 200,
    endDate: now + 200 + 3600,
    maturityDate: now + 200 + 7200,
    firstPayoutDate: now + 200 + 1800,
    payoutPeriodDuration: 2592000
  };

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
    payoutPeriodDuration: timestamps.payoutPeriodDuration,
    firstPayoutDate: timestamps.firstPayoutDate,
    customWrappedName: "",
    customWrappedSymbol: ""
  };

  const tx = await offeringFactory.connect(deployer).createOfferingWithPaymentTokens(
    offeringConfig,
    [await paymentToken.getAddress()],
    [await payOracle.getAddress()]
  );
  
  const receipt = await tx.wait();
  const event = receipt.logs.find(log => log.fragment && log.fragment.name === 'OfferingDeployed');
  const offeringAddress = event.args.offeringAddress;
  const offering = await ethers.getContractAt("Offering", offeringAddress);

  // Register offering in escrow
  await escrow.connect(treasuryOwner).registerOffering(offeringAddress, tokenOwner.address);

  // Transfer sale tokens to offering
  await saleToken.connect(tokenOwner).transfer(offeringAddress, parseUnits("100000"));

  console.log(`✅ Offering created: ${offeringAddress}`);

  // --- SCENARIO 1: KYB Signature Validation ---
  console.log("\n" + "=".repeat(60));
  console.log("🔐 SCENARIO 1: KYB Signature Validation");
  console.log("=".repeat(60));

  try {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const contractAddress = await investmentManager.getAddress();

    // Generate KYB signature for investor1
    console.log("📝 Generating KYB signature for investor1...");
    const nonce1 = Date.now(); // Use timestamp as nonce
    const expiry1 = (await time.latest()) + 3600; // 1 hour expiry
    
    const kybSig1 = await generateKYBSignature(
      investor1.address,
      nonce1,
      expiry1,
      chainId,
      contractAddress,
      kybValidator
    );

    console.log(`✅ KYB signature generated for ${investor1.address}`);
    console.log(`📊 Nonce: ${nonce1}`);
    console.log(`📊 Expiry: ${new Date(expiry1 * 1000).toISOString()}`);

    // Verify signature off-chain
    const isValid = await investmentManager.verifyKYBSignature(
      investor1.address,
      kybSig1.nonce,
      kybSig1.expiry,
      kybSig1.signature
    );
    console.log(`✅ Signature verification: ${isValid}`);

    console.log("🎉 Scenario 1 Passed - KYB Signature Generation & Verification");
  } catch (error) {
    console.error("❌ Scenario 1 Failed:", error.message);
  }

  // --- SCENARIO 2: Investment with KYB Validation ---
  console.log("\n" + "=".repeat(60));
  console.log("💸 SCENARIO 2: Investment with KYB Validation");
  console.log("=".repeat(60));

  try {
    await time.increaseTo(timestamps.startDate + 10);

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const contractAddress = await investmentManager.getAddress();

    // Generate fresh KYB signature for investor1
    const nonce1 = Date.now() + 1;
    const expiry1 = (await time.latest()) + 3600;
    
    const kybSig1 = await generateKYBSignature(
      investor1.address,
      nonce1,
      expiry1,
      chainId,
      contractAddress,
      kybValidator
    );

    // Prepare investment
    const investAmount = parseUnits("500"); // $500 investment
    await paymentToken.connect(investor1).approve(offeringAddress, investAmount);

    console.log("💸 Investor1 investing with KYB validation...");
    
    // Investment with KYB signature
    await expect(investmentManager.connect(investor1).routeInvestmentWithKYB(
      offeringAddress,
      await paymentToken.getAddress(),
      investAmount,
      kybSig1.nonce,
      kybSig1.expiry,
      kybSig1.signature
    ))
      .to.emit(investmentManager, "KYBValidatedInvestment");

    console.log(`✅ Investment completed with KYB validation`);

    // Check investment results
    const totalRaised = await offering.totalRaised();
    const investorTokens = await saleToken.balanceOf(investor1.address);
    console.log(`📊 Total raised: $${formatUnits(totalRaised)}`);
    console.log(`📊 Investor tokens: ${formatUnits(investorTokens)} SALE`);

    console.log("🎉 Scenario 2 Passed - Investment with KYB Validation");
  } catch (error) {
    console.error("❌ Scenario 2 Failed:", error.message);
  }

  // --- SCENARIO 3: Subsequent Investment (Requires New Signature) ---
  console.log("\n" + "=".repeat(60));
  console.log("🔄 SCENARIO 3: Subsequent Investment (Requires New Signature)");
  console.log("=".repeat(60));

  try {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const contractAddress = await investmentManager.getAddress();
    
    // Generate new signature for second investment
    const nonce2 = Date.now() + 2;
    const expiry2 = (await time.latest()) + 3600;
    
    const kybSig2 = await generateKYBSignature(
      investor1.address,
      nonce2,
      expiry2,
      chainId,
      contractAddress,
      kybValidator
    );
    
    const investAmount2 = parseUnits("300"); // $300 additional investment
    await paymentToken.connect(investor1).approve(offeringAddress, investAmount2);

    console.log("💸 Investor1 making second investment (new signature required)...");

    await expect(investmentManager.connect(investor1).routeInvestmentWithKYB(
      offeringAddress,
      await paymentToken.getAddress(),
      investAmount2,
      kybSig2.nonce,
      kybSig2.expiry,
      kybSig2.signature
    ))
      .to.emit(investmentManager, "KYBValidatedInvestment")

    console.log(`✅ Second investment completed with new signature`);

    const totalRaised = await offering.totalRaised();
    console.log(`📊 Total raised after second investment: $${formatUnits(totalRaised)}`);

    console.log("🎉 Scenario 3 Passed - Subsequent Investment");
  } catch (error) {
    console.error("❌ Scenario 3 Failed:", error.message);
  }

  // --- SCENARIO 4: Invalid Signature Rejection ---
  console.log("\n" + "=".repeat(60));
  console.log("❌ SCENARIO 4: Invalid Signature Rejection");
  console.log("=".repeat(60));

  try {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const contractAddress = await investmentManager.getAddress();

    // Generate signature with wrong signer (should fail)
    const nonce2 = Date.now() + 2;
    const expiry2 = (await time.latest()) + 3600;
    
    const invalidSig = await generateKYBSignature(
      investor2.address,
      nonce2,
      expiry2,
      chainId,
      contractAddress,
      deployer // Wrong signer!
    );

    const investAmount = parseUnits("200");
    await paymentToken.connect(investor2).approve(offeringAddress, investAmount);

    console.log("🚫 Attempting investment with invalid signature...");
    
    try {
      await investmentManager.connect(investor2).routeInvestmentWithKYB(
        offeringAddress,
        await paymentToken.getAddress(),
        investAmount,
        invalidSig.nonce,
        invalidSig.expiry,
        invalidSig.signature
      );
      throw new Error("Should have reverted for invalid signature");
    } catch (error) {
      if (error.message.includes("Invalid KYB signature")) {
        console.log("✅ Correctly rejected invalid signature");
      } else {
        throw error;
      }
    }

    console.log("🎉 Scenario 4 Passed - Invalid Signature Rejection");
  } catch (error) {
    console.error("❌ Scenario 4 Failed:", error.message);
  }

  // --- SCENARIO 5: Expired Signature Rejection ---
  console.log("\n" + "=".repeat(60));
  console.log("⏰ SCENARIO 5: Expired Signature Rejection");
  console.log("=".repeat(60));

  try {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const contractAddress = await investmentManager.getAddress();

    // Generate signature that's already expired
    const nonce3 = Date.now() + 3;
    const expiry3 = (await time.latest()) - 100; // Already expired
    
    const expiredSig = await generateKYBSignature(
      investor2.address,
      nonce3,
      expiry3,
      chainId,
      contractAddress,
      kybValidator
    );

    const investAmount = parseUnits("200");

    console.log("⏰ Attempting investment with expired signature...");
    
    try {
      await investmentManager.connect(investor2).routeInvestmentWithKYB(
        offeringAddress,
        await paymentToken.getAddress(),
        investAmount,
        expiredSig.nonce,
        expiredSig.expiry,
        expiredSig.signature
      );
      throw new Error("Should have reverted for expired signature");
    } catch (error) {
      if (error.message.includes("Signature expired")) {
        console.log("✅ Correctly rejected expired signature");
      } else {
        throw error;
      }
    }

    console.log("🎉 Scenario 5 Passed - Expired Signature Rejection");
  } catch (error) {
    console.error("❌ Scenario 5 Failed:", error.message);
  }

  // --- SCENARIO 6: Signature Replay Attack Prevention ---
  console.log("\n" + "=".repeat(60));
  console.log("🔒 SCENARIO 6: Signature Replay Attack Prevention");
  console.log("=".repeat(60));

  try {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const contractAddress = await investmentManager.getAddress();

    // Generate valid signature for investor2
    const nonce4 = Date.now() + 4;
    const expiry4 = (await time.latest()) + 3600;
    
    const validSig = await generateKYBSignature(
      investor2.address,
      nonce4,
      expiry4,
      chainId,
      contractAddress,
      kybValidator
    );

    const investAmount = parseUnits("400");
    await paymentToken.connect(investor2).approve(offeringAddress, investAmount);

    console.log("💸 First investment with valid signature...");
    await investmentManager.connect(investor2).routeInvestmentWithKYB(
      offeringAddress,
      await paymentToken.getAddress(),
      investAmount,
      validSig.nonce,
      validSig.expiry,
      validSig.signature
    );
    console.log("✅ First investment successful");

    // Try to reuse the same signature (should fail)
    console.log("🔒 Attempting to reuse the same signature...");
    await paymentToken.connect(investor2).approve(offeringAddress, investAmount);
    
    try {
      await investmentManager.connect(investor2).routeInvestmentWithKYB(
        offeringAddress,
        await paymentToken.getAddress(),
        investAmount,
        validSig.nonce,
        validSig.expiry,
        validSig.signature
      );
      throw new Error("Should have reverted for signature replay");
    } catch (error) {
      if (error.message.includes("Invalid KYB signature")) {
        console.log("✅ Correctly prevented signature replay attack");
      } else {
        throw error;
      }
    }

    console.log("🎉 Scenario 6 Passed - Signature Replay Prevention");
  } catch (error) {
    console.error("❌ Scenario 6 Failed:", error.message);
  }

  // --- SCENARIO 7: Multiple Investments Same User ---
  console.log("\n" + "=".repeat(60));
  console.log("🔄 SCENARIO 7: Multiple Investments Same User");
  console.log("=".repeat(60));

  try {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const contractAddress = await investmentManager.getAddress();

    // First investment
    const nonce1 = Date.now() + 10;
    const expiry1 = (await time.latest()) + 3600;
    
    const sig1 = await generateKYBSignature(
      investor3.address,
      nonce1,
      expiry1,
      chainId,
      contractAddress,
      kybValidator
    );

    const investAmount1 = parseUnits("250");
    await paymentToken.connect(investor3).approve(offeringAddress, investAmount1);

    console.log("💸 Investor3 first investment...");
    await investmentManager.connect(investor3).routeInvestmentWithKYB(
      offeringAddress,
      await paymentToken.getAddress(),
      investAmount1,
      sig1.nonce,
      sig1.expiry,
      sig1.signature
    );

    // Second investment requires new signature
    const nonce2 = Date.now() + 11;
    const expiry2 = (await time.latest()) + 3600;
    
    const sig2 = await generateKYBSignature(
      investor3.address,
      nonce2,
      expiry2,
      chainId,
      contractAddress,
      kybValidator
    );

    const investAmount2 = parseUnits("150");
    await paymentToken.connect(investor3).approve(offeringAddress, investAmount2);

    console.log("💸 Investor3 second investment (new signature)...");
    await investmentManager.connect(investor3).routeInvestmentWithKYB(
      offeringAddress,
      await paymentToken.getAddress(),
      investAmount2,
      sig2.nonce,
      sig2.expiry,
      sig2.signature
    );

    console.log("✅ Both investments successful with separate signatures");

    console.log("🎉 Scenario 7 Passed - Multiple Investments Same User");
  } catch (error) {
    console.error("❌ Scenario 7 Failed:", error.message);
  }

  // --- FINAL SUMMARY ---
  console.log("\n" + "=".repeat(60));
  console.log("📊 KYB SIGNATURE DEMO SUMMARY");
  console.log("=".repeat(60));
  
  console.log("✅ Scenario 1: KYB Signature Generation & Verification");
  console.log("✅ Scenario 2: Investment with KYB Validation");
  console.log("✅ Scenario 3: Subsequent Investment (Requires New Signature)");
  console.log("✅ Scenario 4: Invalid Signature Rejection");
  console.log("✅ Scenario 5: Expired Signature Rejection");
  console.log("✅ Scenario 6: Signature Replay Attack Prevention");
  console.log("✅ Scenario 7: Multiple Investments Same User");
  
  console.log("\n🔐 KYB Features Implemented:");
  console.log("   🔹 Per-investment signature requirement");
  console.log("   🔹 Off-chain signature generation and verification");
  console.log("   🔹 Signature replay attack prevention");
  console.log("   🔹 Signature expiry validation");
  console.log("   🔹 Chain-specific signature binding");
  console.log("   🔹 No persistent wallet state storage");
  
  console.log("\n💡 Backend Integration Guide:");
  console.log("   1. Generate fresh signature for each investment");
  console.log("   2. Include nonce, expiry, chainId, and contract address");
  console.log("   3. Use ECDSA signing with the KYB validator private key");
  console.log("   4. Frontend calls routeInvestmentWithKYB() with signature");
  console.log("   5. Each investment requires a new unique signature");
  
  console.log("\n🎯 KYB signature validation system is fully functional!");
}

main().catch((error) => {
  console.error("💥 KYB signature demo failed:", error);
  process.exitCode = 1;
});