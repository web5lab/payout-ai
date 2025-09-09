const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Escrow Contract (Unit)", function () {
    async function deployEscrowFixture() {
        const [owner, offeringContract, investor, treasury, otherAccount] = await ethers.getSigners();
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const paymentToken = await MockERC20.deploy("Payment Token", "PAY");
        const Escrow = await ethers.getContractFactory("Escrow");
        const escrow = await Escrow.deploy({ owner: owner.address });
        return { escrow, owner, offeringContract, investor, treasury, paymentToken, otherAccount };
    }

    describe("Deployment", function () {
        it("Should set the correct owner", async function () {
            const { escrow, owner } = await loadFixture(deployEscrowFixture);
            expect(await escrow.owner()).to.equal(owner.address);
        });

        it("Should revert if owner address is zero", async function () {
            const Escrow = await ethers.getContractFactory("Escrow");
            await expect(Escrow.deploy({ owner: ethers.ZeroAddress })).to.be.revertedWithCustomError(Escrow, "OwnableInvalidOwner");
        });
    });

    describe("Native Deposits", function () {
        it("Should accept native ETH deposits when called by offering contract", async function () {
            const { escrow, offeringContract, investor } = await loadFixture(deployEscrowFixture);
            const depositAmount = ethers.parseEther("1.0");
            await expect(escrow.connect(offeringContract).depositNative(offeringContract.address, investor.address, { value: depositAmount }))
                .to.emit(escrow, "Deposited")
                .withArgs(offeringContract.address, investor.address, ethers.ZeroAddress, depositAmount);
            const deposit = await escrow.deposits(offeringContract.address, investor.address);
            expect(deposit.amount).to.equal(depositAmount);
            expect(deposit.token).to.equal(ethers.ZeroAddress);
        });

        it("Should revert native deposit if not called by offering contract", async function () {
            const { escrow, offeringContract, investor } = await loadFixture(deployEscrowFixture);
            const depositAmount = ethers.parseEther("1.0");
            await expect(escrow.connect(investor).depositNative(offeringContract.address, investor.address, { value: depositAmount }))
                .to.be.revertedWith("Only offering contract can deposit");
        });

        it("Should revert native deposit if amount is zero", async function () {
            const { escrow, offeringContract, investor } = await loadFixture(deployEscrowFixture);
            await expect(escrow.connect(offeringContract).depositNative(offeringContract.address, investor.address, { value: 0 })).to.be.revertedWith("Invalid amount");
        });

        it("Should revert native deposit if investor address is zero", async function () {
            const { escrow, offeringContract } = await loadFixture(deployEscrowFixture);
            const depositAmount = ethers.parseEther("1.0");
            await expect(escrow.connect(offeringContract).depositNative(offeringContract.address, ethers.ZeroAddress, { value: depositAmount }))
                .to.be.revertedWith("Invalid investor address");
        });

        it("Should revert if refunds are already enabled", async function () {
            const { escrow, owner, offeringContract, investor } = await loadFixture(deployEscrowFixture);
            const depositAmount = ethers.parseEther("1.0");
            
            await escrow.connect(owner).enableRefunds();
            await expect(escrow.connect(offeringContract).depositNative(offeringContract.address, investor.address, { value: depositAmount }))
                .to.be.revertedWith("Refunds already enabled");
        });
    });

    describe("ERC20 Deposits", function () {
        it("Should accept ERC20 token deposits", async function () {
            const { escrow, offeringContract, paymentToken } = await loadFixture(deployEscrowFixture);
            const depositAmount = ethers.parseUnits("100", 18);
            await paymentToken.mint(offeringContract.address, depositAmount);
            await paymentToken.connect(offeringContract).approve(escrow.target, depositAmount);
            await expect(escrow.connect(offeringContract).depositToken(offeringContract.address, offeringContract.address, paymentToken.target, depositAmount))
                .to.emit(escrow, "Deposited")
                .withArgs(offeringContract.address, offeringContract.address, paymentToken.target, depositAmount);
            const deposit = await escrow.deposits(offeringContract.address, offeringContract.address);
            expect(deposit.amount).to.equal(depositAmount);
            expect(deposit.token).to.equal(paymentToken.target);
        });

        it("Should revert ERC20 deposit if token address is zero", async function () {
            const { escrow, offeringContract } = await loadFixture(deployEscrowFixture);
            const depositAmount = ethers.parseUnits("100", 18);
            await expect(escrow.connect(offeringContract).depositToken(offeringContract.address, offeringContract.address, ethers.ZeroAddress, depositAmount)).to.be.revertedWith("Invalid token");
        });

        it("Should revert ERC20 deposit if amount is zero", async function () {
            const { escrow, offeringContract, paymentToken } = await loadFixture(deployEscrowFixture);
            await expect(escrow.connect(offeringContract).depositToken(offeringContract.address, offeringContract.address, paymentToken.target, 0)).to.be.revertedWith("Invalid amount");
        });

        it("Should revert if an ERC20 deposit is attempted without allowance", async function () {
            const { escrow, offeringContract, paymentToken } = await loadFixture(deployEscrowFixture);
            const depositAmount = ethers.parseUnits("100", 18);
            await paymentToken.mint(offeringContract.address, depositAmount);
            await expect(escrow.connect(offeringContract).depositToken(offeringContract.address, offeringContract.address, paymentToken.target, depositAmount))
                .to.be.revertedWithCustomError(paymentToken, "ERC20InsufficientAllowance");
        });

        it("Should revert if refunds are already enabled", async function () {
            const { escrow, owner, offeringContract, paymentToken } = await loadFixture(deployEscrowFixture);
            const depositAmount = ethers.parseUnits("100", 18);
            await paymentToken.mint(offeringContract.address, depositAmount);
            await paymentToken.connect(offeringContract).approve(escrow.target, depositAmount);
            
            await escrow.connect(owner).enableRefunds();
            await expect(escrow.connect(offeringContract).depositToken(offeringContract.address, offeringContract.address, paymentToken.target, depositAmount))
                .to.be.revertedWith("Refunds already enabled");
        });
    });

    describe("Refunds", function () {
        it("Should allow owner to refund native deposit to investor", async function () {
            const { escrow, owner, offeringContract, investor } = await loadFixture(deployEscrowFixture);
            const depositAmount = ethers.parseEther("1.0");
            await escrow.connect(offeringContract).depositNative(offeringContract.address, investor.address, { value: depositAmount });
            await escrow.connect(owner).enableRefunds();
            const tx = escrow.connect(owner).refund(offeringContract.address, investor.address);
            await expect(tx)
                .to.emit(escrow, "Refunded")
                .withArgs(offeringContract.address, investor.address, ethers.ZeroAddress, depositAmount);
            await expect(tx).to.changeEtherBalances(
                [escrow, investor],
                [-depositAmount, depositAmount]
            );
            const deposit = await escrow.deposits(offeringContract.address, investor.address);
            expect(deposit.amount).to.equal(0);
        });

        it("Should allow owner to refund ERC20 deposit to investor", async function () {
            const { escrow, owner, offeringContract, investor, paymentToken } = await loadFixture(deployEscrowFixture);
            const depositAmount = ethers.parseUnits("100", 18);
            await paymentToken.mint(offeringContract.address, depositAmount);
            await paymentToken.connect(offeringContract).approve(escrow.target, depositAmount);
            await escrow.connect(offeringContract).depositToken(offeringContract.address, investor.address, paymentToken.target, depositAmount);
            await escrow.connect(owner).enableRefunds();
            const tx = escrow.connect(owner).refund(offeringContract.address, investor.address);
            await expect(tx)
                .to.emit(escrow, "Refunded")
                .withArgs(offeringContract.address, investor.address, paymentToken.target, depositAmount);
            await expect(tx).to.changeTokenBalances(
                paymentToken,
                [escrow, investor],
                [-depositAmount, depositAmount]
            );
            const deposit = await escrow.deposits(offeringContract.address, investor.address);
            expect(deposit.amount).to.equal(0);
        });

        it("Should revert refund if refunds are not enabled", async function () {
            const { escrow, owner, offeringContract, investor } = await loadFixture(deployEscrowFixture);
            const depositAmount = ethers.parseEther("1.0");
            await escrow.connect(offeringContract).depositNative(offeringContract.address, investor.address, { value: depositAmount });
            // Refunds are not enabled
            await expect(escrow.connect(owner).refund(offeringContract.address, investor.address)).to.be.revertedWith("Refunds not enabled");
        });

        it("Should revert refund if investor has no deposit", async function () {
            const { escrow, owner, offeringContract, otherAccount } = await loadFixture(deployEscrowFixture);
            await escrow.connect(owner).enableRefunds();
            await expect(escrow.connect(owner).refund(offeringContract.address, otherAccount.address)).to.be.revertedWith("Nothing to refund");
        });

        it("Should revert if non-owner tries to refund", async function () {
            const { escrow, owner, offeringContract, investor, otherAccount } = await loadFixture(deployEscrowFixture);
            const depositAmount = ethers.parseEther("1.0");
            await escrow.connect(offeringContract).depositNative(offeringContract.address, investor.address, { value: depositAmount });
            await escrow.connect(owner).enableRefunds();
            await expect(escrow.connect(otherAccount).refund(offeringContract.address, investor.address)).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
        });

        it("Should revert if non-owner tries to enable refunds", async function () {
            const { escrow, otherAccount } = await loadFixture(deployEscrowFixture);
            await expect(escrow.connect(otherAccount).enableRefunds()).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
        });
    });

    describe("Withdrawals", function () {
        it("Should allow owner to withdraw native ETH", async function () {
            const { escrow, owner, investor, treasury } = await loadFixture(deployEscrowFixture);
            const depositAmount = ethers.parseEther("1.0");
            // Send ETH directly to escrow for testing withdrawal
            await investor.sendTransaction({ to: escrow.target, value: depositAmount });
            await expect(escrow.connect(owner).withdraw(ethers.ZeroAddress, depositAmount, treasury.address)).to.changeEtherBalances(
                [escrow, treasury],
                [-depositAmount, depositAmount]
            );
        });

        it("Should allow owner to withdraw ERC20 tokens", async function () {
            const { escrow, owner, offeringContract, treasury, paymentToken } = await loadFixture(deployEscrowFixture);
            const depositAmount = ethers.parseUnits("100", 18);
            await paymentToken.mint(offeringContract.address, depositAmount);
            await paymentToken.connect(offeringContract).approve(escrow.target, depositAmount);
            await escrow.connect(offeringContract).depositToken(offeringContract.address, offeringContract.address, paymentToken.target, depositAmount);
            await expect(escrow.connect(owner).withdraw(paymentToken.target, depositAmount, treasury.address)).to.changeTokenBalances(
                paymentToken,
                [escrow, treasury],
                [-depositAmount, depositAmount]
            );
        });

        it("Should revert withdrawal if not owner", async function () {
            const { escrow, investor, treasury } = await loadFixture(deployEscrowFixture);
            const depositAmount = ethers.parseEther("1.0");
            await investor.sendTransaction({ to: escrow.target, value: depositAmount });
            await expect(escrow.connect(investor).withdraw(ethers.ZeroAddress, depositAmount, treasury.address)).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
        });

        it("Should revert withdrawal to zero address", async function () {
            const { escrow, owner, investor } = await loadFixture(deployEscrowFixture);
            const depositAmount = ethers.parseEther("1.0");
            await investor.sendTransaction({ to: escrow.target, value: depositAmount });
            await expect(escrow.connect(owner).withdraw(ethers.ZeroAddress, depositAmount, ethers.ZeroAddress)).to.be.revertedWith("Invalid recipient");
        });

        it("Should revert ETH withdrawal if insufficient balance", async function () {
            const { escrow, owner, treasury } = await loadFixture(deployEscrowFixture);
            const withdrawAmount = ethers.parseEther("1.0");
            await expect(escrow.connect(owner).withdraw(ethers.ZeroAddress, withdrawAmount, treasury.address)).to.be.revertedWith("Insufficient ETH");
        });

        it("Should revert ERC20 withdrawal if insufficient balance", async function () {
            const { escrow, owner, treasury, paymentToken } = await loadFixture(deployEscrowFixture);
            const withdrawAmount = ethers.parseUnits("100", 18);
            await expect(escrow.connect(owner).withdraw(paymentToken.target, withdrawAmount, treasury.address)).to.be.revertedWith("Insufficient tokens");
        });
    });
});
