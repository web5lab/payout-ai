const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("WRAPEDTOKEN (Unit)", function () {
    async function deployWrappedTokenFixture() {
        const [owner, offeringContract, user1, user2, payoutAdmin, otherAccount] = await ethers.getSigners();
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const peggedToken = await MockERC20.deploy("Pegged Token", "PEGGED");
        const payoutToken = await MockERC20.deploy("Payout Token", "PAYOUT");
        const latestTime = await time.latest();
        const maturityDate = latestTime + (30 * 24 * 60 * 60);
        const payoutRate = 100; // 1%
        
        const WrappedTokenFactory = await ethers.getContractFactory("WRAPEDTOKEN");
        await expect(
            WrappedTokenFactory.deploy({
                name: "Wrapped Token", 
                symbol: "wTKN", 
                peggedToken: ethers.ZeroAddress, 
                payoutToken: payoutToken.target, 
                maturityDate: maturityDate, 
                payoutRate: 100, 
                offeringContract: offeringContract.address,
                admin: admin.address
            })
        ).to.be.revertedWithCustomError(WrappedTokenFactory, "InvalidStablecoin");
        
        const wrappedToken = await WrappedTokenFactory.deploy({
            name: "Wrapped Token", 
            symbol: "wTKN", 
            peggedToken: peggedToken.target, 
            payoutToken: payoutToken.target, 
            maturityDate: maturityDate, 
            payoutRate: 100, 
            offeringContract: offeringContract.address,
            admin: owner.address
        });
        
        // Grant payout admin role
        const PAYOUT_ADMIN_ROLE = await wrappedToken.PAYOUT_ADMIN_ROLE();
        await wrappedToken.connect(owner).grantRole(PAYOUT_ADMIN_ROLE, payoutAdmin.address);
        
        // Mint some payout tokens to the payout admin for testing
        await payoutToken.mint(payoutAdmin.address, ethers.parseUnits("100000", 18));

        return { wrappedToken, peggedToken, payoutToken, offeringContract, user1, user2, payoutAdmin, otherAccount, maturityDate };
    }

    describe("Deployment", function () {
        it("Should set the correct pegged token", async function () {
            const { wrappedToken, peggedToken } = await loadFixture(deployWrappedTokenFixture);
            expect(await wrappedToken.peggedToken()).to.equal(peggedToken.target);
        });

        it("Should set the correct maturity date", async function () {
            const { wrappedToken, maturityDate } = await loadFixture(deployWrappedTokenFixture);
            expect(await wrappedToken.maturityDate()).to.equal(maturityDate);
        });

        it("Should set the correct offering contract", async function () {
            const { wrappedToken, offeringContract } = await loadFixture(deployWrappedTokenFixture);
            expect(await wrappedToken.offeringContract()).to.equal(offeringContract.address);
        });

        it("Should revert with zero address for pegged token", async function () {
            const { offeringContract, maturityDate } = await loadFixture(deployWrappedTokenFixture);
            const WrappedTokenFactory = await ethers.getContractFactory("WRAPEDTOKEN");
            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const payoutToken = await MockERC20.deploy("Payout Token", "PAYOUT");
            const [owner] = await ethers.getSigners();
            await expect(
                WrappedTokenFactory.deploy({
                    name: "Wrapped Token", 
                    symbol: "wTKN", 
                    peggedToken: ethers.ZeroAddress, 
                    payoutToken: payoutToken.target, 
                    maturityDate: maturityDate, 
                    payoutRate: 100, 
                    offeringContract: offeringContract.address,
                    admin: owner.address
                })
            ).to.be.revertedWithCustomError(WrappedTokenFactory, "InvalidStablecoin");
        });
    });

    describe("Registering Investments", function () {
        it("Should allow the offeringContract to register an investment", async function () {
            const { wrappedToken, peggedToken, offeringContract, user1 } = await loadFixture(deployWrappedTokenFixture);
            const amount = ethers.parseUnits("1000", 18);
            await peggedToken.mint(offeringContract.address, amount);
            await peggedToken.connect(offeringContract).approve(wrappedToken.target, amount);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, amount, 0); // Daily frequency
            expect(await wrappedToken.balanceOf(user1.address)).to.equal(amount);
            expect(await peggedToken.balanceOf(wrappedToken.target)).to.equal(amount);
        });

        it("Should revert if not called by the offering contract", async function () {
            const { wrappedToken, user1 } = await loadFixture(deployWrappedTokenFixture);
            const amount = ethers.parseUnits("1000", 18);
            await expect(
                wrappedToken.connect(user1).registerInvestment(user1.address, amount, 0)
            ).to.be.revertedWith("Caller is not the offering contract");
        });

        it("Should revert if amount is zero", async function () {
            const { wrappedToken, offeringContract, user1 } = await loadFixture(deployWrappedTokenFixture);
            await expect(
                wrappedToken.connect(offeringContract).registerInvestment(user1.address, 0, 0)
            ).to.be.revertedWithCustomError(wrappedToken, "InvalidAmt");
        });

        it("Should revert if peggedToken transfer fails", async function () {
            const { wrappedToken, peggedToken, offeringContract, user1 } = await loadFixture(deployWrappedTokenFixture);
            const amount = ethers.parseUnits("1000", 18);
            // No approval given
            await expect(
                wrappedToken.connect(offeringContract).registerInvestment(user1.address, amount, 0)
            ).to.be.revertedWithCustomError(peggedToken, "ERC20InsufficientAllowance");
        });
    });

    describe("Payout System", function () {
        it("Should allow payout admin to add payout funds", async function () {
            const { wrappedToken, payoutToken, payoutAdmin } = await loadFixture(deployWrappedTokenFixture);
            const payoutAmount = ethers.parseUnits("1000", 18);
            
            await payoutToken.connect(payoutAdmin).approve(wrappedToken.target, payoutAmount);
            await expect(wrappedToken.connect(payoutAdmin).addPayoutFunds(payoutAmount))
                .to.emit(wrappedToken, "PayoutFundsAdded")
                .withArgs(payoutAmount, payoutAmount);
            
            expect(await wrappedToken.totalPayoutFunds()).to.equal(payoutAmount);
        });

        it("Should calculate proportional payout shares correctly", async function () {
            const { wrappedToken, peggedToken, payoutToken, offeringContract, user1, user2, payoutAdmin } = await loadFixture(deployWrappedTokenFixture);
            
            // Register two investments
            const amount1 = ethers.parseUnits("600", 18); // 60% of total
            const amount2 = ethers.parseUnits("400", 18); // 40% of total
            
            await peggedToken.mint(offeringContract.address, amount1 + amount2);
            await peggedToken.connect(offeringContract).approve(wrappedToken.target, amount1 + amount2);
            
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, amount1, 0);
            await wrappedToken.connect(offeringContract).registerInvestment(user2.address, amount2, 0);
            
            // Add payout funds
            const payoutAmount = ethers.parseUnits("1000", 18);
            await payoutToken.connect(payoutAdmin).approve(wrappedToken.target, payoutAmount);
            await wrappedToken.connect(payoutAdmin).addPayoutFunds(payoutAmount);
            
            // Check proportional shares
            const balance1 = await wrappedToken.getUserPayoutBalance(user1.address);
            const balance2 = await wrappedToken.getUserPayoutBalance(user2.address);
            
            expect(balance1.totalAvailable).to.equal(ethers.parseUnits("600", 18)); // 60% of 1000
            expect(balance2.totalAvailable).to.equal(ethers.parseUnits("400", 18)); // 40% of 1000
        });

        it("Should allow users to claim their payout", async function () {
            const { wrappedToken, peggedToken, payoutToken, offeringContract, user1, payoutAdmin } = await loadFixture(deployWrappedTokenFixture);
            
            const amount = ethers.parseUnits("1000", 18);
            await peggedToken.mint(offeringContract.address, amount);
            await peggedToken.connect(offeringContract).approve(wrappedToken.target, amount);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, amount, 0);
            
            // Add payout funds
            const payoutAmount = ethers.parseUnits("500", 18);
            await payoutToken.connect(payoutAdmin).approve(wrappedToken.target, payoutAmount);
            await wrappedToken.connect(payoutAdmin).addPayoutFunds(payoutAmount);
            
            // User claims payout
            await expect(wrappedToken.connect(user1).claimTotalPayout())
                .to.emit(wrappedToken, "PayoutClaimed")
                .withArgs(user1.address, payoutAmount, 0);
            
            expect(await payoutToken.balanceOf(user1.address)).to.equal(payoutAmount);
        });

        it("Should handle multiple payout rounds correctly", async function () {
            const { wrappedToken, peggedToken, payoutToken, offeringContract, user1, payoutAdmin } = await loadFixture(deployWrappedTokenFixture);
            
            const amount = ethers.parseUnits("1000", 18);
            await peggedToken.mint(offeringContract.address, amount);
            await peggedToken.connect(offeringContract).approve(wrappedToken.target, amount);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, amount, 0);
            
            // First payout round
            const payout1 = ethers.parseUnits("300", 18);
            await payoutToken.connect(payoutAdmin).approve(wrappedToken.target, payout1);
            await wrappedToken.connect(payoutAdmin).addPayoutFunds(payout1);
            await wrappedToken.connect(user1).claimTotalPayout();
            
            // Second payout round
            const payout2 = ethers.parseUnits("200", 18);
            await payoutToken.connect(payoutAdmin).approve(wrappedToken.target, payout2);
            await wrappedToken.connect(payoutAdmin).addPayoutFunds(payout2);
            await wrappedToken.connect(user1).claimTotalPayout();
            
            expect(await payoutToken.balanceOf(user1.address)).to.equal(payout1 + payout2);
        });

        it("Should revert if non-payout-admin tries to add funds", async function () {
            const { wrappedToken, payoutToken, user1 } = await loadFixture(deployWrappedTokenFixture);
            const payoutAmount = ethers.parseUnits("1000", 18);
            
            await payoutToken.mint(user1.address, payoutAmount);
            await payoutToken.connect(user1).approve(wrappedToken.target, payoutAmount);
            
            await expect(wrappedToken.connect(user1).addPayoutFunds(payoutAmount))
                .to.be.revertedWithCustomError(wrappedToken, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Emergency Unlock", function () {
        it("Should allow admin to enable emergency unlock", async function () {
            const { wrappedToken } = await loadFixture(deployWrappedTokenFixture);
            const penalty = 1000; // 10%
            
            await expect(wrappedToken.enableEmergencyUnlock(penalty))
                .to.emit(wrappedToken, "EmergencyUnlockEnabled")
                .withArgs(penalty);
            
            expect(await wrappedToken.emergencyUnlockEnabled()).to.be.true;
            expect(await wrappedToken.emergencyUnlockPenalty()).to.equal(penalty);
        });

        it("Should allow users to emergency unlock with penalty", async function () {
            const { wrappedToken, peggedToken, offeringContract, user1 } = await loadFixture(deployWrappedTokenFixture);
            
            const amount = ethers.parseUnits("1000", 18);
            await peggedToken.mint(offeringContract.address, amount);
            await peggedToken.connect(offeringContract).approve(wrappedToken.target, amount);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, amount, 0);
            
            // Enable emergency unlock with 10% penalty
            await wrappedToken.enableEmergencyUnlock(1000);
            
            const expectedReturn = amount * 90n / 100n; // 90% after 10% penalty
            
            await expect(wrappedToken.connect(user1).emergencyUnlock())
                .to.emit(wrappedToken, "EmergencyUnlockUsed")
                .withArgs(user1.address, expectedReturn, amount - expectedReturn);
            
            expect(await peggedToken.balanceOf(user1.address)).to.equal(expectedReturn);
            expect(await wrappedToken.balanceOf(user1.address)).to.equal(0);
            
            // User record should be deleted
            const investor = await wrappedToken.investors(user1.address);
            expect(investor.deposited).to.equal(0);
        });

        it("Should revert emergency unlock if not enabled", async function () {
            const { wrappedToken, peggedToken, offeringContract, user1 } = await loadFixture(deployWrappedTokenFixture);
            
            const amount = ethers.parseUnits("1000", 18);
            await peggedToken.mint(offeringContract.address, amount);
            await peggedToken.connect(offeringContract).approve(wrappedToken.target, amount);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, amount, 0);
            
            await expect(wrappedToken.connect(user1).emergencyUnlock())
                .to.be.revertedWithCustomError(wrappedToken, "UnlockDisabled");
        });

        it("Should revert if penalty is too high", async function () {
            const { wrappedToken } = await loadFixture(deployWrappedTokenFixture);
            
            await expect(wrappedToken.enableEmergencyUnlock(6000)) // 60% penalty
                .to.be.revertedWithCustomError(wrappedToken, "InvalidPenalty");
        });

        it("Should update payout calculations after emergency unlock", async function () {
            const { wrappedToken, peggedToken, payoutToken, offeringContract, user1, user2, payoutAdmin } = await loadFixture(deployWrappedTokenFixture);
            
            // Register two investments
            const amount1 = ethers.parseUnits("600", 18);
            const amount2 = ethers.parseUnits("400", 18);
            
            await peggedToken.mint(offeringContract.address, amount1 + amount2);
            await peggedToken.connect(offeringContract).approve(wrappedToken.target, amount1 + amount2);
            
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, amount1, 0);
            await wrappedToken.connect(offeringContract).registerInvestment(user2.address, amount2, 0);
            
            // Add first payout
            const payout1 = ethers.parseUnits("1000", 18);
            await payoutToken.connect(payoutAdmin).approve(wrappedToken.target, payout1);
            await wrappedToken.connect(payoutAdmin).addPayoutFunds(payout1);
            
            // Both users claim
            await wrappedToken.connect(user1).claimTotalPayout();
            await wrappedToken.connect(user2).claimTotalPayout();
            
            // User1 emergency unlocks
            await wrappedToken.enableEmergencyUnlock(1000);
            await wrappedToken.connect(user1).emergencyUnlock();
            
            // Add second payout - should only go to user2
            const payout2 = ethers.parseUnits("500", 18);
            await payoutToken.connect(payoutAdmin).approve(wrappedToken.target, payout2);
            await wrappedToken.connect(payoutAdmin).addPayoutFunds(payout2);
            
            // User2 should get all of the second payout
            const balance2 = await wrappedToken.getUserPayoutBalance(user2.address);
            expect(balance2.claimable).to.equal(payout2);
            
            // User1 should have no claimable balance (record deleted)
            const balance1 = await wrappedToken.getUserPayoutBalance(user1.address);
            expect(balance1.claimable).to.equal(0);
        });
    });

    describe("Claiming Final Tokens", function () {
        it("Should allow a user to claim their pegged tokens after maturity", async function () {
            const { wrappedToken, peggedToken, offeringContract, user1, maturityDate } = await loadFixture(deployWrappedTokenFixture);
            const amount = ethers.parseUnits("1000", 18);
            await peggedToken.mint(offeringContract.address, amount);
            await peggedToken.connect(offeringContract).approve(wrappedToken.target, amount);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, amount, 0);

            await time.increaseTo(maturityDate + 1);

            const tx = wrappedToken.connect(user1).claimFinalTokens();
            await expect(tx)
                .to.emit(wrappedToken, "FinalTokensClaimed")
                .withArgs(user1.address, amount);
            
            await expect(tx).to.changeTokenBalances(
                peggedToken,
                [wrappedToken, user1],
                [-amount, amount]
            );
            
            expect(await wrappedToken.balanceOf(user1.address)).to.equal(0);
            
            // User record should be deleted
            const investor = await wrappedToken.investors(user1.address);
            expect(investor.deposited).to.equal(0);
        });

        it("Should revert if claiming before maturity", async function () {
            const { wrappedToken, user1 } = await loadFixture(deployWrappedTokenFixture);
            await expect(wrappedToken.connect(user1).claimFinalTokens()).to.be.revertedWithCustomError(wrappedToken, "NotMatured");
        });

        it("Should revert if user has no deposit", async function () {
            const { wrappedToken, otherAccount, maturityDate } = await loadFixture(deployWrappedTokenFixture);
            await time.increaseTo(maturityDate + 1);
            await expect(wrappedToken.connect(otherAccount).claimFinalTokens()).to.be.revertedWithCustomError(wrappedToken, "NoDeposit");
        });

        it("Should revert if user has already claimed", async function () {
            const { wrappedToken, peggedToken, offeringContract, user1, maturityDate } = await loadFixture(deployWrappedTokenFixture);
            const amount = ethers.parseUnits("1000", 18);
            await peggedToken.mint(offeringContract.address, amount);
            await peggedToken.connect(offeringContract).approve(wrappedToken.target, amount);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, amount, 0);

            await time.increaseTo(maturityDate + 1);
            await wrappedToken.connect(user1).claimFinalTokens();

            await expect(wrappedToken.connect(user1).claimFinalTokens()).to.be.revertedWithCustomError(wrappedToken, "NoDeposit");
        });
    });

    describe("Transfer Restrictions", function () {
        it("Should prevent direct transfers", async function () {
            const { wrappedToken, user1, otherAccount } = await loadFixture(deployWrappedTokenFixture);
            await expect(wrappedToken.connect(user1).transfer(otherAccount.address, 100)).to.be.revertedWithCustomError(
                wrappedToken,
                "NoTransfers"
            );
        });

        it("Should prevent transfers from", async function () {
            const { wrappedToken, user1, otherAccount } = await loadFixture(deployWrappedTokenFixture);
            await expect(wrappedToken.connect(user1).transferFrom(user1.address, otherAccount.address, 100)).to.be.revertedWithCustomError(
                wrappedToken,
                "NoTransfers"
            );
        });
    });

    describe("Access Control", function () {
        it("Should allow admin to grant payout admin role", async function () {
            const { wrappedToken, user1 } = await loadFixture(deployWrappedTokenFixture);
            const PAYOUT_ADMIN_ROLE = await wrappedToken.PAYOUT_ADMIN_ROLE();
            
            await wrappedToken.grantPayoutAdminRole(user1.address);
            expect(await wrappedToken.hasRole(PAYOUT_ADMIN_ROLE, user1.address)).to.be.true;
        });

        it("Should allow admin to revoke payout admin role", async function () {
            const { wrappedToken, payoutAdmin } = await loadFixture(deployWrappedTokenFixture);
            const PAYOUT_ADMIN_ROLE = await wrappedToken.PAYOUT_ADMIN_ROLE();
            
            await wrappedToken.revokePayoutAdminRole(payoutAdmin.address);
            expect(await wrappedToken.hasRole(PAYOUT_ADMIN_ROLE, payoutAdmin.address)).to.be.false;
        });

        it("Should allow admin to pause and unpause", async function () {
            const { wrappedToken } = await loadFixture(deployWrappedTokenFixture);
            
            await wrappedToken.pause();
            expect(await wrappedToken.paused()).to.be.true;
            
            await wrappedToken.unpause();
            expect(await wrappedToken.paused()).to.be.false;
        });
    });
});