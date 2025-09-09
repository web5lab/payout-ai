const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("WRAPEDTOKEN (Unit)", function () {
    async function deployWrappedTokenFixture() {
        const [owner, offeringContract, user1, otherAccount] = await ethers.getSigners();
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const peggedToken = await MockERC20.deploy("Pegged Token", "PEGGED");
        const WrappedTokenFactory = await ethers.getContractFactory("awappedTokenFactory.deploy(
            "Wrapped Token", "wTKN", peggedToken.target, maturityDate, offeringContract.address
        );
        return { wrappedTo", "wTKNk, peggedToken.targete maturityDate, offeringContract.address
        );
        return { wrappedToken, peggedToken, offeringContract, user1, otherAccount, maturityDate };n, peggedToken, offeringContract, user1, otherAccount, maturityDate };
            "wTKN",
            peggedToken.target,
            payoutToken.target, // Pass payout token
            maturityDate,
            payoutRate, // Pass payout rate
            offeringContract.address
        );
        // Mint some payout tokens to the wrapped token contract for payouts
        await payoutToken.mint(wrappedToken.target, ethers.parseUnits("100000", 18));

            expect(await wrappedToken.maturityDate()).to.equal(maturityDate);
        });

        it("Should set the correct offering contract", async function () {
            const { wrappedToken, offeringContract } = await loadFixture(deployWrappedTokenFixture);
            expect(await wrappedToken.offeringContract()).to.equal(offeringContract.address);
        });

        it("Should revert with zero address for pegged token", async function () {
            const { offeringContract, maturityDate } = await loadFixture(deployWrappedTokenFixture);
            const WrappedTokenFactory = await ethers.getContractFactory("WRAPEDTOKEN");
            await expect(
                WrappedTokenFactory.deploy("Wrapped Token", "wTKN", ethers.ZeroAddress, maturityDate, offeringContract.address)
            ).to.be.revertedWithCustomError(WrappedTokenFactory, "InvalidStablecoin");
        });
    });

    describe("Registering Investments", function () {
        it("Should allow the offeringContract to register an investment", async function () {
            const { wrappedToken, peggedToken, offeringContract, user1 } = await loadFixture(deployWrappedTokenFixture);
            const amount = ethers.parseUnits("1000", 18);
            await peggedToken.mint(offeringContract.address, amount);
            await peggedToken.connect(offeringContract).approve(wrappedToken.target, amount);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, amount);
            expect(await wrappedToken.balanceOf(user1.address)).to.equal(amount);
            expect(await peggedToken.balanceOf(wrappedToken.target)).to.equal(amount);
        });

        it("Should revert if not called by the offering contract", async function () {
            const { wrappedToken, user1 } = await loadFixture(deployWrappedTokenFixture);
            const amount = ethers.parseUnits("1000", 18);
            await expect(
                wrappedToken.connect(user1).registerInvestment(user1.address, amount)
            ).to.be.revertedWith("Caller is not the offering contract");
        });

        it("Should revert if amount is zero", async function () {
            const { wrappedToken, offeringContract, user1 } = await loadFixture(deployWrappedTokenFixture);
            await expect(
                wrappedToken.connect(offeringContract).registerInvestment(user1.address, 0)
            ).to.be.revertedWithCustomError(wrappedToken, "InvalidAmount");
        });

        it("Should revert if peggedToken transfer fails", async function () {
            const { wrappedToken, peggedToken, offeringContract, user1 } = await loadFixture(deployWrappedTokenFixture);
            const amount = ethers.parseUnits("1000", 18);
            // No approval given
            await expect(
                wrappedToken.connect(offeringContract).registerInvestment(user1.address, amount)
            ).to.be.revertedWithCustomError(peggedToken, "ERC20InsufficientAllowance");
        });
    });

    describe("Claiming Final Tokens", function () {
        it("Should allow a user to claim their pegged tokens after maturity", async function () {
            const { wrappedToken, peggedToken, offeringContract, user1, maturityDate } = await loadFixture(deployWrappedTokenFixture);
            const amount = ethers.parseUnits("1000", 18);
            await peggedToken.mint(offeringContract.address, amount);
            await peggedToken.connect(offeringContract).approve(wrappedToken.target, amount);
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, amount);

            await time.increaseTo(maturityDate + 1);

            await expect(wrappedToken.connect(user1).claimFinalTokens()).to.changeTokenBalances(
                peggedToken,
                [wrappedToken, user1],
                [-amount, amount]
            );
            expect(await wrappedToken.balanceOf(user1.address)).to.equal(0);
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
            await wrappedToken.connect(offeringContract).registerInvestment(user1.address, amount);

            await time.increaseTo(maturityDate + 1);
            await wrappedToken.connect(user1).claimFinalTokens();

            await expect(wrappedToken.connect(user1).claimFinalTokens()).to.be.revertedWithCustomError(wrappedToken, "AlreadyClaimed");
        });
    });

    describe("Transfer Restrictions", function () {
        it("Should prevent direct transfers", async function () {
            const { wrappedToken, user1, otherAccount } = await loadFixture(deployWrappedTokenFixture);
            await expect(wrappedToken.connect(user1).transfer(otherAccount.address, 100)).to.be.revertedWithCustomError(
                wrappedToken,
                "NoTransfersAllowed"
            );
        });

        it("Should prevent transfers from", async function () {
            const { wrappedToken, user1, otherAccount } = await loadFixture(deployWrappedTokenFixture);
            await expect(wrappedToken.connect(user1).transferFrom(user1.address, otherAccount.address, 100)).to.be.revertedWithCustomError(
                wrappedToken,
                "NoTransfersAllowed"
            );
        });
    });
});
