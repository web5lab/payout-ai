import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("Emergency Unlock Tests", function () {
    // Constants for test configuration
    const MIN_INVESTMENT = ethers.parseUnits("100", 18); // $100
    const MAX_INVESTMENT = ethers.parseUnits("5000", 18); // $5000
    const SOFT_CAP = ethers.parseUnits("10000", 18); // $10k
    const FUNDRAISING_CAP = ethers.parseUnits("100000", 18); // $100k
    const TOKEN_PRICE = ethers.parseUnits("0.5", 18); // $0.5 per token
    const PAYOUT_APR = 1200; // 12% APR in basis points
    const PAYOUT_PERIOD_DURATION = 30 * 24 * 60 * 60; // 30 days

    async function deployEmergencyFixture() {
        const [
            deployer,
            admin,
            tokenOwner,
            treasuryOwner,
            investor1,
            investor2,
            investor3,
            payoutAdmin
        ] = await ethers.getSigners();

        console.log("🏗️ Deploying emergency unlock test ecosystem...");

        // Deploy mock tokens
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const saleToken = await MockERC20.deploy("Sale Token", "SALE");
        const paymentToken = await MockERC20.deploy("Payment Token", "PAY");
        const payoutToken = await MockERC20.deploy("Payout Token", "PAYOUT");

        // Deploy mock oracle
        const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
        const paymentOracle = await MockV3Aggregator.deploy(
            ethers.parseUnits("1.0", 18), // 1 PAY = 1 USD
            true
        );

        // Deploy core infrastructure
        const WrappedTokenFactory = await ethers.getContractFactory("WrappedTokenFactory");
        const wrappedTokenFactory = await WrappedTokenFactory.deploy();

        const OfferingFactory = await ethers.getContractFactory("OfferingFactory");
        const offeringFactory = await OfferingFactory.deploy(await wrappedTokenFactory.getAddress());

        const InvestmentManager = await ethers.getContractFactory("InvestmentManager");
        const investmentManager = await InvestmentManager.deploy();

        const Escrow = await ethers.getContractFactory("Escrow");
        const escrow = await Escrow.deploy({ owner: treasuryOwner.address });

        // Set up connections
        await escrow.connect(treasuryOwner).setInvestmentManager(await investmentManager.getAddress());
        await investmentManager.connect(deployer).setEscrowContract(await escrow.getAddress());

        // Mint initial tokens
        await saleToken.connect(deployer).mint(tokenOwner.address, ethers.parseUnits("10000000"));
        await paymentToken.connect(deployer).mint(investor1.address, ethers.parseUnits("50000"));
        await paymentToken.connect(deployer).mint(investor2.address, ethers.parseUnits("50000"));
        await paymentToken.connect(deployer).mint(investor3.address, ethers.parseUnits("50000"));
        await payoutToken.connect(deployer).mint(payoutAdmin.address, ethers.parseUnits("100000"));

        console.log("✅ Emergency unlock test ecosystem deployed successfully");

        return {
            deployer,
            admin,
            tokenOwner,
            treasuryOwner,
            investor1,
            investor2,
            investor3,
            payoutAdmin,
            saleToken,
            paymentToken,
            payoutToken,
            paymentOracle,
            wrappedTokenFactory,
            offeringFactory,
            investmentManager,
            escrow
        };
    }

    async function createOfferingConfig(fixture) {
        const { saleToken, payoutToken, tokenOwner, escrow, investmentManager } = fixture;
        
        const now = await time.latest();
        const startDate = now + 300; // 5 minutes from now
        const endDate = startDate + 3600; // 1 hour sale duration
        const maturityDate = endDate + 7200; // 2 hours after sale ends

        return {
            saleToken: await saleToken.getAddress(),
            minInvestment: MIN_INVESTMENT,
            maxInvestment: MAX_INVESTMENT,
            startDate: startDate,
            endDate: endDate,
            apyEnabled: true, // Always APY enabled for emergency unlock tests
            softCap: SOFT_CAP,
            fundraisingCap: FUNDRAISING_CAP,
            tokenPrice: TOKEN_PRICE,
            tokenOwner: tokenOwner.address,
            escrowAddress: await escrow.getAddress(),
            investmentManager: await investmentManager.getAddress(),
            payoutTokenAddress: await payoutToken.getAddress(),
            payoutRate: PAYOUT_APR,
            payoutPeriodDuration: PAYOUT_PERIOD_DURATION,
            maturityDate: maturityDate
        };
    }

    async function setupAPYOfferingWithInvestment(investmentAmount = ethers.parseUnits("1000")) {
        const fixture = await loadFixture(deployEmergencyFixture);
        const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, payoutAdmin, investmentManager, investor1, escrow, treasuryOwner } = fixture;
        
        const config = await createOfferingConfig(fixture);
        
        const tx = await offeringFactory.connect(deployer).createOfferingWithPaymentTokens(
            config,
            [await paymentToken.getAddress()],
            [await paymentOracle.getAddress()]
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find(log => 
            log.fragment && log.fragment.name === 'OfferingDeployed'
        );

        const offeringAddress = event.args.offeringAddress;
        const offering = await ethers.getContractAt("Offering", offeringAddress);
        const wrappedTokenAddress = await offering.wrappedTokenAddress();
        const wrappedToken = await ethers.getContractAt("WRAPPEDTOKEN", wrappedTokenAddress);

        // Transfer sale tokens to offering
        const totalTokensForSale = ethers.parseUnits("200000");
        await saleToken.connect(tokenOwner).transfer(offeringAddress, totalTokensForSale);

        // Grant payout admin role
        const PAYOUT_ADMIN_ROLE = await wrappedToken.PAYOUT_ADMIN_ROLE();
        await wrappedToken.connect(deployer).grantRole(PAYOUT_ADMIN_ROLE, payoutAdmin.address);

        // Make investment
        await time.increaseTo(config.startDate + 10);
        await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
        await investmentManager.connect(investor1).routeInvestment(
            await offering.getAddress(),
            await paymentToken.getAddress(),
            investmentAmount
        );

        // Finalize and claim tokens
        await time.increaseTo(config.endDate + 10);
        await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
        await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());

        return { ...fixture, offering, wrappedToken, config };
    }

    describe("1. Emergency Unlock Setup", function () {
        it("Should allow admin to enable emergency unlock", async function () {
            const { wrappedToken, deployer } = await setupAPYOfferingWithInvestment();

            const penaltyPercentage = 1500; // 15%

            await expect(
                wrappedToken.connect(deployer).enableEmergencyUnlock(penaltyPercentage)
            ).to.emit(wrappedToken, "EmergencyUnlockEnabled")
            .withArgs(penaltyPercentage);

            expect(await wrappedToken.emergencyUnlockEnabled()).to.be.true;
            expect(await wrappedToken.emergencyUnlockPenalty()).to.equal(penaltyPercentage);
        });

        it("Should allow admin to disable emergency unlock", async function () {
            const { wrappedToken, deployer } = await setupAPYOfferingWithInvestment();

            // Enable first
            await wrappedToken.connect(deployer).enableEmergencyUnlock(1000);
            expect(await wrappedToken.emergencyUnlockEnabled()).to.be.true;

            // Then disable
            await expect(
                wrappedToken.connect(deployer).disableEmergencyUnlock()
            ).to.emit(wrappedToken, "EmergencyUnlockDisabled");

            expect(await wrappedToken.emergencyUnlockEnabled()).to.be.false;
            expect(await wrappedToken.emergencyUnlockPenalty()).to.equal(0);
        });

        it("Should reject invalid penalty percentages", async function () {
            const { wrappedToken, deployer } = await setupAPYOfferingWithInvestment();

            // Test penalty above maximum (50%)
            await expect(
                wrappedToken.connect(deployer).enableEmergencyUnlock(5001) // 50.01%
            ).to.be.revertedWithCustomError(wrappedToken, "InvalidPenalty");

            // Test valid maximum penalty
            await expect(
                wrappedToken.connect(deployer).enableEmergencyUnlock(5000) // 50%
            ).to.not.be.reverted;
        });

        it("Should only allow admin to enable/disable emergency unlock", async function () {
            const { wrappedToken, investor1 } = await setupAPYOfferingWithInvestment();

            await expect(
                wrappedToken.connect(investor1).enableEmergencyUnlock(1000)
            ).to.be.revertedWithCustomError(wrappedToken, "AccessControlUnauthorizedAccount");

            await expect(
                wrappedToken.connect(investor1).disableEmergencyUnlock()
            ).to.be.revertedWithCustomError(wrappedToken, "AccessControlUnauthorizedAccount");
        });
    });

    describe("2. Basic Emergency Unlock Flow", function () {
        it("Should allow investor to use emergency unlock", async function () {
            const { wrappedToken, investor1, saleToken, deployer } = await setupAPYOfferingWithInvestment(ethers.parseUnits("800"));

            // Enable emergency unlock with 10% penalty
            await wrappedToken.connect(deployer).enableEmergencyUnlock(1000);

            const initialSaleBalance = await saleToken.balanceOf(investor1.address);
            const wrappedBalance = await wrappedToken.balanceOf(investor1.address);
            
            expect(wrappedBalance).to.equal(ethers.parseUnits("1600")); // 800 USD / 0.5 = 1600 tokens

            await expect(
                wrappedToken.connect(investor1).emergencyUnlock()
            ).to.emit(wrappedToken, "EmergencyUnlockUsed");

            const finalSaleBalance = await saleToken.balanceOf(investor1.address);
            const tokensReceived = finalSaleBalance - initialSaleBalance;
            
            // Should receive 90% of deposited tokens (10% penalty)
            const expectedTokens = (ethers.parseUnits("1600") * 90n) / 100n;
            expect(tokensReceived).to.equal(expectedTokens);

            // Wrapped tokens should be burned
            expect(await wrappedToken.balanceOf(investor1.address)).to.equal(0);
        });

        it("Should update contract state correctly after emergency unlock", async function () {
            const { wrappedToken, investor1, deployer } = await setupAPYOfferingWithInvestment(ethers.parseUnits("600"));

            const initialTotalEscrowed = await wrappedToken.totalEscrowed();
            const initialTotalUSDT = await wrappedToken.totalUSDTInvested();
            const initialTotalSupply = await wrappedToken.totalSupply();

            await wrappedToken.connect(deployer).enableEmergencyUnlock(1500); // 15% penalty
            await wrappedToken.connect(investor1).emergencyUnlock();

            // Check state updates
            expect(await wrappedToken.totalEscrowed()).to.equal(initialTotalEscrowed - ethers.parseUnits("1200"));
            expect(await wrappedToken.totalUSDTInvested()).to.equal(initialTotalUSDT - ethers.parseUnits("600"));
            expect(await wrappedToken.totalSupply()).to.equal(initialTotalSupply - ethers.parseUnits("1200"));

            // Check investor state
            const investor = await wrappedToken.investors(investor1.address);
            expect(investor.deposited).to.equal(0);
            expect(investor.usdtValue).to.equal(0);
            expect(investor.emergencyUnlocked).to.be.true;
        });

        it("Should prevent emergency unlock when disabled", async function () {
            const { wrappedToken, investor1 } = await setupAPYOfferingWithInvestment();

            // Emergency unlock is disabled by default
            await expect(
                wrappedToken.connect(investor1).emergencyUnlock()
            ).to.be.revertedWithCustomError(wrappedToken, "UnlockDisabled");
        });

        it("Should prevent emergency unlock for users with no deposit", async function () {
            const { wrappedToken, investor2, deployer } = await setupAPYOfferingWithInvestment();

            await wrappedToken.connect(deployer).enableEmergencyUnlock(1000);

            // investor2 has no deposit
            await expect(
                wrappedToken.connect(investor2).emergencyUnlock()
            ).to.be.revertedWithCustomError(wrappedToken, "NoDeposit");
        });

        it("Should prevent double emergency unlock", async function () {
            const { wrappedToken, investor1, deployer } = await setupAPYOfferingWithInvestment();

            await wrappedToken.connect(deployer).enableEmergencyUnlock(1000);

            // First unlock should succeed
            await wrappedToken.connect(investor1).emergencyUnlock();

            // Second unlock should fail
            await expect(
                wrappedToken.connect(investor1).emergencyUnlock()
            ).to.be.revertedWithCustomError(wrappedToken, "AlreadyClaimed");
        });
    });

    describe("3. Emergency Unlock with Different Penalties", function () {
        it("Should apply 5% penalty correctly", async function () {
            const { wrappedToken, investor1, saleToken, deployer } = await setupAPYOfferingWithInvestment(ethers.parseUnits("1000"));

            await wrappedToken.connect(deployer).enableEmergencyUnlock(500); // 5% penalty

            const initialBalance = await saleToken.balanceOf(investor1.address);
            await wrappedToken.connect(investor1).emergencyUnlock();
            const finalBalance = await saleToken.balanceOf(investor1.address);

            const tokensReceived = finalBalance - initialBalance;
            const expectedTokens = (ethers.parseUnits("2000") * 95n) / 100n; // 95% of 2000 tokens
            
            expect(tokensReceived).to.equal(expectedTokens);
        });

        it("Should apply 25% penalty correctly", async function () {
            const { wrappedToken, investor1, saleToken, deployer } = await setupAPYOfferingWithInvestment(ethers.parseUnits("400"));

            await wrappedToken.connect(deployer).enableEmergencyUnlock(2500); // 25% penalty

            const initialBalance = await saleToken.balanceOf(investor1.address);
            await wrappedToken.connect(investor1).emergencyUnlock();
            const finalBalance = await saleToken.balanceOf(investor1.address);

            const tokensReceived = finalBalance - initialBalance;
            const expectedTokens = (ethers.parseUnits("800") * 75n) / 100n; // 75% of 800 tokens
            
            expect(tokensReceived).to.equal(expectedTokens);
        });

        it("Should apply maximum 50% penalty correctly", async function () {
            const { wrappedToken, investor1, saleToken, deployer } = await setupAPYOfferingWithInvestment(ethers.parseUnits("200"));

            await wrappedToken.connect(deployer).enableEmergencyUnlock(5000); // 50% penalty

            const initialBalance = await saleToken.balanceOf(investor1.address);
            await wrappedToken.connect(investor1).emergencyUnlock();
            const finalBalance = await saleToken.balanceOf(investor1.address);

            const tokensReceived = finalBalance - initialBalance;
            const expectedTokens = (ethers.parseUnits("400") * 50n) / 100n; // 50% of 400 tokens
            
            expect(tokensReceived).to.equal(expectedTokens);
        });

        it("Should handle zero penalty (emergency unlock without penalty)", async function () {
            const { wrappedToken, investor1, saleToken, deployer } = await setupAPYOfferingWithInvestment(ethers.parseUnits("300"));

            await wrappedToken.connect(deployer).enableEmergencyUnlock(0); // 0% penalty

            const initialBalance = await saleToken.balanceOf(investor1.address);
            await wrappedToken.connect(investor1).emergencyUnlock();
            const finalBalance = await saleToken.balanceOf(investor1.address);

            const tokensReceived = finalBalance - initialBalance;
            expect(tokensReceived).to.equal(ethers.parseUnits("600")); // Full amount, no penalty
        });
    });

    describe("4. Emergency Unlock with Payout History", function () {
        it("Should allow emergency unlock after claiming payouts", async function () {
            const { wrappedToken, investor1, saleToken, payoutToken, payoutAdmin, deployer } = await setupAPYOfferingWithInvestment(ethers.parseUnits("500"));

            // Distribute and claim payout first
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);

            const payoutAmount = ethers.parseUnits("50");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payoutAmount);
            await wrappedToken.connect(investor1).claimAvailablePayouts();

            // Check payout was claimed
            const payoutBalance = await payoutToken.balanceOf(investor1.address);
            expect(payoutBalance).to.equal(payoutAmount);

            // Enable emergency unlock and use it
            await wrappedToken.connect(deployer).enableEmergencyUnlock(1000); // 10% penalty

            const initialSaleBalance = await saleToken.balanceOf(investor1.address);
            await wrappedToken.connect(investor1).emergencyUnlock();
            const finalSaleBalance = await saleToken.balanceOf(investor1.address);

            const tokensReceived = finalSaleBalance - initialSaleBalance;
            const expectedTokens = (ethers.parseUnits("1000") * 90n) / 100n; // 90% of 1000 tokens
            
            expect(tokensReceived).to.equal(expectedTokens);
        });

        it("Should prevent payout claims after emergency unlock", async function () {
            const { wrappedToken, investor1, payoutToken, payoutAdmin, deployer } = await setupAPYOfferingWithInvestment(ethers.parseUnits("600"));

            // Enable emergency unlock and use it
            await wrappedToken.connect(deployer).enableEmergencyUnlock(1500); // 15% penalty
            await wrappedToken.connect(investor1).emergencyUnlock();

            // Try to distribute payout after emergency unlock
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);

            const payoutAmount = ethers.parseUnits("60");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payoutAmount);

            // Try to claim payout after emergency unlock
            await expect(
                wrappedToken.connect(investor1).claimAvailablePayouts()
            ).to.be.revertedWithCustomError(wrappedToken, "AlreadyClaimed");
        });

        it("Should handle multiple payouts before emergency unlock", async function () {
            const { wrappedToken, investor1, saleToken, payoutToken, payoutAdmin, deployer } = await setupAPYOfferingWithInvestment(ethers.parseUnits("800"));

            // Distribute multiple payouts
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);

            const payout1 = ethers.parseUnits("40");
            const payout2 = ethers.parseUnits("60");

            // First payout
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout1);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout1);

            // Second payout
            await time.increase(PAYOUT_PERIOD_DURATION + 10);
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout2);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout2);

            // Claim all payouts
            await wrappedToken.connect(investor1).claimAvailablePayouts();

            const totalPayoutsClaimed = await payoutToken.balanceOf(investor1.address);
            expect(totalPayoutsClaimed).to.equal(payout1 + payout2);

            // Use emergency unlock
            await wrappedToken.connect(deployer).enableEmergencyUnlock(2000); // 20% penalty

            const initialSaleBalance = await saleToken.balanceOf(investor1.address);
            await wrappedToken.connect(investor1).emergencyUnlock();
            const finalSaleBalance = await saleToken.balanceOf(investor1.address);

            const tokensReceived = finalSaleBalance - initialSaleBalance;
            const expectedTokens = (ethers.parseUnits("1600") * 80n) / 100n; // 80% of 1600 tokens
            
            expect(tokensReceived).to.equal(expectedTokens);
        });
    });

    describe("5. Multiple Investors Emergency Unlock", function () {
        it("Should handle emergency unlock from multiple investors", async function () {
            const fixture = await loadFixture(deployEmergencyFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, payoutAdmin, investmentManager, investor1, investor2, investor3, escrow, treasuryOwner } = fixture;
            
            const config = await createOfferingConfig(fixture);
            
            const tx = await offeringFactory.connect(deployer).createOfferingWithPaymentTokens(
                config,
                [await paymentToken.getAddress()],
                [await paymentOracle.getAddress()]
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => 
                log.fragment && log.fragment.name === 'OfferingDeployed'
            );

            const offeringAddress = event.args.offeringAddress;
            const offering = await ethers.getContractAt("Offering", offeringAddress);
            const wrappedTokenAddress = await offering.wrappedTokenAddress();
            const wrappedToken = await ethers.getContractAt("WRAPPEDTOKEN", wrappedTokenAddress);

            await saleToken.connect(tokenOwner).transfer(offeringAddress, ethers.parseUnits("200000"));

            const PAYOUT_ADMIN_ROLE = await wrappedToken.PAYOUT_ADMIN_ROLE();
            await wrappedToken.connect(deployer).grantRole(PAYOUT_ADMIN_ROLE, payoutAdmin.address);

            // Multiple investments
            await time.increaseTo(config.startDate + 10);

            const investment1 = ethers.parseUnits("600");
            const investment2 = ethers.parseUnits("400");
            const investment3 = ethers.parseUnits("300");

            await paymentToken.connect(investor1).approve(await offering.getAddress(), investment1);
            await paymentToken.connect(investor2).approve(await offering.getAddress(), investment2);
            await paymentToken.connect(investor3).approve(await offering.getAddress(), investment3);

            await investmentManager.connect(investor1).routeInvestment(await offering.getAddress(), await paymentToken.getAddress(), investment1);
            await investmentManager.connect(investor2).routeInvestment(await offering.getAddress(), await paymentToken.getAddress(), investment2);
            await investmentManager.connect(investor3).routeInvestment(await offering.getAddress(), await paymentToken.getAddress(), investment3);

            // Finalize and claim tokens
            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());
            await investmentManager.connect(investor2).claimInvestmentTokens(await offering.getAddress());
            await investmentManager.connect(investor3).claimInvestmentTokens(await offering.getAddress());

            // Enable emergency unlock
            await wrappedToken.connect(deployer).enableEmergencyUnlock(1000); // 10% penalty

            const initialTotalSupply = await wrappedToken.totalSupply();
            const initialTotalEscrowed = await wrappedToken.totalEscrowed();

            // Investor 1 uses emergency unlock
            await wrappedToken.connect(investor1).emergencyUnlock();

            // Check state after first unlock
            const afterFirstUnlock = await wrappedToken.totalSupply();
            expect(afterFirstUnlock).to.equal(initialTotalSupply - ethers.parseUnits("1200")); // 600 USD / 0.5 = 1200 tokens

            // Investor 3 uses emergency unlock
            await wrappedToken.connect(investor3).emergencyUnlock();

            // Check final state
            const finalTotalSupply = await wrappedToken.totalSupply();
            expect(finalTotalSupply).to.equal(initialTotalSupply - ethers.parseUnits("1200") - ethers.parseUnits("600")); // 1200 + 600 tokens

            // Investor 2 should still be able to claim payouts
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);

            const payoutAmount = ethers.parseUnits("100");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payoutAmount);

            // Only investor2 should get the full payout now
            const payoutInfo = await wrappedToken.getUserPayoutInfo(investor2.address);
            expect(payoutInfo.totalClaimable).to.equal(payoutAmount); // Gets all since others unlocked
        });

        it("Should adjust payout distribution after some investors unlock", async function () {
            const fixture = await loadFixture(deployEmergencyFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, payoutAdmin, investmentManager, investor1, investor2, escrow, treasuryOwner } = fixture;
            
            const config = await createOfferingConfig(fixture);
            
            const tx = await offeringFactory.connect(deployer).createOfferingWithPaymentTokens(
                config,
                [await paymentToken.getAddress()],
                [await paymentOracle.getAddress()]
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => 
                log.fragment && log.fragment.name === 'OfferingDeployed'
            );

            const offeringAddress = event.args.offeringAddress;
            const offering = await ethers.getContractAt("Offering", offeringAddress);
            const wrappedTokenAddress = await offering.wrappedTokenAddress();
            const wrappedToken = await ethers.getContractAt("WRAPPEDTOKEN", wrappedTokenAddress);

            await saleToken.connect(tokenOwner).transfer(offeringAddress, ethers.parseUnits("200000"));

            const PAYOUT_ADMIN_ROLE = await wrappedToken.PAYOUT_ADMIN_ROLE();
            await wrappedToken.connect(deployer).grantRole(PAYOUT_ADMIN_ROLE, payoutAdmin.address);

            // Two equal investments
            await time.increaseTo(config.startDate + 10);

            const investment = ethers.parseUnits("500"); // Each invests $500

            await paymentToken.connect(investor1).approve(await offering.getAddress(), investment);
            await paymentToken.connect(investor2).approve(await offering.getAddress(), investment);

            await investmentManager.connect(investor1).routeInvestment(await offering.getAddress(), await paymentToken.getAddress(), investment);
            await investmentManager.connect(investor2).routeInvestment(await offering.getAddress(), await paymentToken.getAddress(), investment);

            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());
            await investmentManager.connect(investor2).claimInvestmentTokens(await offering.getAddress());

            // First payout - both should get 50% each
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);

            const payout1 = ethers.parseUnits("100");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout1);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout1);

            let payoutInfo1 = await wrappedToken.getUserPayoutInfo(investor1.address);
            let payoutInfo2 = await wrappedToken.getUserPayoutInfo(investor2.address);

            expect(payoutInfo1.totalClaimable).to.equal(ethers.parseUnits("50")); // 50%
            expect(payoutInfo2.totalClaimable).to.equal(ethers.parseUnits("50")); // 50%

            // Both claim first payout
            await wrappedToken.connect(investor1).claimAvailablePayouts();
            await wrappedToken.connect(investor2).claimAvailablePayouts();

            // Investor 1 uses emergency unlock
            await wrappedToken.connect(deployer).enableEmergencyUnlock(1000);
            await wrappedToken.connect(investor1).emergencyUnlock();

            // Second payout - only investor2 should get it all
            await time.increase(PAYOUT_PERIOD_DURATION + 10);
            const payout2 = ethers.parseUnits("80");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout2);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout2);

            payoutInfo2 = await wrappedToken.getUserPayoutInfo(investor2.address);
            expect(payoutInfo2.totalClaimable).to.equal(payout2); // Gets all of second payout
        });
    });

    describe("6. Emergency Unlock Edge Cases", function () {
        it("Should handle emergency unlock when contract is paused", async function () {
            const { wrappedToken, investor1, deployer } = await setupAPYOfferingWithInvestment();

            await wrappedToken.connect(deployer).enableEmergencyUnlock(1000);
            
            // Pause contract
            await wrappedToken.connect(deployer).pause();

            // Emergency unlock should fail when paused
            await expect(
                wrappedToken.connect(investor1).emergencyUnlock()
            ).to.be.revertedWithCustomError(wrappedToken, "EnforcedPause");

            // Unpause and try again
            await wrappedToken.connect(deployer).unpause();
            
            await expect(
                wrappedToken.connect(investor1).emergencyUnlock()
            ).to.emit(wrappedToken, "EmergencyUnlockUsed");
        });

        it("Should prevent emergency unlock after final token claim", async function () {
            const { wrappedToken, investor1, config, deployer } = await setupAPYOfferingWithInvestment();

            // Fast forward to maturity and claim final tokens
            await time.increaseTo(config.maturityDate + 10);
            await wrappedToken.connect(investor1).claimFinalTokens();

            // Enable emergency unlock
            await wrappedToken.connect(deployer).enableEmergencyUnlock(1000);

            // Should not be able to use emergency unlock after final claim
            await expect(
                wrappedToken.connect(investor1).emergencyUnlock()
            ).to.be.revertedWithCustomError(wrappedToken, "AlreadyClaimed");
        });

        it("Should handle emergency unlock with very small amounts", async function () {
            const { wrappedToken, investor1, saleToken, deployer } = await setupAPYOfferingWithInvestment(ethers.parseUnits("1")); // $1 investment

            await wrappedToken.connect(deployer).enableEmergencyUnlock(1000); // 10% penalty

            const initialBalance = await saleToken.balanceOf(investor1.address);
            await wrappedToken.connect(investor1).emergencyUnlock();
            const finalBalance = await saleToken.balanceOf(investor1.address);

            const tokensReceived = finalBalance - initialBalance;
            const expectedTokens = (ethers.parseUnits("2") * 90n) / 100n; // 90% of 2 tokens
            
            expect(tokensReceived).to.equal(expectedTokens);
        });

        it("Should handle penalty calculation edge cases", async function () {
            const { wrappedToken, investor1, saleToken, deployer } = await setupAPYOfferingWithInvestment(ethers.parseUnits("333")); // Odd number

            await wrappedToken.connect(deployer).enableEmergencyUnlock(3333); // 33.33% penalty

            const initialBalance = await saleToken.balanceOf(investor1.address);
            await wrappedToken.connect(investor1).emergencyUnlock();
            const finalBalance = await saleToken.balanceOf(investor1.address);

            const tokensReceived = finalBalance - initialBalance;
            const depositedTokens = ethers.parseUnits("666"); // 333 USD / 0.5 = 666 tokens
            const expectedTokens = (depositedTokens * (10000n - 3333n)) / 10000n; // 66.67% of deposited
            
            expect(tokensReceived).to.equal(expectedTokens);
        });

        it("Should emit correct event data on emergency unlock", async function () {
            const { wrappedToken, investor1, deployer } = await setupAPYOfferingWithInvestment(ethers.parseUnits("750"));

            const penaltyPercentage = 1250; // 12.5%
            await wrappedToken.connect(deployer).enableEmergencyUnlock(penaltyPercentage);

            const depositedTokens = ethers.parseUnits("1500"); // 750 USD / 0.5 = 1500 tokens
            const penaltyAmount = (depositedTokens * BigInt(penaltyPercentage)) / 10000n;
            const amountToReturn = depositedTokens - penaltyAmount;

            await expect(
                wrappedToken.connect(investor1).emergencyUnlock()
            ).to.emit(wrappedToken, "EmergencyUnlockUsed")
            .withArgs(investor1.address, amountToReturn, penaltyAmount);
        });
    });

    describe("7. Contract Information and State", function () {
        it("Should return correct contract information including emergency unlock status", async function () {
            const { wrappedToken, deployer } = await setupAPYOfferingWithInvestment();

            // Check initial state
            let contractInfo = await wrappedToken.getContractInfo();
            expect(contractInfo.emergencyUnlockStatus).to.be.false;
            expect(contractInfo.emergencyPenalty).to.equal(0);

            // Enable emergency unlock
            const penaltyPercentage = 2000; // 20%
            await wrappedToken.connect(deployer).enableEmergencyUnlock(penaltyPercentage);

            // Check updated state
            contractInfo = await wrappedToken.getContractInfo();
            expect(contractInfo.emergencyUnlockStatus).to.be.true;
            expect(contractInfo.emergencyPenalty).to.equal(penaltyPercentage);
        });

        it("Should track emergency unlock usage in investor data", async function () {
            const { wrappedToken, investor1, deployer } = await setupAPYOfferingWithInvestment();

            // Check initial investor state
            let investor = await wrappedToken.investors(investor1.address);
            expect(investor.emergencyUnlocked).to.be.false;

            // Use emergency unlock
            await wrappedToken.connect(deployer).enableEmergencyUnlock(1500);
            await wrappedToken.connect(investor1).emergencyUnlock();

            // Check updated investor state
            investor = await wrappedToken.investors(investor1.address);
            expect(investor.emergencyUnlocked).to.be.true;
            expect(investor.deposited).to.equal(0); // Should be cleared
            expect(investor.usdtValue).to.equal(0); // Should be cleared
        });
    });
});