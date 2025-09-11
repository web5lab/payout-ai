const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("InvestmentManager Contract", function () {
    async function deployInvestmentManagerFixture() {
        const [admin, tokenOwner, treasuryOwner, kybValidator, investor1, investor2, investor3] = await ethers.getSigners();

        // Deploy mock tokens
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const saleToken = await MockERC20.deploy("Sale Token", "SALE");
        const paymentToken = await MockERC20.deploy("Payment Token", "PAY");
        const payoutToken = await MockERC20.deploy("Payout Token", "PAYOUT");

        // Deploy mock oracles
        const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
        const payOracle = await MockV3Aggregator.deploy(ethers.parseUnits("1.0", 18), true);
        const ethOracle = await MockV3Aggregator.deploy(ethers.parseUnits("2000", 18), true);

        // Deploy core infrastructure
        const WrappedTokenFactory = await ethers.getContractFactory("WrappedTokenFactory");
        const wrappedTokenFactory = await WrappedTokenFactory.deploy();

        const OfferingFactory = await ethers.getContractFactory("OfferingFactory");
        const offeringFactory = await OfferingFactory.deploy(await wrappedTokenFactory.getAddress());

        const InvestmentManager = await ethers.getContractFactory("InvestmentManager");
        const investmentManager = await InvestmentManager.deploy();

        const Escrow = await ethers.getContractFactory("Escrow");
        const escrow = await Escrow.deploy({ owner: treasuryOwner.address });

        // Configure system
        await investmentManager.connect(admin).setEscrowContract(await escrow.getAddress());
        await escrow.connect(treasuryOwner).setInvestmentManager(await investmentManager.getAddress());
        await offeringFactory.connect(admin).setUSDTConfig(
            await paymentToken.getAddress(),
            await payOracle.getAddress()
        );

        return {
            admin, tokenOwner, treasuryOwner, kybValidator, investor1, investor2, investor3,
            saleToken, paymentToken, payoutToken,
            payOracle, ethOracle,
            wrappedTokenFactory, offeringFactory, investmentManager, escrow
        };
    }

    async function createTestOffering(fixture, config = {}) {
        const { 
            admin, tokenOwner, saleToken, paymentToken, payoutToken, 
            payOracle, ethOracle, offeringFactory, escrow 
        } = fixture;

        const now = await time.latest();
        const offeringConfig = {
            saleToken: await saleToken.getAddress(),
            minInvestment: ethers.parseUnits("100", 18),
            maxInvestment: ethers.parseUnits("5000", 18),
            startDate: now + 300,
            endDate: now + 300 + 3600,
            apyEnabled: config.apyEnabled || false,
            softCap: ethers.parseUnits("10000", 18),
            fundraisingCap: ethers.parseUnits("100000", 18),
            tokenPrice: ethers.parseUnits("0.5", 18),
            tokenOwner: tokenOwner.address,
            escrowAddress: await escrow.getAddress(),
            investmentManager: fixture.investmentManager.address,
            payoutTokenAddress: await payoutToken.getAddress(),
            payoutRate: 1200,
            payoutPeriodDuration: 2592000,
            maturityDate: now + 300 + 31536000
        };

        const paymentTokens = [
            await paymentToken.getAddress(),
            ethers.ZeroAddress
        ];
        const oracles = [
            await payOracle.getAddress(),
            await ethOracle.getAddress()
        ];

        const tx = await offeringFactory.connect(admin).createOfferingWithPaymentTokens(
            offeringConfig,
            paymentTokens,
            oracles
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find(log => log.fragment && log.fragment.name === 'OfferingDeployed');
        const offeringAddress = event.args.offeringAddress;
        const offering = await ethers.getContractAt("Offering", offeringAddress);

        // Register offering and transfer tokens
        await escrow.connect(fixture.treasuryOwner).registerOffering(offeringAddress, tokenOwner.address);
        await saleToken.mint(tokenOwner.address, ethers.parseUnits("200000", 18));
        await saleToken.connect(tokenOwner).transfer(offeringAddress, ethers.parseUnits("200000", 18));

        return { offering, offeringAddress, config: offeringConfig };
    }

    describe("Deployment and Configuration", function () {
        it("Should deploy with correct owner", async function () {
            const { investmentManager, admin } = await loadFixture(deployInvestmentManagerFixture);
            expect(await investmentManager.owner()).to.equal(admin.address);
        });

        it("Should set escrow contract correctly", async function () {
            const { investmentManager, escrow, admin } = await loadFixture(deployInvestmentManagerFixture);
            expect(await investmentManager.escrowContract()).to.equal(await escrow.getAddress());
        });
    });

    describe("KYB Validator Management", function () {
        it("Should set initial KYB validator", async function () {
            const { investmentManager, admin, kybValidator } = await loadFixture(deployInvestmentManagerFixture);
            
            await expect(investmentManager.connect(admin).setKYBValidator(kybValidator.address))
                .to.emit(investmentManager, "KYBValidatorAdded")
                .withArgs(kybValidator.address);
            
            expect(await investmentManager.isKYBValidator(kybValidator.address)).to.be.true;
            expect(await investmentManager.getKYBValidatorCount()).to.equal(1);
        });

        it("Should add multiple KYB validators", async function () {
            const { investmentManager, admin, kybValidator, investor1, investor2 } = await loadFixture(deployInvestmentManagerFixture);
            
            await investmentManager.connect(admin).setKYBValidator(kybValidator.address);
            await investmentManager.connect(admin).addKYBValidator(investor1.address);
            await investmentManager.connect(admin).addKYBValidator(investor2.address);
            
            expect(await investmentManager.getKYBValidatorCount()).to.equal(3);
            expect(await investmentManager.isKYBValidator(investor1.address)).to.be.true;
            expect(await investmentManager.isKYBValidator(investor2.address)).to.be.true;
        });

        it("Should remove KYB validator", async function () {
            const { investmentManager, admin, kybValidator, investor1 } = await loadFixture(deployInvestmentManagerFixture);
            
            await investmentManager.connect(admin).setKYBValidator(kybValidator.address);
            await investmentManager.connect(admin).addKYBValidator(investor1.address);
            
            await expect(investmentManager.connect(admin).removeKYBValidator(investor1.address))
                .to.emit(investmentManager, "KYBValidatorRemoved")
                .withArgs(investor1.address);
            
            expect(await investmentManager.isKYBValidator(investor1.address)).to.be.false;
            expect(await investmentManager.getKYBValidatorCount()).to.equal(1);
        });

        it("Should prevent removing last validator", async function () {
            const { investmentManager, admin, kybValidator } = await loadFixture(deployInvestmentManagerFixture);
            
            await investmentManager.connect(admin).setKYBValidator(kybValidator.address);
            
            await expect(investmentManager.connect(admin).removeKYBValidator(kybValidator.address))
                .to.be.revertedWith("Cannot remove last validator");
        });
    });

    describe("Investment Routing", function () {
        it("Should route ERC20 investment successfully", async function () {
            const fixture = await loadFixture(deployInvestmentManagerFixture);
            const { investmentManager, investor1, paymentToken } = fixture;
            const { offeringAddress, config } = await createTestOffering(fixture);

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("500", 18);
            await paymentToken.mint(investor1.address, investmentAmount);
            await paymentToken.connect(investor1).approve(offeringAddress, investmentAmount);

            await expect(investmentManager.connect(investor1).routeInvestment(
                offeringAddress,
                await paymentToken.getAddress(),
                investmentAmount
            ))
                .to.emit(investmentManager, "InvestmentRouted")
                .withArgs(investor1.address, offeringAddress, await paymentToken.getAddress(), investmentAmount, 0);
        });

        it("Should route native ETH investment successfully", async function () {
            const fixture = await loadFixture(deployInvestmentManagerFixture);
            const { investmentManager, investor1 } = fixture;
            const { offeringAddress, config } = await createTestOffering(fixture);

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("0.1", 18); // 0.1 ETH
            
            await expect(investmentManager.connect(investor1).routeInvestment(
                offeringAddress,
                ethers.ZeroAddress,
                investmentAmount,
                { value: investmentAmount }
            ))
                .to.emit(investmentManager, "InvestmentRouted")
                .withArgs(investor1.address, offeringAddress, ethers.ZeroAddress, investmentAmount, 0);
        });

        it("Should handle APY-enabled offering investment", async function () {
            const fixture = await loadFixture(deployInvestmentManagerFixture);
            const { investmentManager, investor1, paymentToken, saleToken } = fixture;
            const { offeringAddress, config } = await createTestOffering(fixture, { apyEnabled: true });

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("1000", 18); // $1000
            await paymentToken.mint(investor1.address, investmentAmount);
            await paymentToken.connect(investor1).approve(offeringAddress, investmentAmount);

            await investmentManager.connect(investor1).routeInvestment(
                offeringAddress,
                await paymentToken.getAddress(),
                investmentAmount
            );

            const offering = await ethers.getContractAt("Offering", offeringAddress);
            const wrappedTokenAddress = await offering.wrappedTokenAddress();
            const wrappedToken = await ethers.getContractAt("WRAPPEDTOKEN", wrappedTokenAddress);
            
            // Check wrapped tokens were minted
            const expectedTokens = ethers.parseUnits("2000", 18); // $1000 / $0.5 = 2000 tokens
            expect(await wrappedToken.balanceOf(investor1.address)).to.equal(expectedTokens);
        });
    });

    describe("KYB Signature Validation", function () {
        async function generateKYBSignature(walletAddress, nonce, expiry, chainId, contractAddress, signer) {
            const messageHash = ethers.solidityPackedKeccak256(
                ["string", "address", "uint256", "uint256", "uint256", "address"],
                ["KYB_VALIDATION", walletAddress, nonce, expiry, chainId, contractAddress]
            );
            
            const signature = await signer.signMessage(ethers.getBytes(messageHash));
            return { messageHash, signature, nonce, expiry };
        }

        it("Should validate correct KYB signature", async function () {
            const { investmentManager, admin, kybValidator, investor1 } = await loadFixture(deployInvestmentManagerFixture);
            
            await investmentManager.connect(admin).setKYBValidator(kybValidator.address);
            
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const contractAddress = await investmentManager.getAddress();
            const nonce = Date.now();
            const expiry = (await time.latest()) + 3600;

            const sigData = await generateKYBSignature(
                investor1.address, nonce, expiry, chainId, contractAddress, kybValidator
            );

            const isValid = await investmentManager.verifyKYBSignature(
                investor1.address, sigData.nonce, sigData.expiry, sigData.signature
            );

            expect(isValid).to.be.true;
        });

        it("Should route investment with KYB validation", async function () {
            const fixture = await loadFixture(deployInvestmentManagerFixture);
            const { investmentManager, admin, kybValidator, investor1, paymentToken } = fixture;
            const { offeringAddress, config } = await createTestOffering(fixture);

            await investmentManager.connect(admin).setKYBValidator(kybValidator.address);
            await time.increaseTo(config.startDate + 10);

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const contractAddress = await investmentManager.getAddress();
            const nonce = Date.now();
            const expiry = (await time.latest()) + 3600;
            const investmentAmount = ethers.parseUnits("500", 18);

            const sigData = await generateKYBSignature(
                investor1.address, nonce, expiry, chainId, contractAddress, kybValidator
            );

            await paymentToken.mint(investor1.address, investmentAmount);
            await paymentToken.connect(investor1).approve(offeringAddress, investmentAmount);

            await expect(investmentManager.connect(investor1).routeInvestmentWithKYB(
                offeringAddress,
                await paymentToken.getAddress(),
                investmentAmount,
                sigData.nonce,
                sigData.expiry,
                sigData.signature
            ))
                .to.emit(investmentManager, "KYBValidatedInvestment");
        });

        it("Should prevent signature replay attacks", async function () {
            const fixture = await loadFixture(deployInvestmentManagerFixture);
            const { investmentManager, admin, kybValidator, investor1, paymentToken } = fixture;
            const { offeringAddress, config } = await createTestOffering(fixture);

            await investmentManager.connect(admin).setKYBValidator(kybValidator.address);
            await time.increaseTo(config.startDate + 10);

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const contractAddress = await investmentManager.getAddress();
            const nonce = Date.now();
            const expiry = (await time.latest()) + 3600;
            const investmentAmount = ethers.parseUnits("300", 18);

            const sigData = await generateKYBSignature(
                investor1.address, nonce, expiry, chainId, contractAddress, kybValidator
            );

            await paymentToken.mint(investor1.address, investmentAmount * 2n);
            await paymentToken.connect(investor1).approve(offeringAddress, investmentAmount * 2n);

            // First investment should succeed
            await investmentManager.connect(investor1).routeInvestmentWithKYB(
                offeringAddress,
                await paymentToken.getAddress(),
                investmentAmount,
                sigData.nonce,
                sigData.expiry,
                sigData.signature
            );

            // Second investment with same signature should fail
            await expect(investmentManager.connect(investor1).routeInvestmentWithKYB(
                offeringAddress,
                await paymentToken.getAddress(),
                investmentAmount,
                sigData.nonce,
                sigData.expiry,
                sigData.signature
            )).to.be.revertedWith("Invalid KYB signature");
        });

        it("Should reject expired signatures", async function () {
            const fixture = await loadFixture(deployInvestmentManagerFixture);
            const { investmentManager, admin, kybValidator, investor1 } = fixture;

            await investmentManager.connect(admin).setKYBValidator(kybValidator.address);

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const contractAddress = await investmentManager.getAddress();
            const nonce = Date.now();
            const expiry = (await time.latest()) - 100; // Already expired

            const sigData = await generateKYBSignature(
                investor1.address, nonce, expiry, chainId, contractAddress, kybValidator
            );

            await expect(investmentManager.verifyKYBSignature(
                investor1.address, sigData.nonce, sigData.expiry, sigData.signature
            )).to.be.revertedWith("Signature expired");
        });
    });

    describe("Token Claims", function () {
        it("Should claim investment tokens successfully", async function () {
            const fixture = await loadFixture(deployInvestmentManagerFixture);
            const { investmentManager, investor1, paymentToken, saleToken } = fixture;
            const { offeringAddress, offering, config } = await createTestOffering(fixture);

            await time.increaseTo(config.startDate + 10);

            // Make investment
            const investmentAmount = ethers.parseUnits("1000", 18);
            await paymentToken.mint(investor1.address, investmentAmount);
            await paymentToken.connect(investor1).approve(offeringAddress, investmentAmount);

            await investmentManager.connect(investor1).routeInvestment(
                offeringAddress,
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Fast forward past end date and finalize
            await time.increaseTo(config.endDate + 10);
            await fixture.escrow.connect(fixture.treasuryOwner).finalizeOffering(offeringAddress);

            // Claim tokens
            const expectedTokens = ethers.parseUnits("2000", 18); // $1000 / $0.5
            
            await expect(investmentManager.connect(investor1).claimInvestmentTokens(offeringAddress))
                .to.emit(investmentManager, "TokensClaimed")
                .withArgs(investor1.address, offeringAddress, expectedTokens);

            expect(await saleToken.balanceOf(investor1.address)).to.equal(expectedTokens);
        });
    });

    describe("Refund System", function () {
        it("Should process refunds correctly", async function () {
            const fixture = await loadFixture(deployInvestmentManagerFixture);
            const { investmentManager, investor1, paymentToken, escrow, treasuryOwner } = fixture;
            const { offeringAddress, config } = await createTestOffering(fixture);

            await time.increaseTo(config.startDate + 10);

            // Make investment
            const investmentAmount = ethers.parseUnits("500", 18);
            await paymentToken.mint(investor1.address, investmentAmount);
            await paymentToken.connect(investor1).approve(offeringAddress, investmentAmount);

            await investmentManager.connect(investor1).routeInvestment(
                offeringAddress,
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Enable refunds
            await escrow.connect(treasuryOwner).enableRefundsByOwner(offeringAddress);

            // Claim refund
            const initialBalance = await paymentToken.balanceOf(investor1.address);
            
            await expect(investmentManager.connect(investor1).claimRefund(
                offeringAddress,
                await paymentToken.getAddress()
            ))
                .to.emit(investmentManager, "RefundClaimed")
                .withArgs(investor1.address, offeringAddress, await paymentToken.getAddress(), investmentAmount);

            const finalBalance = await paymentToken.balanceOf(investor1.address);
            expect(finalBalance - initialBalance).to.equal(investmentAmount);
        });

        it("Should revert refund if not enabled", async function () {
            const fixture = await loadFixture(deployInvestmentManagerFixture);
            const { investmentManager, investor1, paymentToken } = fixture;
            const { offeringAddress, config } = await createTestOffering(fixture);

            await time.increaseTo(config.startDate + 10);

            // Make investment
            const investmentAmount = ethers.parseUnits("500", 18);
            await paymentToken.mint(investor1.address, investmentAmount);
            await paymentToken.connect(investor1).approve(offeringAddress, investmentAmount);

            await investmentManager.connect(investor1).routeInvestment(
                offeringAddress,
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Try to claim refund without enabling
            await expect(investmentManager.connect(investor1).claimRefund(
                offeringAddress,
                await paymentToken.getAddress()
            )).to.be.revertedWith("Refunds not enabled for this offering");
        });
    });

    describe("Emergency Functions", function () {
        it("Should rescue stuck ERC20 tokens", async function () {
            const { investmentManager, admin, investor1, paymentToken } = await loadFixture(deployInvestmentManagerFixture);
            
            const stuckAmount = ethers.parseUnits("100", 18);
            await paymentToken.mint(await investmentManager.getAddress(), stuckAmount);
            
            await expect(investmentManager.connect(admin).rescueERC20(
                await paymentToken.getAddress(),
                stuckAmount,
                investor1.address
            )).to.changeTokenBalances(
                paymentToken,
                [investmentManager, investor1],
                [-stuckAmount, stuckAmount]
            );
        });

        it("Should rescue stuck native currency", async function () {
            const { investmentManager, admin, investor1 } = await loadFixture(deployInvestmentManagerFixture);
            
            const stuckAmount = ethers.parseEther("1.0");
            await admin.sendTransaction({ to: await investmentManager.getAddress(), value: stuckAmount });
            
            await expect(investmentManager.connect(admin).rescueNative(
                stuckAmount,
                investor1.address
            )).to.changeEtherBalances(
                [investmentManager, investor1],
                [-stuckAmount, stuckAmount]
            );
        });
    });
});