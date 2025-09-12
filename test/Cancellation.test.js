const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Offering Cancellation Flow Tests", function () {
    // Constants for test configuration
    const MIN_INVESTMENT = ethers.parseUnits("100", 18); // $100
    const MAX_INVESTMENT = ethers.parseUnits("5000", 18); // $5000
    const SOFT_CAP = ethers.parseUnits("10000", 18); // $10k
    const FUNDRAISING_CAP = ethers.parseUnits("100000", 18); // $100k
    const TOKEN_PRICE = ethers.parseUnits("0.5", 18); // $0.5 per token
    const PAYOUT_APR = 1200; // 12% APR in basis points
    const PAYOUT_PERIOD_DURATION = 30 * 24 * 60 * 60; // 30 days

    async function deployCancellationFixture() {
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

        console.log("🏗️ Deploying cancellation test ecosystem...");

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
        await investmentManager.connect(deployer).addKYBValidator(kybValidator.address);

        // Mint initial tokens
        await saleToken.connect(deployer).mint(tokenOwner.address, ethers.parseUnits("10000000"));
        await paymentToken.connect(deployer).mint(investor1.address, ethers.parseUnits("50000"));
        await paymentToken.connect(deployer).mint(investor2.address, ethers.parseUnits("50000"));
        await paymentToken.connect(deployer).mint(investor3.address, ethers.parseUnits("50000"));
        await payoutToken.connect(deployer).mint(payoutAdmin.address, ethers.parseUnits("100000"));

        console.log("✅ Cancellation test ecosystem deployed successfully");

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

    async function createOfferingConfig(fixture, apyEnabled = false) {
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
            apyEnabled: apyEnabled,
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

    async function setupOfferingForCancellation(apyEnabled = false) {
        const fixture = await loadFixture(deployCancellationFixture);
        const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner } = fixture;
        
        const config = await createOfferingConfig(fixture, apyEnabled);
        
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

        // Transfer sale tokens to offering
        const totalTokensForSale = ethers.parseUnits("200000");
        await saleToken.connect(tokenOwner).transfer(offeringAddress, totalTokensForSale);

        let wrappedToken = null;
        if (apyEnabled) {
            const wrappedTokenAddress = await offering.wrappedTokenAddress();
            wrappedToken = await ethers.getContractAt("WRAPPEDTOKEN", wrappedTokenAddress);
        }

        return { ...fixture, offering, wrappedToken, config };
    }

    describe("1. Basic Cancellation Flow", function () {
        it("Should allow token owner to cancel offering before finalization", async function () {
            const { offering, tokenOwner } = await setupOfferingForCancellation(false);

            expect(await offering.isOfferingCancelled()).to.be.false;
            expect(await offering.canCancel()).to.be.true;

            await expect(
                offering.connect(tokenOwner).cancelOffering()
            ).to.emit(offering, "OfferingCancelled");

            expect(await offering.isOfferingCancelled()).to.be.true;
            expect(await offering.isSaleClosed()).to.be.true;
            expect(await offering.canCancel()).to.be.false;
        });

        it("Should prevent non-token-owner from cancelling", async function () {
            const { offering, investor1 } = await setupOfferingForCancellation(false);

            await expect(
                offering.connect(investor1).cancelOffering()
            ).to.be.revertedWithCustomError(offering, "AccessControlUnauthorizedAccount");
        });

        it("Should prevent cancellation after finalization", async function () {
            const { offering, config, tokenOwner, escrow, treasuryOwner } = await setupOfferingForCancellation(false);

            // Fast forward past end date and finalize
            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());

            expect(await offering.isOfferingFinalized()).to.be.true;
            expect(await offering.canCancel()).to.be.false;

            await expect(
                offering.connect(tokenOwner).cancelOffering()
            ).to.be.revertedWith("Already finalized");
        });

        it("Should prevent double cancellation", async function () {
            const { offering, tokenOwner } = await setupOfferingForCancellation(false);

            // First cancellation should succeed
            await offering.connect(tokenOwner).cancelOffering();
            expect(await offering.isOfferingCancelled()).to.be.true;

            // Second cancellation should fail
            await expect(
                offering.connect(tokenOwner).cancelOffering()
            ).to.be.revertedWith("Already cancelled");
        });
    });

    describe("2. Cancellation with Investments", function () {
        it("Should handle cancellation after investments without APY", async function () {
            const { offering, config, investmentManager, investor1, investor2, paymentToken, tokenOwner } = await setupOfferingForCancellation(false);

            await time.increaseTo(config.startDate + 10);

            // Multiple investments
            const investment1 = ethers.parseUnits("500");
            const investment2 = ethers.parseUnits("300");

            await paymentToken.connect(investor1).approve(await offering.getAddress(), investment1);
            await paymentToken.connect(investor2).approve(await offering.getAddress(), investment2);

            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investment1
            );

            await investmentManager.connect(investor2).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investment2
            );

            expect(await offering.totalRaised()).to.equal(ethers.parseUnits("800"));

            // Cancel offering
            await expect(
                offering.connect(tokenOwner).cancelOffering()
            ).to.emit(offering, "OfferingCancelled");

            expect(await offering.isOfferingCancelled()).to.be.true;
            expect(await offering.isSaleClosed()).to.be.true;
        });

        it("Should handle cancellation after investments with APY", async function () {
            const { offering, config, investmentManager, investor1, paymentToken, tokenOwner } = await setupOfferingForCancellation(true);

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("1000");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            expect(await offering.totalRaised()).to.equal(ethers.parseUnits("1000"));
            expect(await offering.apyEnabled()).to.be.true;

            // Cancel offering
            await expect(
                offering.connect(tokenOwner).cancelOffering()
            ).to.emit(offering, "OfferingCancelled");

            expect(await offering.isOfferingCancelled()).to.be.true;
        });

        it("Should prevent new investments after cancellation", async function () {
            const { offering, config, investmentManager, investor1, investor2, paymentToken, tokenOwner } = await setupOfferingForCancellation(false);

            await time.increaseTo(config.startDate + 10);

            // First investment before cancellation
            const investment1 = ethers.parseUnits("500");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investment1);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investment1
            );

            // Cancel offering
            await offering.connect(tokenOwner).cancelOffering();

            // Try to invest after cancellation
            const investment2 = ethers.parseUnits("300");
            await paymentToken.connect(investor2).approve(await offering.getAddress(), investment2);

            await expect(
                investmentManager.connect(investor2).routeInvestment(
                    await offering.getAddress(),
                    await paymentToken.getAddress(),
                    investment2
                )
            ).to.be.revertedWith("Sale is closed");
        });
    });

    describe("3. Refund Process", function () {
        it("Should enable refunds automatically on cancellation", async function () {
            const { offering, config, investmentManager, investor1, paymentToken, tokenOwner, escrow } = await setupOfferingForCancellation(false);

            await time.increaseTo(config.startDate + 10);

            // Make investment
            const investmentAmount = ethers.parseUnits("500");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Check refunds not enabled initially
            expect(await escrow.refundsEnabled(await offering.getAddress())).to.be.false;

            // Cancel offering
            await expect(
                offering.connect(tokenOwner).cancelOffering()
            ).to.emit(escrow, "RefundsEnabled");

            // Check refunds are now enabled
            expect(await escrow.refundsEnabled(await offering.getAddress())).to.be.true;
        });

        it("Should allow investors to claim refunds after cancellation", async function () {
            const { offering, config, investmentManager, investor1, investor2, paymentToken, tokenOwner } = await setupOfferingForCancellation(false);

            await time.increaseTo(config.startDate + 10);

            // Multiple investments
            const investment1 = ethers.parseUnits("600");
            const investment2 = ethers.parseUnits("400");

            const initialBalance1 = await paymentToken.balanceOf(investor1.address);
            const initialBalance2 = await paymentToken.balanceOf(investor2.address);

            await paymentToken.connect(investor1).approve(await offering.getAddress(), investment1);
            await paymentToken.connect(investor2).approve(await offering.getAddress(), investment2);

            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investment1
            );

            await investmentManager.connect(investor2).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investment2
            );

            // Cancel offering
            await offering.connect(tokenOwner).cancelOffering();

            // Claim refunds
            await expect(
                investmentManager.connect(investor1).claimRefund(
                    await offering.getAddress(),
                    await paymentToken.getAddress()
                )
            ).to.emit(investmentManager, "RefundClaimed");

            await expect(
                investmentManager.connect(investor2).claimRefund(
                    await offering.getAddress(),
                    await paymentToken.getAddress()
                )
            ).to.emit(investmentManager, "RefundClaimed");

            // Check balances restored
            const finalBalance1 = await paymentToken.balanceOf(investor1.address);
            const finalBalance2 = await paymentToken.balanceOf(investor2.address);

            expect(finalBalance1).to.equal(initialBalance1);
            expect(finalBalance2).to.equal(initialBalance2);
        });

        it("Should prevent double refund claims", async function () {
            const { offering, config, investmentManager, investor1, paymentToken, tokenOwner } = await setupOfferingForCancellation(false);

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("500");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Cancel offering
            await offering.connect(tokenOwner).cancelOffering();

            // First refund claim should succeed
            await investmentManager.connect(investor1).claimRefund(
                await offering.getAddress(),
                await paymentToken.getAddress()
            );

            // Second refund claim should fail
            await expect(
                investmentManager.connect(investor1).claimRefund(
                    await offering.getAddress(),
                    await paymentToken.getAddress()
                )
            ).to.be.revertedWith("No deposit found for refund");
        });

        it("Should handle refunds with wrong token address", async function () {
            const { offering, config, investmentManager, investor1, paymentToken, payoutToken, tokenOwner } = await setupOfferingForCancellation(false);

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("500");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Cancel offering
            await offering.connect(tokenOwner).cancelOffering();

            // Try to claim refund with wrong token address
            await expect(
                investmentManager.connect(investor1).claimRefund(
                    await offering.getAddress(),
                    await payoutToken.getAddress() // Wrong token
                )
            ).to.be.revertedWith("Token mismatch for refund");
        });
    });

    describe("4. Cancellation Timing Tests", function () {
        it("Should allow cancellation before sale starts", async function () {
            const { offering, tokenOwner } = await setupOfferingForCancellation(false);

            // Cancel before sale starts
            await expect(
                offering.connect(tokenOwner).cancelOffering()
            ).to.emit(offering, "OfferingCancelled");

            expect(await offering.isOfferingCancelled()).to.be.true;
        });

        it("Should allow cancellation during sale period", async function () {
            const { offering, config, tokenOwner } = await setupOfferingForCancellation(false);

            // Fast forward to during sale
            await time.increaseTo(config.startDate + 1800); // 30 minutes into sale

            await expect(
                offering.connect(tokenOwner).cancelOffering()
            ).to.emit(offering, "OfferingCancelled");

            expect(await offering.isOfferingCancelled()).to.be.true;
        });

        it("Should allow cancellation after sale ends but before finalization", async function () {
            const { offering, config, tokenOwner } = await setupOfferingForCancellation(false);

            // Fast forward past sale end but don't finalize
            await time.increaseTo(config.endDate + 100);

            await expect(
                offering.connect(tokenOwner).cancelOffering()
            ).to.emit(offering, "OfferingCancelled");

            expect(await offering.isOfferingCancelled()).to.be.true;
        });

        it("Should prevent cancellation after soft cap finalization", async function () {
            const { offering, config, investmentManager, investor1, paymentToken, tokenOwner } = await setupOfferingForCancellation(false);

            await time.increaseTo(config.startDate + 10);

            // Invest to reach soft cap
            const softCapInvestment = MAX_INVESTMENT; // Use max investment instead of soft cap
            await paymentToken.connect(investor1).approve(await offering.getAddress(), softCapInvestment);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                softCapInvestment
            );

            // Finalize early due to soft cap
            await offering.connect(tokenOwner).finalizeOfferingSoftCap();

            expect(await offering.isOfferingFinalized()).to.be.true;

            // Should not be able to cancel after finalization
            await expect(
                offering.connect(tokenOwner).cancelOffering()
            ).to.be.revertedWith("Already finalized");
        });
    });

    describe("5. Cancellation with APY Offerings", function () {
        it("Should handle APY offering cancellation before any claims", async function () {
            const { offering, wrappedToken, config, investmentManager, investor1, paymentToken, tokenOwner } = await setupOfferingForCancellation(true);

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("800");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            expect(await offering.pendingTokens(investor1.address)).to.equal(ethers.parseUnits("1600"));

            // Cancel offering
            await offering.connect(tokenOwner).cancelOffering();

            expect(await offering.isOfferingCancelled()).to.be.true;
            expect(await wrappedToken.balanceOf(investor1.address)).to.equal(0); // No wrapped tokens minted yet
        });

        it("Should prevent token claims after APY offering cancellation", async function () {
            const { offering, config, investmentManager, investor1, paymentToken, tokenOwner, escrow, treasuryOwner } = await setupOfferingForCancellation(true);

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("600");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Cancel offering
            await offering.connect(tokenOwner).cancelOffering();

            // Try to claim tokens after cancellation (should fail)
            await expect(
                investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress())
            ).to.be.revertedWith("Offering not finalized yet");
        });
    });

    describe("6. Admin-Initiated Cancellation", function () {
        it("Should allow escrow owner to enable refunds (admin cancellation)", async function () {
            const { offering, config, investmentManager, investor1, paymentToken, escrow, treasuryOwner } = await setupOfferingForCancellation(false);

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("500");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Admin enables refunds directly (emergency cancellation)
            await expect(
                escrow.connect(treasuryOwner).enableRefundsByOwner(await offering.getAddress())
            ).to.emit(escrow, "RefundsEnabled");

            expect(await escrow.refundsEnabled(await offering.getAddress())).to.be.true;

            // Investor can claim refund
            const initialBalance = await paymentToken.balanceOf(investor1.address);
            await investmentManager.connect(investor1).claimRefund(
                await offering.getAddress(),
                await paymentToken.getAddress()
            );
            const finalBalance = await paymentToken.balanceOf(investor1.address);

            expect(finalBalance - initialBalance).to.equal(investmentAmount);
        });

        it("Should prevent admin refund enabling after finalization", async function () {
            const { offering, config, escrow, treasuryOwner } = await setupOfferingForCancellation(false);

            // Fast forward and finalize
            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());

            // Try to enable refunds after finalization
            await expect(
                escrow.connect(treasuryOwner).enableRefundsByOwner(await offering.getAddress())
            ).to.be.revertedWith("Cannot enable refunds - offering finalized");
        });
    });

    describe("7. Edge Cases and Error Handling", function () {
        it("Should handle cancellation with no investments", async function () {
            const { offering, tokenOwner, escrow } = await setupOfferingForCancellation(false);

            // Cancel offering with no investments
            await expect(
                offering.connect(tokenOwner).cancelOffering()
            ).to.emit(offering, "OfferingCancelled");

            expect(await offering.isOfferingCancelled()).to.be.true;
            expect(await escrow.refundsEnabled(await offering.getAddress())).to.be.true;
        });

        it("Should handle refund claims when no investment exists", async function () {
            const { offering, investmentManager, investor1, paymentToken, tokenOwner } = await setupOfferingForCancellation(false);

            // Cancel offering without any investments
            await offering.connect(tokenOwner).cancelOffering();

            // Try to claim refund when no investment was made
            await expect(
                investmentManager.connect(investor1).claimRefund(
                    await offering.getAddress(),
                    await paymentToken.getAddress()
                )
            ).to.be.revertedWith("No deposit found for refund");
        });

        it("Should maintain offering state consistency after cancellation", async function () {
            const { offering, config, investmentManager, investor1, paymentToken, tokenOwner } = await setupOfferingForCancellation(false);

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("500");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            const totalRaisedBeforeCancel = await offering.totalRaised();
            const pendingTokensBeforeCancel = await offering.pendingTokens(investor1.address);

            // Cancel offering
            await offering.connect(tokenOwner).cancelOffering();

            // State should remain consistent
            expect(await offering.totalRaised()).to.equal(totalRaisedBeforeCancel);
            expect(await offering.pendingTokens(investor1.address)).to.equal(pendingTokensBeforeCancel);
            expect(await offering.isOfferingCancelled()).to.be.true;
            expect(await offering.isSaleClosed()).to.be.true;
            expect(await offering.isOfferingFinalized()).to.be.false;
        });

        it("Should handle cancellation status queries correctly", async function () {
            const { offering, tokenOwner } = await setupOfferingForCancellation(false);

            // Before cancellation
            const statusBefore = await offering.getOfferingStatus();
            expect(statusBefore.cancelled).to.be.false;
            expect(statusBefore.finalized).to.be.false;

            // Cancel offering
            await offering.connect(tokenOwner).cancelOffering();

            // After cancellation
            const statusAfter = await offering.getOfferingStatus();
            expect(statusAfter.cancelled).to.be.true;
            expect(statusAfter.saleClosed).to.be.true;
            expect(statusAfter.finalized).to.be.false;
            expect(statusAfter.saleActive).to.be.false;
        });
    });
});