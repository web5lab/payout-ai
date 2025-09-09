// scripts/simulation.js

const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Helper to parse units for readability
const parseUnits = (value, decimals = 18) => ethers.parseUnits(String(value), decimals);
const formatUnits = (value, decimals = 18) => ethers.formatUnits(value, decimals);

// A simple assertion helper to replace 'expect'
async function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

async function main() {
  // Actors
  const [deployer, tokenOwner, treasuryOwner, investor1, investor2] = await ethers.getSigners();

  // 1. Deploy Mock/Test Contracts
  console.log("Deploying mock contracts...");
  const TestERC20 = await ethers.getContractFactory("TestERC20");
  const saleToken = await TestERC20.deploy("Sale Token", "SALE");
  const paymentToken = await TestERC20.deploy("Payment Token", "PAY");

  const OracleMock = await ethers.getContractFactory("OracleMock");
  const oracle = await OracleMock.deploy(parseUnits("1.0", 18), true);

  // 2. Deploy the main Factory
  console.log("Deploying OfferingFactory...");
  const OfferingFactory = await ethers.getContractFactory("OfferingFactory");
  const offeringFactory = await OfferingFactory.connect(deployer).deploy();

  // 3. Mint tokens to participants for the tests
  console.log("Minting initial tokens...");
  await saleToken.connect(deployer).mint(tokenOwner.address, parseUnits("1000000"));
  await paymentToken.connect(deployer).mint(investor1.address, parseUnits("50000"));
  await paymentToken.connect(deployer).mint(investor2.address, parseUnits("50000"));

  console.log("\nInitial Setup Complete");
  console.log("=======================");
  console.log("Deployer:", deployer.address);
  console.log("Token Owner:", tokenOwner.address);
  console.log("Investor 1:", investor1.address);
  console.log("Sale Token (SALE):", await saleToken.getAddress());
  console.log("Payment Token (PAY):", await paymentToken.getAddress());
  console.log("=======================\n");

  // Helper function to deploy a new offering for each scenario
  async function deployOffering(config) {
    const now = await time.latest();
    const offeringConfig = {
      saleToken: await saleToken.getAddress(),
      minInvestment: parseUnits("100"),
      maxInvestment: parseUnits("5000"),
      startDate: now + 100,
      endDate: now + 100 + 3600,
      maturityDate: now + 100 + 7200,
      autoTransfer: config.autoTransfer,
      apyEnabled: config.apyEnabled,
      fundraisingCap: parseUnits("100000"),
      tokenPrice: parseUnits("0.5"),
      tokenOwner: tokenOwner.address,
      tresuryOwner: treasuryOwner.address,
      paymentTokens: [await paymentToken.getAddress()],
      oracles: [await oracle.getAddress()],
    };

    const tx = await offeringFactory.createOfferingWithPaymentTokens(...Object.values(offeringConfig));
    const receipt = await tx.wait();
    const event = receipt.logs.find(log => log.eventName === 'OfferingDeployed');
    const offeringAddress = event.args.offeringAddress;
    
    const offering = await ethers.getContractAt("Offering", offeringAddress);

    let wrappedToken;
    if (config.apyEnabled) {
      const wrappedTokenAddress = await offering.wrappedTokenAddress();
      wrappedToken = await ethers.getContractAt("WRAPEDTOKEN", wrappedTokenAddress);
    }
    
    const totalTokensForSale = (offeringConfig.fundraisingCap * parseUnits("1")) / offeringConfig.tokenPrice;
    await saleToken.connect(tokenOwner).transfer(await offering.getAddress(), totalTokensForSale);

    return { offering, wrappedToken, config: offeringConfig };
  }

  // --- RUN SCENARIOS ---

  // SCENARIO 1: APY Enabled + Auto Transfer
  console.log("\n--- RUNNING SCENARIO 1: APY Enabled, Auto Transfer ---");
  try {
    const { offering, wrappedToken, config } = await deployOffering({ apyEnabled: true, autoTransfer: true });
    const investAmountPAY = parseUnits("1000");
    const expectedSaleTokens = (investAmountPAY * parseUnits("1")) / config.tokenPrice;

    await paymentToken.connect(investor1).approve(await offering.getAddress(), investAmountPAY);
    await time.increaseTo(config.startDate + 10);
    await offering.connect(investor1).invest(await paymentToken.getAddress(), investAmountPAY);
    console.log("  Investor 1 invested.");
    
    let bal = await wrappedToken.balanceOf(investor1.address);
    await assert(bal == expectedSaleTokens, `Wrapped token balance mismatch. Got ${formatUnits(bal)}`);
    
    await time.increaseTo(config.maturityDate + 10);
    await wrappedToken.connect(investor1).claimFinalTokens();
    console.log("  Investor 1 claimed final tokens.");
    
    bal = await saleToken.balanceOf(investor1.address);
    await assert(bal == expectedSaleTokens, `Final sale token balance mismatch. Got ${formatUnits(bal)}`);
    console.log("✅ Scenario 1 Passed");
  } catch (error) {
    console.error("❌ Scenario 1 Failed:", error.message);
  }


  // SCENARIO 2: APY Disabled + Auto Transfer
  console.log("\n--- RUNNING SCENARIO 2: APY Disabled, Auto Transfer ---");
  try {
    // Reset investor's balance for a clean test
    await saleToken.connect(investor1).transfer(deployer.address, await saleToken.balanceOf(investor1.address));

    const { offering, config } = await deployOffering({ apyEnabled: false, autoTransfer: true });
    const investAmountPAY = parseUnits("1000");
    const expectedSaleTokens = (investAmountPAY * parseUnits("1")) / config.tokenPrice;

    await paymentToken.connect(investor1).approve(await offering.getAddress(), investAmountPAY);
    await time.increaseTo(config.startDate + 10);
    await offering.connect(investor1).invest(await paymentToken.getAddress(), investAmountPAY);
    console.log("  Investor 1 invested.");

    let bal = await saleToken.balanceOf(investor1.address);
    await assert(bal == expectedSaleTokens, `Direct sale token balance mismatch. Got ${formatUnits(bal)}`);
    console.log("✅ Scenario 2 Passed");
  } catch(error) {
      console.error("❌ Scenario 2 Failed:", error.message);
  }


  // SCENARIO 3: APY Enabled + Manual Claim
  console.log("\n--- RUNNING SCENARIO 3: APY Enabled, Manual Claim ---");
  try {
    await saleToken.connect(investor1).transfer(deployer.address, await saleToken.balanceOf(investor1.address));

    const { offering, wrappedToken, config } = await deployOffering({ apyEnabled: true, autoTransfer: false });
    const investAmountPAY = parseUnits("1000");
    const expectedSaleTokens = (investAmountPAY * parseUnits("1")) / config.tokenPrice;

    await paymentToken.connect(investor1).approve(await offering.getAddress(), investAmountPAY);
    await time.increaseTo(config.startDate + 10);
    await offering.connect(investor1).invest(await paymentToken.getAddress(), investAmountPAY);
    console.log("  Investor 1 invested.");

    await time.increaseTo(config.maturityDate + 10);

    await offering.connect(investor1).claimTokens();
    console.log("  Investor 1 claimed wrapped tokens (Step 1).");
    let bal = await wrappedToken.balanceOf(investor1.address);
    await assert(bal == expectedSaleTokens, `Wrapped token balance mismatch after claim 1. Got ${formatUnits(bal)}`);

    await wrappedToken.connect(investor1).claimFinalTokens();
    console.log("  Investor 1 claimed final tokens (Step 2).");
    bal = await saleToken.balanceOf(investor1.address);
    await assert(bal == expectedSaleTokens, `Final sale token balance mismatch after claim 2. Got ${formatUnits(bal)}`);
    console.log("✅ Scenario 3 Passed");
  } catch (error) {
    console.error("❌ Scenario 3 Failed:", error.message);
  }

}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});