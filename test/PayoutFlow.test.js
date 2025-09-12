import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("Payout Flow Tests", function () {
    // Constants for test configuration
    const MIN_INVESTMENT = ethers.parseUnits("100", 18); // $100
    const MAX_INVESTMENT = ethers.parseUnits("5000", 18); // $5000
    const SOFT_CAP = ethers.parseUnits("10000", 18); // $10k
    const FUNDRAISING_CAP = ethers.parseUnits("100000", 18); // $100k
    const TOKEN_PRICE = ethers.parseUnits("0.5", 18); // $0.5 per token
    const PAYOUT_APR = 1200; // 12% APR in basis points
    const PAYOUT_PERIOD_DURATION = 30 * 24 * 60 * 60; // 30 days

    async function deployPayoutFixture() {
        const [
            deployer,
            admin,
            tokenOwner,
            treasuryOwner,
            investor1,
            investor2,
            investor3,
            payoutAdmin,
            kybValidator
        ] = await ethers.getSigners();

        console.log("🏗️ Deploying payout test ecosystem...");

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

        console.log("✅ Payout test ecosystem deployed successfully");

        return {
            deployer,
            admin,
            tokenOwner,
            treasuryOwner,
            investor1,
            investor2,
            investor3,
            payoutAdmin,
            kybValidator,
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
            apyEnabled: true, // Always APY enabled for payout tests
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

    async function setupAPYOffering() {
        const fixture = await loadFixture(deployPayoutFixture);
        const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, payoutAdmin } = fixture;
        
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

        return { ...fixture, offering, wrappedToken, config };
    }

    describe("1. Payout Distribution Setup", function () {
        it("Should calculate required payout tokens correctly", async function () {
            const { wrappedToken, offering, config, investmentManager, investor1, paymentToken, escrow, treasuryOwner } = await setupAPYOffering();

            await time.increaseTo(config.startDate + 10);

            // Make investment
            const investmentAmount = ethers.parseUnits("1000"); // $1000
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

            // Calculate required payout
            const [requiredAmount, periodAPR] = await wrappedToken.calculateRequiredPayoutTokens();
            
            // Expected calculation: ($1000 * 12% * 30 days) / 365 days / 10000 basis points
            const expectedPeriodAPR = (PAYOUT_APR * PAYOUT_PERIOD_DURATION) / (365 * 24 * 60 * 60);
            const expectedAmount = (ethers.parseUnits("1000") * BigInt(expectedPeriodAPR)) / 10000n;

            expect(periodAPR).to.be.closeTo(expectedPeriodAPR, 1);
            expect(requiredAmount).to.be.closeTo(expectedAmount, ethers.parseUnits("1"));
        });

        it("Should return zero for no investments", async function () {
            const { wrappedToken } = await setupAPYOffering();

            const [requiredAmount, periodAPR] = await wrappedToken.calculateRequiredPayoutTokens();
            expect(requiredAmount).to.equal(0);
            expect(periodAPR).to.be.greaterThan(0); // APR calculation should still work
        });

        it("Should get expected payout for specific user", async function () {
            const { wrappedToken, offering, config, investmentManager, investor1, paymentToken, escrow, treasuryOwner } = await setupAPYOffering();

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("500"); // $500
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());

            const expectedPayout = await wrappedToken.getExpectedPayoutForUser(investor1.address);
            
            // Should be proportional to investment
            const periodAPR = (PAYOUT_APR * PAYOUT_PERIOD_DURATION) / (365 * 24 * 60 * 60);
            const expectedAmount = (ethers.parseUnits("500") * BigInt(periodAPR)) / 10000n;
            
            expect(expectedPayout).to.be.closeTo(expectedAmount, ethers.parseUnits("0.1"));
        });
    });

    describe("2. Single Payout Distribution", function () {
        it("Should distribute payout for single investor", async function () {
            const { wrappedToken, offering, config, investmentManager, investor1, paymentToken, payoutToken, payoutAdmin, escrow, treasuryOwner } = await setupAPYOffering();

            await time.increaseTo(config.startDate + 10);

            // Investment
            const investmentAmount = ethers.parseUnits("800"); // $800
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

            // Fast forward to first payout date
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);

            // Distribute payout
            const payoutAmount = ethers.parseUnits("100");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount);
            
            await expect(
                wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payoutAmount)
            ).to.emit(wrappedToken, "PayoutDistributed");

            expect(await wrappedToken.currentPayoutPeriod()).to.equal(1);
            expect(await wrappedToken.payoutFundsPerPeriod(1)).to.equal(payoutAmount);
        });

        it("Should allow investor to claim distributed payout", async function () {
            const { wrappedToken, offering, config, investmentManager, investor1, paymentToken, payoutToken, payoutAdmin, escrow, treasuryOwner } = await setupAPYOffering();

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("600");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());

            // Distribute payout
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);

            const payoutAmount = ethers.parseUnits("80");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payoutAmount);

            // Claim payout
            const initialBalance = await payoutToken.balanceOf(investor1.address);
            
            await expect(
                wrappedToken.connect(investor1).claimAvailablePayouts()
            ).to.emit(wrappedToken, "PayoutClaimed");

            const finalBalance = await payoutToken.balanceOf(investor1.address);
            expect(finalBalance - initialBalance).to.equal(payoutAmount);
        });

        it("Should prevent payout distribution before payout time", async function () {
            const { wrappedToken, offering, config, investmentManager, investor1, paymentToken, payoutToken, payoutAdmin, escrow, treasuryOwner } = await setupAPYOffering();

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("500");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());

            // Try to distribute before first payout date
            const payoutAmount = ethers.parseUnits("50");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount);
            
            await expect(
                wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payoutAmount)
            ).to.be.revertedWithCustomError(wrappedToken, "PayoutNotAvailable");
        });
    });

    describe("3. Multiple Investors Proportional Payouts", function () {
        it("Should distribute payouts proportionally to multiple investors", async function () {
            const { wrappedToken, offering, config, investmentManager, investor1, investor2, investor3, paymentToken, payoutToken, payoutAdmin, escrow, treasuryOwner } = await setupAPYOffering();

            await time.increaseTo(config.startDate + 10);

            // Multiple investments with different amounts
            const investment1 = ethers.parseUnits("600"); // $600 - 60%
            const investment2 = ethers.parseUnits("300"); // $300 - 30%
            const investment3 = ethers.parseUnits("100"); // $100 - 10%

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

            // Distribute payout
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);

            const totalPayoutAmount = ethers.parseUnits("100");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), totalPayoutAmount);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(totalPayoutAmount);

            // Check payout info for each investor
            const payoutInfo1 = await wrappedToken.getUserPayoutInfo(investor1.address);
            const payoutInfo2 = await wrappedToken.getUserPayoutInfo(investor2.address);
            const payoutInfo3 = await wrappedToken.getUserPayoutInfo(investor3.address);

            // Should be proportional: 60%, 30%, 10%
            const expectedPayout1 = (totalPayoutAmount * 60n) / 100n;
            const expectedPayout2 = (totalPayoutAmount * 30n) / 100n;
            const expectedPayout3 = (totalPayoutAmount * 10n) / 100n;

            expect(payoutInfo1.totalClaimable).to.equal(expectedPayout1);
            expect(payoutInfo2.totalClaimable).to.equal(expectedPayout2);
            expect(payoutInfo3.totalClaimable).to.equal(expectedPayout3);
        });

        it("Should allow all investors to claim their proportional shares", async function () {
            const { wrappedToken, offering, config, investmentManager, investor1, investor2, paymentToken, payoutToken, payoutAdmin, escrow, treasuryOwner } = await setupAPYOffering();

            await time.increaseTo(config.startDate + 10);

            // Two investors with different amounts
            const investment1 = ethers.parseUnits("800"); // 80%
            const investment2 = ethers.parseUnits("200"); // 20%

            await paymentToken.connect(investor1).approve(await offering.getAddress(), investment1);
            await paymentToken.connect(investor2).approve(await offering.getAddress(), investment2);

            await investmentManager.connect(investor1).routeInvestment(await offering.getAddress(), await paymentToken.getAddress(), investment1);
            await investmentManager.connect(investor2).routeInvestment(await offering.getAddress(), await paymentToken.getAddress(), investment2);

            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());
            await investmentManager.connect(investor2).claimInvestmentTokens(await offering.getAddress());

            // Distribute payout
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);

            const totalPayoutAmount = ethers.parseUnits("200");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), totalPayoutAmount);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(totalPayoutAmount);

            // Both investors claim
            const initialBalance1 = await payoutToken.balanceOf(investor1.address);
            const initialBalance2 = await payoutToken.balanceOf(investor2.address);

            await wrappedToken.connect(investor1).claimAvailablePayouts();
            await wrappedToken.connect(investor2).claimAvailablePayouts();

            const finalBalance1 = await payoutToken.balanceOf(investor1.address);
            const finalBalance2 = await payoutToken.balanceOf(investor2.address);

            const claimed1 = finalBalance1 - initialBalance1;
            const claimed2 = finalBalance2 - initialBalance2;

            // Should be 80% and 20% respectively
            expect(claimed1).to.equal((totalPayoutAmount * 80n) / 100n);
            expect(claimed2).to.equal((totalPayoutAmount * 20n) / 100n);
            expect(claimed1 + claimed2).to.equal(totalPayoutAmount);
        });
    });

    describe("4. Multiple Payout Rounds", function () {
        it("Should handle multiple payout distributions over time", async function () {
            const { wrappedToken, offering, config, investmentManager, investor1, paymentToken, payoutToken, payoutAdmin, escrow, treasuryOwner } = await setupAPYOffering();

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("1000");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());

            // First payout round
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);

            const payout1 = ethers.parseUnits("50");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout1);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout1);

            expect(await wrappedToken.currentPayoutPeriod()).to.equal(1);

            // Second payout round
            await time.increase(PAYOUT_PERIOD_DURATION + 10);
            const payout2 = ethers.parseUnits("75");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout2);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout2);

            expect(await wrappedToken.currentPayoutPeriod()).to.equal(2);

            // Third payout round
            await time.increase(PAYOUT_PERIOD_DURATION + 10);
            const payout3 = ethers.parseUnits("100");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout3);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout3);

            expect(await wrappedToken.currentPayoutPeriod()).to.equal(3);

            // User should be able to claim all accumulated payouts
            const payoutInfo = await wrappedToken.getUserPayoutInfo(investor1.address);
            expect(payoutInfo.totalClaimable).to.equal(payout1 + payout2 + payout3);
        });

        it("Should allow claiming payouts from multiple periods at once", async function () {
            const { wrappedToken, offering, config, investmentManager, investor1, paymentToken, payoutToken, payoutAdmin, escrow, treasuryOwner } = await setupAPYOffering();

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("500");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());

            // Distribute multiple payouts without claiming
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);

            const payout1 = ethers.parseUnits("30");
            const payout2 = ethers.parseUnits("40");
            const payout3 = ethers.parseUnits("50");

            // First payout
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout1);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout1);

            // Second payout
            await time.increase(PAYOUT_PERIOD_DURATION + 10);
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout2);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout2);

            // Third payout
            await time.increase(PAYOUT_PERIOD_DURATION + 10);
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout3);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout3);

            // Claim all at once
            const initialBalance = await payoutToken.balanceOf(investor1.address);
            await wrappedToken.connect(investor1).claimAvailablePayouts();
            const finalBalance = await payoutToken.balanceOf(investor1.address);

            const totalClaimed = finalBalance - initialBalance;
            expect(totalClaimed).to.equal(payout1 + payout2 + payout3);
        });

        it("Should handle partial claims across multiple periods", async function () {
            const { wrappedToken, offering, config, investmentManager, investor1, paymentToken, payoutToken, payoutAdmin, escrow, treasuryOwner } = await setupAPYOffering();

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("400");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());

            // First payout and claim
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);

            const payout1 = ethers.parseUnits("25");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout1);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout1);

            let initialBalance = await payoutToken.balanceOf(investor1.address);
            await wrappedToken.connect(investor1).claimAvailablePayouts();
            let finalBalance = await payoutToken.balanceOf(investor1.address);
            expect(finalBalance - initialBalance).to.equal(payout1);

            // Second payout and claim
            await time.increase(PAYOUT_PERIOD_DURATION + 10);
            const payout2 = ethers.parseUnits("35");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout2);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout2);

            initialBalance = await payoutToken.balanceOf(investor1.address);
            await wrappedToken.connect(investor1).claimAvailablePayouts();
            finalBalance = await payoutToken.balanceOf(investor1.address);
            expect(finalBalance - initialBalance).to.equal(payout2);

            // Check total claimed
            const payoutInfo = await wrappedToken.getUserPayoutInfo(investor1.address);
            expect(payoutInfo.totalClaimed).to.equal(payout1 + payout2);
        });
    });

    describe("5. Payout Information and Queries", function () {
        it("Should provide comprehensive user payout information", async function () {
            const { wrappedToken, offering, config, investmentManager, investor1, paymentToken, payoutToken, payoutAdmin, escrow, treasuryOwner } = await setupAPYOffering();

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("750");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());

            // Distribute and claim first payout
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);

            const payout1 = ethers.parseUnits("60");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout1);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout1);
            await wrappedToken.connect(investor1).claimAvailablePayouts();

            // Distribute second payout (not claimed yet)
            await time.increase(PAYOUT_PERIOD_DURATION + 10);
            const payout2 = ethers.parseUnits("80");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout2);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout2);

            // Get comprehensive payout info
            const payoutInfo = await wrappedToken.getUserPayoutInfo(investor1.address);

            expect(payoutInfo.totalClaimed).to.equal(payout1);
            expect(payoutInfo.totalClaimable).to.equal(payout2);
            expect(payoutInfo.lastClaimedPeriod).to.equal(1);
            expect(payoutInfo.userUSDTValue).to.equal(investmentAmount);
            expect(payoutInfo.claimablePeriods.length).to.equal(1);
            expect(payoutInfo.claimablePeriods[0]).to.equal(2);
            expect(payoutInfo.claimableAmounts[0]).to.equal(payout2);
        });

        it("Should return correct payout period information", async function () {
            const { wrappedToken, offering, config, investmentManager, investor1, paymentToken, payoutToken, payoutAdmin, escrow, treasuryOwner } = await setupAPYOffering();

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("300");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());

            // Check initial period info
            let periodInfo = await wrappedToken.getCurrentPayoutPeriodInfo();
            expect(periodInfo.period).to.equal(0);
            expect(periodInfo.canDistribute).to.be.false;

            // Fast forward to first payout date
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);

            periodInfo = await wrappedToken.getCurrentPayoutPeriodInfo();
            expect(periodInfo.canDistribute).to.be.true;
            expect(periodInfo.requiredTokens).to.be.greaterThan(0);
            expect(periodInfo.currentAPR).to.equal(PAYOUT_APR);

            // Distribute payout
            const payoutAmount = ethers.parseUnits("40");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payoutAmount);

            periodInfo = await wrappedToken.getCurrentPayoutPeriodInfo();
            expect(periodInfo.period).to.equal(1);
            expect(periodInfo.lastDistributionTime).to.be.greaterThan(0);
        });

        it("Should check payout period availability correctly", async function () {
            const { wrappedToken, offering, config, investmentManager, investor1, paymentToken, escrow, treasuryOwner } = await setupAPYOffering();

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("200");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());

            // Should not be available before first payout date
            expect(await wrappedToken.isPayoutPeriodAvailable()).to.be.false;

            // Should be available after first payout date
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);
            expect(await wrappedToken.isPayoutPeriodAvailable()).to.be.true;
        });
    });

    describe("6. Payout Access Control and Security", function () {
        it("Should only allow payout admin to distribute payouts", async function () {
            const { wrappedToken, offering, config, investmentManager, investor1, paymentToken, payoutToken, escrow, treasuryOwner } = await setupAPYOffering();

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("500");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());

            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);

            const payoutAmount = ethers.parseUnits("50");
            await payoutToken.connect(investor1).approve(await wrappedToken.getAddress(), payoutAmount);

            // Non-admin should not be able to distribute
            await expect(
                wrappedToken.connect(investor1).distributePayoutForPeriod(payoutAmount)
            ).to.be.revertedWithCustomError(wrappedToken, "AccessControlUnauthorizedAccount");
        });

        it("Should allow admin to grant and revoke payout admin role", async function () {
            const { wrappedToken, deployer, investor1 } = await setupAPYOffering();

            const PAYOUT_ADMIN_ROLE = await wrappedToken.PAYOUT_ADMIN_ROLE();

            // Grant role
            await expect(
                wrappedToken.connect(deployer).grantPayoutAdminRole(investor1.address)
            ).to.not.be.reverted;

            expect(await wrappedToken.hasRole(PAYOUT_ADMIN_ROLE, investor1.address)).to.be.true;

            // Revoke role
            await expect(
                wrappedToken.connect(deployer).revokePayoutAdminRole(investor1.address)
            ).to.not.be.reverted;

            expect(await wrappedToken.hasRole(PAYOUT_ADMIN_ROLE, investor1.address)).to.be.false;
        });

        it("Should prevent payout distribution when paused", async function () {
            const { wrappedToken, offering, config, investmentManager, investor1, paymentToken, payoutToken, payoutAdmin, deployer, escrow, treasuryOwner } = await setupAPYOffering();

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("300");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());

            // Pause contract
            await wrappedToken.connect(deployer).pause();

            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);

            const payoutAmount = ethers.parseUnits("30");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount);

            // Should fail when paused
            await expect(
                wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payoutAmount)
            ).to.be.revertedWithCustomError(wrappedToken, "EnforcedPause");

            // Unpause and try again
            await wrappedToken.connect(deployer).unpause();
            
            await expect(
                wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payoutAmount)
            ).to.emit(wrappedToken, "PayoutDistributed");
        });
    });

    describe("7. Edge Cases and Error Handling", function () {
        it("Should handle zero payout distribution", async function () {
            const { wrappedToken, offering, config, investmentManager, investor1, paymentToken, payoutAdmin, escrow, treasuryOwner } = await setupAPYOffering();

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("100");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());

            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);

            // Try to distribute zero amount
            await expect(
                wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(0)
            ).to.be.revertedWithCustomError(wrappedToken, "InvalidAmount");
        });

        it("Should handle payout claims when no payouts available", async function () {
            const { wrappedToken, offering, config, investmentManager, investor1, paymentToken, escrow, treasuryOwner } = await setupAPYOffering();

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("200");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());

            // Try to claim when no payouts have been distributed
            await expect(
                wrappedToken.connect(investor1).claimAvailablePayouts()
            ).to.be.revertedWithCustomError(wrappedToken, "NoPayout");
        });

        it("Should handle insufficient contract balance for payouts", async function () {
            const { wrappedToken, offering, config, investmentManager, investor1, paymentToken, payoutToken, payoutAdmin, escrow, treasuryOwner } = await setupAPYOffering();

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("500");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());

            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);

            // Distribute more than admin has approved
            const payoutAmount = ethers.parseUnits("1000");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), ethers.parseUnits("50")); // Only approve 50

            await expect(
                wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payoutAmount)
            ).to.be.revertedWithCustomError(payoutToken, "ERC20InsufficientAllowance");
        });

        it("Should handle payout claims after emergency unlock", async function () {
            const { wrappedToken, offering, config, investmentManager, investor1, paymentToken, payoutToken, payoutAdmin, deployer, escrow, treasuryOwner } = await setupAPYOffering();

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("400");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());

            // Distribute payout
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);

            const payoutAmount = ethers.parseUnits("40");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payoutAmount);

            // Claim payout first
            await wrappedToken.connect(investor1).claimAvailablePayouts();

            // Enable emergency unlock and use it
            await wrappedToken.connect(deployer).enableEmergencyUnlock(1000); // 10% penalty
            await wrappedToken.connect(investor1).emergencyUnlock();

            // Try to claim more payouts after emergency unlock
            await expect(
                wrappedToken.connect(investor1).claimAvailablePayouts()
            ).to.be.revertedWithCustomError(wrappedToken, "AlreadyClaimed");
        });
    });
});