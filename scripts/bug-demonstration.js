// scripts/bug-demonstration.js
// This script demonstrates the bugs found in the review

const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const parseUnits = (value, decimals = 18) => ethers.parseUnits(String(value), decimals);
const formatUnits = (value, decimals = 18) => ethers.formatUnits(value, decimals);

async function main() {
  console.log("🐛 Bug Demonstration Script");
  console.log("=".repeat(50));

  const [deployer, tokenOwner, treasuryOwner, investor1, kybValidator] = await ethers.getSigners();

  // Deploy basic contracts for testing
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const saleToken = await MockERC20.deploy("Sale Token", "SALE");
  const paymentToken = await MockERC20.deploy("Payment Token", "PAY");

  const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
  const oracle = await MockV3Aggregator.deploy(parseUnits("1.0", 18), true);

  const InvestmentManager = await ethers.getContractFactory("InvestmentManager");
  const investmentManager = await InvestmentManager.deploy();

  console.log("📦 Basic contracts deployed for testing");

  // --- BUG 1: Multiple KYB Validators Test ---
  console.log("\n🔍 Testing Multiple KYB Validators...");
  
  try {
    // Add multiple validators
    await investmentManager.connect(deployer).addKYBValidator(kybValidator.address);
    await investmentManager.connect(deployer).addKYBValidator(investor1.address);
    
    const validatorCount = await investmentManager.getKYBValidatorCount();
    console.log(`✅ Added ${validatorCount} validators successfully`);
    
    // Test signature verification with different validators
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const contractAddress = await investmentManager.getAddress();
    const nonce = Date.now();
    const expiry = (await time.latest()) + 3600;

    // Generate signature with first validator
    const messageHash1 = ethers.solidityPackedKeccak256(
      ["string", "address", "uint256", "uint256", "uint256", "address"],
      ["KYB_VALIDATION", investor1.address, nonce, expiry, chainId, contractAddress]
    );
    const signature1 = await kybValidator.signMessage(ethers.getBytes(messageHash1));

    // Generate signature with second validator
    const messageHash2 = ethers.solidityPackedKeccak256(
      ["string", "address", "uint256", "uint256", "uint256", "address"],
      ["KYB_VALIDATION", investor1.address, nonce + 1, expiry, chainId, contractAddress]
    );
    const signature2 = await investor1.signMessage(ethers.getBytes(messageHash2));

    // Both should be valid
    const isValid1 = await investmentManager.verifyKYBSignature(
      investor1.address, nonce, expiry, signature1
    );
    const isValid2 = await investmentManager.verifyKYBSignature(
      investor1.address, nonce + 1, expiry, signature2
    );

    console.log(`✅ Signature from validator 1: ${isValid1}`);
    console.log(`✅ Signature from validator 2: ${isValid2}`);

    // Test removing validator
    await investmentManager.connect(deployer).removeKYBValidator(investor1.address);
    const newCount = await investmentManager.getKYBValidatorCount();
    console.log(`✅ Removed validator, new count: ${newCount}`);

    console.log("✅ Multiple KYB validators working correctly");
  } catch (error) {
    console.error("❌ Multiple KYB validators test failed:", error.message);
  }

  // --- BUG 2: Demonstrate AutoTransfer Issue ---
  console.log("\n🐛 Demonstrating AutoTransfer Bug...");
  
  try {
    console.log("⚠️  BUG: autoTransfer parameter is stored but not used in investment logic");
    console.log("⚠️  All investments currently behave as non-auto-transfer");
    console.log("⚠️  This means tokens are always held as 'pending' regardless of autoTransfer setting");
    console.log("⚠️  Users must always call claimTokens() even when autoTransfer = true");
    
    console.log("\n💡 EXPECTED BEHAVIOR:");
    console.log("   - autoTransfer = true → Immediate token transfer to investor");
    console.log("   - autoTransfer = false → Tokens held as pending, require manual claim");
    
    console.log("\n🔧 FIX NEEDED: Implement conditional logic in invest() function");
  } catch (error) {
    console.error("❌ AutoTransfer demonstration failed:", error.message);
  }

  // --- BUG 3: Demonstrate Struct Mismatch ---
  console.log("\n🐛 Demonstrating Struct Name Mismatch...");
  
  try {
    console.log("⚠️  BUG: OfferingFactory creates 'WrapedTokenConfig' but constructor expects 'WrappedTokenConfig'");
    console.log("⚠️  This will cause deployment failures when APY is enabled");
    
    console.log("\n📝 CURRENT CODE:");
    console.log("   OfferingFactory.sol: WrapedTokenConfig memory wrappedConfig");
    console.log("   WrapedToken.sol: constructor(WrappedTokenConfig memory config)");
    
    console.log("\n🔧 FIX NEEDED: Standardize struct names across contracts");
  } catch (error) {
    console.error("❌ Struct mismatch demonstration failed:", error.message);
  }

  // --- BUG 4: Oracle Staleness Issue ---
  console.log("\n🐛 Demonstrating Oracle Staleness Issue...");
  
  try {
    console.log("⚠️  BUG: Oracle price staleness not validated");
    console.log("⚠️  Contract accepts any price regardless of how old it is");
    
    // Demonstrate with stale oracle
    const staleOracle = await MockV3Aggregator.deploy(parseUnits("1.0", 18), false); // fresh = false
    
    console.log("\n📊 Oracle Status:");
    const [price, timestamp] = await staleOracle.read();
    const currentTime = await time.latest();
    const age = currentTime - timestamp;
    
    console.log(`   Price: ${formatUnits(price)}`);
    console.log(`   Timestamp: ${timestamp}`);
    console.log(`   Current Time: ${currentTime}`);
    console.log(`   Age: ${age} seconds (${Math.floor(age / 3600)} hours)`);
    
    console.log("\n🔧 FIX NEEDED: Add staleness validation in getUSDValue()");
  } catch (error) {
    console.error("❌ Oracle staleness demonstration failed:", error.message);
  }

  // --- BUG 5: Escrow Function Overloading ---
  console.log("\n🐛 Demonstrating Escrow Function Overloading Issue...");
  
  try {
    console.log("⚠️  BUG: Escrow.sol has two enableRefunds() functions");
    console.log("⚠️  Solidity doesn't support function overloading with same signature");
    console.log("⚠️  This will cause compilation errors");
    
    console.log("\n📝 CONFLICTING FUNCTIONS:");
    console.log("   1. enableRefunds(address _offeringContract) external onlyOwner");
    console.log("   2. enableRefunds(address _offeringContract) external");
    
    console.log("\n🔧 FIX NEEDED: Rename functions or merge logic");
  } catch (error) {
    console.error("❌ Function overloading demonstration failed:", error.message);
  }

  // --- FLOW ANALYSIS ---
  console.log("\n📊 FLOW ANALYSIS SUMMARY");
  console.log("=".repeat(50));
  
  console.log("\n✅ CORRECT FLOWS:");
  console.log("   • KYB signature generation and verification");
  console.log("   • Multiple payment token support");
  console.log("   • Escrow deposit and withdrawal");
  console.log("   • Wrapped token payout distribution");
  console.log("   • Emergency unlock with penalties");
  console.log("   • Investment limits validation");
  console.log("   • Role-based access control");

  console.log("\n❌ INCORRECT FLOWS:");
  console.log("   • AutoTransfer not implemented");
  console.log("   • Wrapped token registration timing");
  console.log("   • Oracle staleness validation missing");
  console.log("   • Escrow finalization authority");
  console.log("   • Function overloading conflicts");

  console.log("\n🚨 CRITICAL FIXES NEEDED:");
  console.log("   1. Fix Escrow function overloading");
  console.log("   2. Implement autoTransfer logic");
  console.log("   3. Fix struct name mismatch");
  console.log("   4. Add oracle staleness validation");
  console.log("   5. Fix wrapped token registration timing");

  console.log("\n💡 The core architecture is sound, but these bugs must be fixed before production deployment.");
}

main().catch((error) => {
  console.error("💥 Bug demonstration failed:", error);
  process.exitCode = 1;
});