const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Escrow Contract", function () {
    async function deployEscrowFixture() {
        const [owner, offeringContract, investor1, investor2, investmentManager, offeringOwner] = await ethers.getSigners();
        
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const paymentToken = await MockERC20.deploy("Payment Token", "PAY");
        
        const Escrow = await ethers.getContractFactory("Escrow");
        const escrow = await Escrow.deploy({ owner: owner.address });
        
        return { 
            escrow, 
            owner, 
            offeringContract, 
            investor1, 
            investor2, 
            investmentManager,
            offeringOwner,
            paymentToken 
        };
    }

    describe("Deployment", function () {
        it("Should set the correct owner", async function () {
            const { escrow, owner } = await loadFixture(deployEscrowFixture);
            expect(await escrow.owner()).to.equal(owner.address);
        });

        it("Should revert with zero address owner", async function () {
            const Escrow = await ethers.getContractFactory("Escrow");
            await expect(Escrow.deploy({ owner: ethers.ZeroAddress }))
                .to.be.revertedWith("Invalid owner");
        });
    });

    describe("Investment Manager Configuration", function () {
        it("Should set investment manager correctly", async function () {
            const { escrow, owner, investmentManager } = await loadFixture(deployEscrowFixture);
            
            await escrow.connect(owner).setInvestmentManager(investmentManager.address);
            expect(await escrow.investmentManager()).to.equal(investmentManager.address);
        });

        it("Should revert with zero address for investment manager", async function () {
            const { escrow, owner } = await loadFixture(deployEscrowFixture);
            
            await expect(escrow.connect(owner).setInvestmentManager(ethers.ZeroAddress))
                .to.be.revertedWith("Invalid investment manager address");
        });
    });

    describe("Offering Registration", function () {
        it("Should register offering correctly", async function () {
            const { escrow, offeringContract, offeringOwner } = await loadFixture(deployEscrowFixture);
            
            await expect(escrow.registerOffering(offeringContract.address, offeringOwner.address))
                .to.emit(escrow, "OfferingRegistered")
                .withArgs(offeringContract.address, offeringOwner.address);
            
            const offeringInfo = await escrow.getOfferingInfo(offeringContract.address);
            expect(offeringInfo.owner).to.equal(offeringOwner.address);
            expect(offeringInfo.isRegistered).to.be.true;
            expect(offeringInfo.isFinalized).to.be.false;
        });

        it("Should prevent duplicate offering registration", async function () {
            const { escrow, offeringContract, offeringOwner } = await loadFixture(deployEscrowFixture);
            
            await escrow.registerOffering(offeringContract.address, offeringOwner.address);
            
            await expect(escrow.registerOffering(offeringContract.address, offeringOwner.address))
                .to.be.revertedWith("Offering already registered");
        });
    });

    describe("Native ETH Deposits", function () {
        it("Should accept native ETH deposits from offering contract", async function () {
            const { escrow, offeringContract, investor1, offeringOwner } = await loadFixture(deployEscrowFixture);
            
            await escrow.registerOffering(offeringContract.address, offeringOwner.address);
            
            const depositAmount = ethers.parseEther("1.0");
            await expect(escrow.connect(offeringContract).depositNative(
                offeringContract.address, 
                investor1.address, 
                { value: depositAmount }
            ))
                .to.emit(escrow, "Deposited")
                .withArgs(offeringContract.address, investor1.address, ethers.ZeroAddress, depositAmount);
            
            const depositInfo = await escrow.getDepositInfo(offeringContract.address, investor1.address);
            expect(depositInfo.amount).to.equal(depositAmount);
            expect(depositInfo.token).to.equal(ethers.ZeroAddress);
            
            expect(await escrow.getTotalETH(offeringContract.address)).to.equal(depositAmount);
        });

        it("Should accumulate multiple ETH deposits from same investor", async function () {
            const { escrow, offeringContract, investor1, offeringOwner } = await loadFixture(deployEscrowFixture);
            
            await escrow.registerOffering(offeringContract.address, offeringOwner.address);
            
            const deposit1 = ethers.parseEther("0.5");
            const deposit2 = ethers.parseEther("0.3");
            
            await escrow.connect(offeringContract).depositNative(
                offeringContract.address, 
                investor1.address, 
                { value: deposit1 }
            );
            
            await escrow.connect(offeringContract).depositNative(
                offeringContract.address, 
                investor1.address, 
                { value: deposit2 }
            );
            
            const depositInfo = await escrow.getDepositInfo(offeringContract.address, investor1.address);
            expect(depositInfo.amount).to.equal(deposit1 + deposit2);
        });

        it("Should revert ETH deposit if not from offering contract", async function () {
            const { escrow, investor1, offeringOwner } = await loadFixture(deployEscrowFixture);
            
            await escrow.registerOffering(investor1.address, offeringOwner.address);
            
            const depositAmount = ethers.parseEther("1.0");
            await expect(escrow.connect(investor1).depositNative(
                investor1.address, 
                investor1.address, 
                { value: depositAmount }
            )).to.be.revertedWith("Only offering contract can deposit");
        });

        it("Should revert if offering not registered", async function () {
            const { escrow, offeringContract, investor1 } = await loadFixture(deployEscrowFixture);
            
            const depositAmount = ethers.parseEther("1.0");
            await expect(escrow.connect(offeringContract).depositNative(
                offeringContract.address, 
                investor1.address, 
                { value: depositAmount }
            )).to.be.revertedWith("Offering not registered");
        });
    });

    describe("ERC20 Token Deposits", function () {
        it("Should accept ERC20 token deposits", async function () {
            const { escrow, offeringContract, investor1, offeringOwner, paymentToken } = await loadFixture(deployEscrowFixture);
            
            await escrow.registerOffering(offeringContract.address, offeringOwner.address);
            
            const depositAmount = ethers.parseUnits("1000", 18);
            await paymentToken.mint(offeringContract.address, depositAmount);
            await paymentToken.connect(offeringContract).approve(await escrow.getAddress(), depositAmount);
            
            await expect(escrow.connect(offeringContract).depositToken(
                offeringContract.address,
                investor1.address,
                await paymentToken.getAddress(),
                depositAmount
            ))
                .to.emit(escrow, "Deposited")
                .withArgs(offeringContract.address, investor1.address, await paymentToken.getAddress(), depositAmount);
            
            const depositInfo = await escrow.getDepositInfo(offeringContract.address, investor1.address);
            expect(depositInfo.amount).to.equal(depositAmount);
            expect(depositInfo.token).to.equal(await paymentToken.getAddress());
            
            expect(await escrow.getTotalTokenAmount(offeringContract.address, await paymentToken.getAddress()))
                .to.equal(depositAmount);
        });

        it("Should handle token type switching with refund", async function () {
            const { escrow, offeringContract, investor1, offeringOwner, paymentToken } = await loadFixture(deployEscrowFixture);
            
            await escrow.registerOffering(offeringContract.address, offeringOwner.address);
            
            // First deposit ETH
            const ethAmount = ethers.parseEther("1.0");
            await escrow.connect(offeringContract).depositNative(
                offeringContract.address, 
                investor1.address, 
                { value: ethAmount }
            );
            
            // Then deposit ERC20 (should refund ETH first)
            const tokenAmount = ethers.parseUnits("1000", 18);
            await paymentToken.mint(offeringContract.address, tokenAmount);
            await paymentToken.connect(offeringContract).approve(await escrow.getAddress(), tokenAmount);
            
            const initialBalance = await ethers.provider.getBalance(investor1.address);
            
            await escrow.connect(offeringContract).depositToken(
                offeringContract.address,
                investor1.address,
                await paymentToken.getAddress(),
                tokenAmount
            );
            
            // Check ETH was refunded
            const finalBalance = await ethers.provider.getBalance(investor1.address);
            expect(finalBalance).to.be.gt(initialBalance);
            
            // Check new deposit is ERC20
            const depositInfo = await escrow.getDepositInfo(offeringContract.address, investor1.address);
            expect(depositInfo.token).to.equal(await paymentToken.getAddress());
            expect(depositInfo.amount).to.equal(tokenAmount);
        });
    });

    describe("Offering Finalization", function () {
        it("Should allow offering owner to finalize", async function () {
            const { escrow, offeringContract, investor1, offeringOwner, paymentToken } = await loadFixture(deployEscrowFixture);
            
            await escrow.registerOffering(offeringContract.address, offeringOwner.address);
            
            // Make deposits
            const depositAmount = ethers.parseUnits("1000", 18);
            await paymentToken.mint(offeringContract.address, depositAmount);
            await paymentToken.connect(offeringContract).approve(await escrow.getAddress(), depositAmount);
            await escrow.connect(offeringContract).depositToken(
                offeringContract.address,
                investor1.address,
                await paymentToken.getAddress(),
                depositAmount
            );
            
            // Mock offering contract with finalizeOffering function
            const MockOffering = await ethers.getContractFactory("MockERC20"); // Using MockERC20 as placeholder
            const mockOffering = await MockOffering.deploy("Mock", "MOCK");
            
            // Finalize offering
            await expect(escrow.connect(offeringOwner).finalizeOffering(offeringContract.address))
                .to.emit(escrow, "OfferingFinalized");
            
            const offeringInfo = await escrow.getOfferingInfo(offeringContract.address);
            expect(offeringInfo.isFinalized).to.be.true;
        });

        it("Should transfer funds to offering owner on finalization", async function () {
            const { escrow, offeringContract, investor1, offeringOwner, paymentToken } = await loadFixture(deployEscrowFixture);
            
            await escrow.registerOffering(offeringContract.address, offeringOwner.address);
            
            const depositAmount = ethers.parseUnits("1000", 18);
            await paymentToken.mint(offeringContract.address, depositAmount);
            await paymentToken.connect(offeringContract).approve(await escrow.getAddress(), depositAmount);
            await escrow.connect(offeringContract).depositToken(
                offeringContract.address,
                investor1.address,
                await paymentToken.getAddress(),
                depositAmount
            );
            
            const initialBalance = await paymentToken.balanceOf(offeringOwner.address);
            
            await escrow.connect(offeringOwner).finalizeOffering(offeringContract.address);
            
            const finalBalance = await paymentToken.balanceOf(offeringOwner.address);
            expect(finalBalance - initialBalance).to.equal(depositAmount);
        });

        it("Should prevent finalization if refunds enabled", async function () {
            const { escrow, offeringContract, offeringOwner, owner } = await loadFixture(deployEscrowFixture);
            
            await escrow.registerOffering(offeringContract.address, offeringOwner.address);
            await escrow.connect(owner).enableRefundsByOwner(offeringContract.address);
            
            await expect(escrow.connect(offeringOwner).finalizeOffering(offeringContract.address))
                .to.be.revertedWith("Refunds enabled - cannot finalize");
        });
    });

    describe("Refund System", function () {
        it("Should enable refunds by owner", async function () {
            const { escrow, offeringContract, offeringOwner, owner, investmentManager } = await loadFixture(deployEscrowFixture);
            
            await escrow.registerOffering(offeringContract.address, offeringOwner.address);
            await escrow.connect(owner).setInvestmentManager(investmentManager.address);
            
            await expect(escrow.connect(owner).enableRefundsByOwner(offeringContract.address))
                .to.emit(escrow, "RefundsEnabled")
                .withArgs(offeringContract.address);
            
            expect(await escrow.refundsEnabled(offeringContract.address)).to.be.true;
        });

        it("Should enable refunds by offering contract", async function () {
            const { escrow, offeringContract, offeringOwner, investmentManager } = await loadFixture(deployEscrowFixture);
            
            await escrow.registerOffering(offeringContract.address, offeringOwner.address);
            await escrow.connect(offeringContract.address).setInvestmentManager(investmentManager.address);
            
            await expect(escrow.connect(offeringContract).enableRefundsByOffering())
                .to.emit(escrow, "RefundsEnabled")
                .withArgs(offeringContract.address);
        });

        it("Should process refunds through investment manager", async function () {
            const { escrow, offeringContract, investor1, offeringOwner, owner, investmentManager, paymentToken } = await loadFixture(deployEscrowFixture);
            
            await escrow.registerOffering(offeringContract.address, offeringOwner.address);
            await escrow.connect(owner).setInvestmentManager(investmentManager.address);
            
            // Make deposit
            const depositAmount = ethers.parseUnits("1000", 18);
            await paymentToken.mint(offeringContract.address, depositAmount);
            await paymentToken.connect(offeringContract).approve(await escrow.getAddress(), depositAmount);
            await escrow.connect(offeringContract).depositToken(
                offeringContract.address,
                investor1.address,
                await paymentToken.getAddress(),
                depositAmount
            );
            
            // Enable refunds
            await escrow.connect(owner).enableRefundsByOwner(offeringContract.address);
            
            // Process refund
            const initialBalance = await paymentToken.balanceOf(investor1.address);
            
            await expect(escrow.connect(investmentManager).refund(offeringContract.address, investor1.address))
                .to.emit(escrow, "Refunded")
                .withArgs(offeringContract.address, investor1.address, await paymentToken.getAddress(), depositAmount);
            
            const finalBalance = await paymentToken.balanceOf(investor1.address);
            expect(finalBalance - initialBalance).to.equal(depositAmount);
            
            // Check deposit is cleared
            const depositInfo = await escrow.getDepositInfo(offeringContract.address, investor1.address);
            expect(depositInfo.amount).to.equal(0);
        });

        it("Should revert refund if not called by investment manager", async function () {
            const { escrow, offeringContract, investor1, offeringOwner, owner } = await loadFixture(deployEscrowFixture);
            
            await escrow.registerOffering(offeringContract.address, offeringOwner.address);
            await escrow.connect(owner).enableRefundsByOwner(offeringContract.address);
            
            await expect(escrow.connect(investor1).refund(offeringContract.address, investor1.address))
                .to.be.revertedWith("Only InvestmentManager can call this function");
        });
    });

    describe("Investment Totals Tracking", function () {
        it("Should track investment totals correctly", async function () {
            const { escrow, offeringContract, investor1, investor2, offeringOwner, paymentToken } = await loadFixture(deployEscrowFixture);
            
            await escrow.registerOffering(offeringContract.address, offeringOwner.address);
            
            // ETH deposit
            const ethAmount = ethers.parseEther("2.0");
            await escrow.connect(offeringContract).depositNative(
                offeringContract.address, 
                investor1.address, 
                { value: ethAmount }
            );
            
            // Token deposit
            const tokenAmount = ethers.parseUnits("1000", 18);
            await paymentToken.mint(offeringContract.address, tokenAmount);
            await paymentToken.connect(offeringContract).approve(await escrow.getAddress(), tokenAmount);
            await escrow.connect(offeringContract).depositToken(
                offeringContract.address,
                investor2.address,
                await paymentToken.getAddress(),
                tokenAmount
            );
            
            // Check totals
            expect(await escrow.getTotalETH(offeringContract.address)).to.equal(ethAmount);
            expect(await escrow.getTotalTokenAmount(offeringContract.address, await paymentToken.getAddress()))
                .to.equal(tokenAmount);
            
            const summary = await escrow.getInvestmentSummary(offeringContract.address);
            expect(summary.totalETH).to.equal(ethAmount);
            expect(summary.tokens.length).to.equal(1);
            expect(summary.tokens[0]).to.equal(await paymentToken.getAddress());
            expect(summary.tokenAmounts[0]).to.equal(tokenAmount);
        });
    });

    describe("Emergency Withdrawals", function () {
        it("Should allow owner to withdraw stuck funds", async function () {
            const { escrow, owner, investor1, paymentToken } = await loadFixture(deployEscrowFixture);
            
            // Send tokens directly to escrow (simulating stuck funds)
            const stuckAmount = ethers.parseUnits("500", 18);
            await paymentToken.mint(await escrow.getAddress(), stuckAmount);
            
            await expect(escrow.connect(owner).withdraw(
                await paymentToken.getAddress(),
                stuckAmount,
                investor1.address
            ))
                .to.emit(escrow, "Withdrawn")
                .withArgs(await paymentToken.getAddress(), stuckAmount, investor1.address);
            
            expect(await paymentToken.balanceOf(investor1.address)).to.equal(stuckAmount);
        });

        it("Should allow owner to withdraw stuck ETH", async function () {
            const { escrow, owner, investor1 } = await loadFixture(deployEscrowFixture);
            
            // Send ETH directly to escrow
            const stuckAmount = ethers.parseEther("1.0");
            await owner.sendTransaction({ to: await escrow.getAddress(), value: stuckAmount });
            
            await expect(escrow.connect(owner).withdraw(
                ethers.ZeroAddress,
                stuckAmount,
                investor1.address
            )).to.changeEtherBalances([escrow, investor1], [-stuckAmount, stuckAmount]);
        });
    });
});