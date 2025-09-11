const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("WRAPPEDTOKEN Contract", function () {
    async function deployWrappedTokenFixture() {
        const [admin, offeringContract, user1, user2, user3, payoutAdmin] = await ethers.getSigners();
        
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const peggedToken = await MockERC20.deploy("USDT Token", "USDT");
        const payoutToken = await MockERC20.deploy("USDC Payout", "USDC");
        
        const now = await time.latest();
        const maturityDate = now + (365 * 24 * 60 * 60); // 1 year
        const payoutPeriodDuration = 30 * 24 * 60 * 60; // 30 days
        
        const config = {
            name: "Wrapped USDT 2025",
            symbol: "wUSDT-25",
            peggedToken: await peggedToken.getAddress(),
            payoutToken: await payoutToken.getAddress(),
            maturityDate: maturityDate,
            payoutAPR: 1200, // 12% APR
            offeringContract: offeringContract.address,
            admin: admin.address,
            payoutPeriodDuration: payoutPeriodDuration
        };
        
        const WRAPPEDTOKEN = await ethers.getContractFactory("WRAPPEDTOKEN");
        const wrappedToken = await WRAPPEDTOKEN.deploy(config);
        
        // Grant payout admin role
        const PAYOUT_ADMIN_ROLE = await wrappedToken.PAYOUT_ADMIN_ROLE();
        await wrappedToken.connect(admin).grantRole(PAYOUT_ADMIN_ROLE, payoutAdmin.address);
        
        // Mint tokens for testing
        await peggedToken.mint(offeringContract.address, ethers.parseUnits("1000000", 18));
        await payoutToken.mint(payoutAdmin.address, ethers.parseUnits("100000", 18));

        return { 
            wrappedToken, peggedToken, payoutToken, admin, offeringContract, 
            user1, user2, user3, payoutAdmin, maturityDate, payoutPeriodDuration 
        };
    }

    describe("Deployment and Configuration", function () {
        it("Should deploy with correct configuration", async function () {
            const { wrappedToken, peggedToken, payoutToken, maturityDate, payoutPeriodDuration } = await loadFixture(deployWrappedTokenFixture);
            
            expect(await wrappedToken.name()).to.equal("Wrapped USDT 2025");
            expect(await wrappedToken.symbol()).to.equal("wUSDT-25");
            expect(await wrappedToken.peggedToken()).to.equal(await peggedToken.getAddress());
            expect(await wrappedToken.payoutToken()).to.equal(await payoutToken.getAddress());
            expect(await wrappedToken.maturityDate()).to.equal(maturityDate);
            expect(await wrappedToken.payoutAPR()).to.equal(1200);
            expect(await wrappedToken.payoutPeriodDuration()).to.equal(payoutPeriodDuration);
        });

        it("Should set first payout date correctly", async function () {
            const { wrappedToken, offeringContract } = await loadFixture(deployWrappedTokenFixture);
            
            const currentTime = await time.latest();
            await expect(wrappedToken.connect(offeringContract).setFirstPayoutDate())
                .to.emit(wrappedToken, "FirstPayoutDateSet");
            
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            expect(firstPayoutDate).to.be.gt(currentTime);
        });

        it("Should prevent setting first payout date twice", async function () {
            const { wrappedToken, offeringContract } = await loadFixture(deployWrappedTokenFixture);
            
            await wrappedToken.connect(offeringContract).setFirstPayoutDate();
            
            await expect(wrappedToken.connect(offeringContract).setFirstPayoutDate())
                .to.be.revertedWithCustomError(wrappedToken, "InvalidConfiguration");
        });
    });

    describe("Investment Registration", function () {
        it("Should register investment correctly", async function () {
            const { wrappedToken, peggedToken, offeringContract, user1 } = await loadFixture(deployWrappedTokenFixture);
            
            const investmentAmount = ethers.parseUnits("1000", 18);
            const usdtValue = ethers.parseUnits("1000", 18);
            
            await peggedToken.connect(offeringContract).approve(await wrappedToken.getAddress(), investmentAmount);
            
            await expect(wrappedToken.connect(offeringContract).registerInvestment(
                user1.address,
                investmentAmount,
                usdtValue
            ))
                .to.emit(wrappedToken, "InvestmentRegistered")
                .withArgs(user1.address, investmentAmount, usdtValue);
            
            expect(await wrappedToken.balanceOf(user1.address)).to.equal(investmentAmount);
            expect(await wrappedToken.totalEscrowed()).to.equal(investmentAmount);
            expect(await wrappedToken.totalUSDTInvested()).to.equal(usdtValue);
            
            const investor = await wrappedToken.investors(user1.address);
            expect(investor.deposited).to.equal(investmentAmount);
            expect(investor.usdtValue).to.equal(usdtValue);
        });

        it("Should only allow offering contract to register investments", async function () {
            const { wrappedToken, user1 } = await loadFixture(deployWrappedTokenFixture);
            
            await expect(wrappedToken.connect(user1).registerInvestment(
                user1.address,
                ethers.parseUnits("1000", 18),
                ethers.parseUnits("1000", 18)
            )).to.be.revertedWithCustomError(wrappedToken, "Unauthorized");
        });

        it("Should handle multiple investments from same user", async function () {
            const { wrappedToken, peggedToken, offeringContract, user1 } = await loadFixture(deployWrappedTokenFixture);
            
            const investment1 = ethers.parseUnits("500", 18);
            const investment2 = ethers.parseUnits("300", 18);
            const totalInvestment = investment1 + investment2;
            
            await peggedToken.connect(offeringContract).approve(await wrappedToken.getAddress(), totalInvestment);
            
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, investment1, investment1);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, investment2, investment2);
            
            expect(await wrappedToken.balanceOf(user1.address)).to.equal(totalInvestment);
            
            const investor = await wrappedToken.investors(user1.address);
            expect(investor.deposited).to.equal(totalInvestment);
            expect(investor.usdtValue).to.equal(totalInvestment);
        });
    });

    describe("Payout Distribution System", function () {
        it("Should calculate required payout tokens correctly", async function () {
            const { wrappedToken, peggedToken, offeringContract, user1 } = await loadFixture(deployWrappedTokenFixture);
            
            // Register investment
            const investmentAmount = ethers.parseUnits("10000", 18); // $10,000
            await peggedToken.connect(offeringContract).approve(await wrappedToken.getAddress(), investmentAmount);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, investmentAmount, investmentAmount);
            
            const [requiredAmount, periodAPR] = await wrappedToken.calculateRequiredPayoutTokens();
            
            // 12% APR for 30 days = (1200 * 30 days) / 365 days ≈ 98.63 basis points
            // Required = ($10,000 * 98.63) / 10000 ≈ $98.63
            expect(requiredAmount).to.be.gt(ethers.parseUnits("90", 18));
            expect(requiredAmount).to.be.lt(ethers.parseUnits("110", 18));
            expect(periodAPR).to.be.gt(0);
        });

        it("Should distribute payout for period", async function () {
            const { wrappedToken, peggedToken, payoutToken, offeringContract, user1, payoutAdmin, payoutPeriodDuration } = await loadFixture(deployWrappedTokenFixture);
            
            // Set first payout date and register investment
            await wrappedToken.connect(offeringContract).setFirstPayoutDate();
            
            const investmentAmount = ethers.parseUnits("1000", 18);
            await peggedToken.connect(offeringContract).approve(await wrappedToken.getAddress(), investmentAmount);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, investmentAmount, investmentAmount);
            
            // Fast forward to first payout date
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(firstPayoutDate + 10);
            
            const payoutAmount = ethers.parseUnits("100", 18);
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount);
            
            await expect(wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payoutAmount))
                .to.emit(wrappedToken, "PayoutDistributed")
                .withArgs(1, payoutAmount, investmentAmount);
            
            expect(await wrappedToken.currentPayoutPeriod()).to.equal(1);
        });

        it("Should allow users to claim available payouts", async function () {
            const { wrappedToken, peggedToken, payoutToken, offeringContract, user1, payoutAdmin } = await loadFixture(deployWrappedTokenFixture);
            
            // Setup investment and payout
            await wrappedToken.connect(offeringContract).setFirstPayoutDate();
            
            const investmentAmount = ethers.parseUnits("1000", 18);
            await peggedToken.connect(offeringContract).approve(await wrappedToken.getAddress(), investmentAmount);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, investmentAmount, investmentAmount);
            
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(firstPayoutDate + 10);
            
            const payoutAmount = ethers.parseUnits("100", 18);
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payoutAmount);
            
            // Claim payout
            await expect(wrappedToken.connect(user1).claimAvailablePayouts())
                .to.emit(wrappedToken, "PayoutClaimed")
                .withArgs(user1.address, payoutAmount, 1);
            
            expect(await payoutToken.balanceOf(user1.address)).to.equal(payoutAmount);
        });

        it("Should distribute payouts proportionally among multiple users", async function () {
            const { wrappedToken, peggedToken, payoutToken, offeringContract, user1, user2, payoutAdmin } = await loadFixture(deployWrappedTokenFixture);
            
            await wrappedToken.connect(offeringContract).setFirstPayoutDate();
            
            // User1 invests $600, User2 invests $400 (60%/40% split)
            const investment1 = ethers.parseUnits("600", 18);
            const investment2 = ethers.parseUnits("400", 18);
            const totalInvestment = investment1 + investment2;
            
            await peggedToken.connect(offeringContract).approve(await wrappedToken.getAddress(), totalInvestment);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, investment1, investment1);
            await wrappedToken.connect(offeringContract).registerInvestment(user2.address, investment2, investment2);
            
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(firstPayoutDate + 10);
            
            const payoutAmount = ethers.parseUnits("1000", 18);
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payoutAmount);
            
            // Check payout info
            const user1Info = await wrappedToken.getUserPayoutInfo(user1.address);
            const user2Info = await wrappedToken.getUserPayoutInfo(user2.address);
            
            // User1 should get 60% = 600, User2 should get 40% = 400
            expect(user1Info.totalClaimable).to.equal(ethers.parseUnits("600", 18));
            expect(user2Info.totalClaimable).to.equal(ethers.parseUnits("400", 18));
            
            // Claim payouts
            await wrappedToken.connect(user1).claimAvailablePayouts();
            await wrappedToken.connect(user2).claimAvailablePayouts();
            
            expect(await payoutToken.balanceOf(user1.address)).to.equal(ethers.parseUnits("600", 18));
            expect(await payoutToken.balanceOf(user2.address)).to.equal(ethers.parseUnits("400", 18));
        });

        it("Should handle multiple payout periods", async function () {
            const { wrappedToken, peggedToken, payoutToken, offeringContract, user1, payoutAdmin, payoutPeriodDuration } = await loadFixture(deployWrappedTokenFixture);
            
            await wrappedToken.connect(offeringContract).setFirstPayoutDate();
            
            const investmentAmount = ethers.parseUnits("1000", 18);
            await peggedToken.connect(offeringContract).approve(await wrappedToken.getAddress(), investmentAmount);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, investmentAmount, investmentAmount);
            
            // First payout period
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(firstPayoutDate + 10);
            
            const payout1 = ethers.parseUnits("50", 18);
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout1);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout1);
            await wrappedToken.connect(user1).claimAvailablePayouts();
            
            // Second payout period
            await time.increase(payoutPeriodDuration + 10);
            
            const payout2 = ethers.parseUnits("75", 18);
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout2);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout2);
            await wrappedToken.connect(user1).claimAvailablePayouts();
            
            expect(await payoutToken.balanceOf(user1.address)).to.equal(payout1 + payout2);
            expect(await wrappedToken.currentPayoutPeriod()).to.equal(2);
        });

        it("Should prevent payout distribution before period time", async function () {
            const { wrappedToken, payoutToken, payoutAdmin } = await loadFixture(deployWrappedTokenFixture);
            
            const payoutAmount = ethers.parseUnits("100", 18);
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount);
            
            await expect(wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payoutAmount))
                .to.be.revertedWithCustomError(wrappedToken, "FirstPayoutDateNotSet");
        });
    });

    describe("Emergency Unlock System", function () {
        it("Should enable emergency unlock with penalty", async function () {
            const { wrappedToken, admin } = await loadFixture(deployWrappedTokenFixture);
            
            const penalty = 1500; // 15%
            
            await expect(wrappedToken.connect(admin).enableEmergencyUnlock(penalty))
                .to.emit(wrappedToken, "EmergencyUnlockEnabled")
                .withArgs(penalty);
            
            expect(await wrappedToken.emergencyUnlockEnabled()).to.be.true;
            expect(await wrappedToken.emergencyUnlockPenalty()).to.equal(penalty);
        });

        it("Should allow emergency unlock with penalty", async function () {
            const { wrappedToken, peggedToken, admin, offeringContract, user1 } = await loadFixture(deployWrappedTokenFixture);
            
            // Register investment
            const investmentAmount = ethers.parseUnits("1000", 18);
            await peggedToken.connect(offeringContract).approve(await wrappedToken.getAddress(), investmentAmount);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, investmentAmount, investmentAmount);
            
            // Enable emergency unlock with 20% penalty
            await wrappedToken.connect(admin).enableEmergencyUnlock(2000);
            
            const expectedReturn = investmentAmount * 80n / 100n; // 80% after 20% penalty
            const expectedPenalty = investmentAmount * 20n / 100n;
            
            await expect(wrappedToken.connect(user1).emergencyUnlock())
                .to.emit(wrappedToken, "EmergencyUnlockUsed")
                .withArgs(user1.address, expectedReturn, expectedPenalty);
            
            expect(await peggedToken.balanceOf(user1.address)).to.equal(expectedReturn);
            expect(await wrappedToken.balanceOf(user1.address)).to.equal(0);
            
            // Check investor record is cleared
            const investor = await wrappedToken.investors(user1.address);
            expect(investor.deposited).to.equal(0);
            expect(investor.emergencyUnlocked).to.be.true;
        });

        it("Should prevent emergency unlock when disabled", async function () {
            const { wrappedToken, peggedToken, offeringContract, user1 } = await loadFixture(deployWrappedTokenFixture);
            
            const investmentAmount = ethers.parseUnits("1000", 18);
            await peggedToken.connect(offeringContract).approve(await wrappedToken.getAddress(), investmentAmount);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, investmentAmount, investmentAmount);
            
            await expect(wrappedToken.connect(user1).emergencyUnlock())
                .to.be.revertedWithCustomError(wrappedToken, "UnlockDisabled");
        });

        it("Should prevent excessive penalty", async function () {
            const { wrappedToken, admin } = await loadFixture(deployWrappedTokenFixture);
            
            const excessivePenalty = 6000; // 60% > 50% max
            
            await expect(wrappedToken.connect(admin).enableEmergencyUnlock(excessivePenalty))
                .to.be.revertedWithCustomError(wrappedToken, "InvalidPenalty");
        });
    });

    describe("Final Token Claims", function () {
        it("Should allow final token claims after maturity", async function () {
            const { wrappedToken, peggedToken, offeringContract, user1, maturityDate } = await loadFixture(deployWrappedTokenFixture);
            
            const investmentAmount = ethers.parseUnits("1000", 18);
            await peggedToken.connect(offeringContract).approve(await wrappedToken.getAddress(), investmentAmount);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, investmentAmount, investmentAmount);
            
            await time.increaseTo(maturityDate + 10);
            
            await expect(wrappedToken.connect(user1).claimFinalTokens())
                .to.emit(wrappedToken, "FinalTokensClaimed")
                .withArgs(user1.address, investmentAmount);
            
            expect(await peggedToken.balanceOf(user1.address)).to.equal(investmentAmount);
            expect(await wrappedToken.balanceOf(user1.address)).to.equal(0);
            
            const investor = await wrappedToken.investors(user1.address);
            expect(investor.hasClaimedFinalTokens).to.be.true;
        });

        it("Should prevent final claims before maturity", async function () {
            const { wrappedToken, peggedToken, offeringContract, user1 } = await loadFixture(deployWrappedTokenFixture);
            
            const investmentAmount = ethers.parseUnits("1000", 18);
            await peggedToken.connect(offeringContract).approve(await wrappedToken.getAddress(), investmentAmount);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, investmentAmount, investmentAmount);
            
            await expect(wrappedToken.connect(user1).claimFinalTokens())
                .to.be.revertedWithCustomError(wrappedToken, "NotMatured");
        });

        it("Should prevent double claiming", async function () {
            const { wrappedToken, peggedToken, offeringContract, user1, maturityDate } = await loadFixture(deployWrappedTokenFixture);
            
            const investmentAmount = ethers.parseUnits("1000", 18);
            await peggedToken.connect(offeringContract).approve(await wrappedToken.getAddress(), investmentAmount);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, investmentAmount, investmentAmount);
            
            await time.increaseTo(maturityDate + 10);
            await wrappedToken.connect(user1).claimFinalTokens();
            
            await expect(wrappedToken.connect(user1).claimFinalTokens())
                .to.be.revertedWithCustomError(wrappedToken, "NoDeposit");
        });
    });

    describe("Transfer Restrictions", function () {
        it("Should prevent all transfers", async function () {
            const { wrappedToken, user1, user2 } = await loadFixture(deployWrappedTokenFixture);
            
            await expect(wrappedToken.connect(user1).transfer(user2.address, 100))
                .to.be.revertedWithCustomError(wrappedToken, "NoTransfers");
        });

        it("Should prevent transferFrom", async function () {
            const { wrappedToken, user1, user2 } = await loadFixture(deployWrappedTokenFixture);
            
            await expect(wrappedToken.connect(user1).transferFrom(user1.address, user2.address, 100))
                .to.be.revertedWithCustomError(wrappedToken, "NoTransfers");
        });
    });

    describe("Access Control", function () {
        it("Should allow admin to grant and revoke payout admin role", async function () {
            const { wrappedToken, admin, user1 } = await loadFixture(deployWrappedTokenFixture);
            
            await wrappedToken.connect(admin).grantPayoutAdminRole(user1.address);
            
            const PAYOUT_ADMIN_ROLE = await wrappedToken.PAYOUT_ADMIN_ROLE();
            expect(await wrappedToken.hasRole(PAYOUT_ADMIN_ROLE, user1.address)).to.be.true;
            
            await wrappedToken.connect(admin).revokePayoutAdminRole(user1.address);
            expect(await wrappedToken.hasRole(PAYOUT_ADMIN_ROLE, user1.address)).to.be.false;
        });

        it("Should allow admin to pause and unpause", async function () {
            const { wrappedToken, admin } = await loadFixture(deployWrappedTokenFixture);
            
            await wrappedToken.connect(admin).pause();
            expect(await wrappedToken.paused()).to.be.true;
            
            await wrappedToken.connect(admin).unpause();
            expect(await wrappedToken.paused()).to.be.false;
        });

        it("Should prevent non-admin from pausing", async function () {
            const { wrappedToken, user1 } = await loadFixture(deployWrappedTokenFixture);
            
            await expect(wrappedToken.connect(user1).pause())
                .to.be.revertedWithCustomError(wrappedToken, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Complex Scenarios", function () {
        it("Should handle payout distribution after emergency unlocks", async function () {
            const { wrappedToken, peggedToken, payoutToken, admin, offeringContract, user1, user2, payoutAdmin, payoutPeriodDuration } = await loadFixture(deployWrappedTokenFixture);
            
            await wrappedToken.connect(offeringContract).setFirstPayoutDate();
            
            // Two users invest equally
            const investmentAmount = ethers.parseUnits("500", 18);
            await peggedToken.connect(offeringContract).approve(await wrappedToken.getAddress(), investmentAmount * 2n);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, investmentAmount, investmentAmount);
            await wrappedToken.connect(offeringContract).registerInvestment(user2.address, investmentAmount, investmentAmount);
            
            // First payout - both users get equal share
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(firstPayoutDate + 10);
            
            const payout1 = ethers.parseUnits("200", 18);
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout1);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout1);
            
            await wrappedToken.connect(user1).claimAvailablePayouts();
            await wrappedToken.connect(user2).claimAvailablePayouts();
            
            expect(await payoutToken.balanceOf(user1.address)).to.equal(ethers.parseUnits("100", 18));
            expect(await payoutToken.balanceOf(user2.address)).to.equal(ethers.parseUnits("100", 18));
            
            // User1 emergency unlocks
            await wrappedToken.connect(admin).enableEmergencyUnlock(1000); // 10% penalty
            await wrappedToken.connect(user1).emergencyUnlock();
            
            // Second payout - only user2 should receive
            await time.increase(payoutPeriodDuration + 10);
            
            const payout2 = ethers.parseUnits("100", 18);
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout2);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout2);
            
            const user1Info = await wrappedToken.getUserPayoutInfo(user1.address);
            const user2Info = await wrappedToken.getUserPayoutInfo(user2.address);
            
            expect(user1Info.totalClaimable).to.equal(0); // No more payouts after emergency unlock
            expect(user2Info.totalClaimable).to.equal(payout2); // Gets all of second payout
            
            await wrappedToken.connect(user2).claimAvailablePayouts();
            expect(await payoutToken.balanceOf(user2.address)).to.equal(ethers.parseUnits("200", 18)); // 100 + 100
        });

        it("Should get expected payout for user", async function () {
            const { wrappedToken, peggedToken, offeringContract, user1 } = await loadFixture(deployWrappedTokenFixture);
            
            const investmentAmount = ethers.parseUnits("10000", 18); // $10,000
            await peggedToken.connect(offeringContract).approve(await wrappedToken.getAddress(), investmentAmount);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, investmentAmount, investmentAmount);
            
            const expectedPayout = await wrappedToken.getExpectedPayoutForUser(user1.address);
            
            // Should be approximately 12% APR for 30 days
            expect(expectedPayout).to.be.gt(ethers.parseUnits("90", 18));
            expect(expectedPayout).to.be.lt(ethers.parseUnits("110", 18));
        });
    });

    describe("Contract Information", function () {
        it("Should return correct contract info", async function () {
            const { wrappedToken, peggedToken, payoutToken, maturityDate } = await loadFixture(deployWrappedTokenFixture);
            
            const contractInfo = await wrappedToken.getContractInfo();
            
            expect(contractInfo.peggedTokenAddress).to.equal(await peggedToken.getAddress());
            expect(contractInfo.payoutTokenAddress).to.equal(await payoutToken.getAddress());
            expect(contractInfo.maturityTimestamp).to.equal(maturityDate);
            expect(contractInfo.currentPayoutAPR).to.equal(1200);
            expect(contractInfo.emergencyUnlockStatus).to.be.false;
            expect(contractInfo.emergencyPenalty).to.equal(0);
        });

        it("Should return current payout period info", async function () {
            const { wrappedToken, offeringContract } = await loadFixture(deployWrappedTokenFixture);
            
            await wrappedToken.connect(offeringContract).setFirstPayoutDate();
            
            const periodInfo = await wrappedToken.getCurrentPayoutPeriodInfo();
            
            expect(periodInfo.period).to.equal(0);
            expect(periodInfo.currentAPR).to.equal(1200);
            expect(periodInfo.canDistribute).to.be.true;
        });
    });
});