const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Contract Interactions Tests", function () {
    // Constants for test configuration
    const MIN_INVESTMENT = ethers.parseUnits("100", 18); // $100
    const MAX_INVESTMENT = ethers.parseUnits("5000", 18); // $5000
    const SOFT_CAP = ethers.parseUnits("10000", 18); // $10k
    const FUNDRAISING_CAP = ethers.parseUnits("100000", 18); // $100k
    const TOKEN_PRICE = ethers.parseUnits("0.5", 18); // $0.5 per token
    const PAYOUT_APR = 1200; // 12% APR in basis points
    const PAYOUT_PERIOD_DURATION = 30 * 24 * 60 * 60; // 30 days

    async function deployInteractionFixture() {
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

        console.log("🏗️ Deploying contract interaction test ecosystem...");

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

        console.log("✅ Contract interaction test ecosystem deployed successfully");

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

    describe("1. OfferingFactory ↔ WrappedTokenFactory Interaction", function () {
        it("Should create wrapped token through factory correctly", async function () {
            const fixture = await loadFixture(deployInteractionFixture);
            const { offeringFactory, wrappedTokenFactory, deployer, paymentToken, paymentOracle } = fixture;
            
            const config = await createOfferingConfig(fixture, true);
            
            const initialWrappedTokenCount = await wrappedTokenFactory.count();
            
            const tx = await offeringFactory.connect(deployer).createOfferingWithPaymentTokens(
                config,
                [await paymentToken.getAddress()],
                [await paymentOracle.getAddress()]
            );

            const receipt = await tx.wait();
            const offeringEvent = receipt.logs.find(log => 
                log.fragment && log.fragment.name === 'OfferingDeployed'
            );

            expect(await wrappedTokenFactory.count()).to.equal(initialWrappedTokenCount + 1n);

            const offeringAddress = offeringEvent.args.offeringAddress;
            const offering = await ethers.getContractAt("Offering", offeringAddress);
            const wrappedTokenAddress = await offering.wrappedTokenAddress();

            expect(wrappedTokenAddress).to.not.equal(ethers.ZeroAddress);
            expect(await wrappedTokenFactory.getWrappedTokenCreator(wrappedTokenAddress)).to.equal(await offeringFactory.getAddress());
        });

        it("Should handle wrapped token factory updates", async function () {
            const fixture = await loadFixture(deployInteractionFixture);
            const { offeringFactory, deployer } = fixture;

            const WrappedTokenFactory = await ethers.getContractFactory("WrappedTokenFactory");
            const newFactory = await WrappedTokenFactory.deploy();

            await expect(
                offeringFactory.connect(deployer).setWrappedTokenFactory(await newFactory.getAddress())
            ).to.emit(offeringFactory, "WrappedTokenFactoryUpdated");

            expect(await offeringFactory.wrappedTokenFactory()).to.equal(await newFactory.getAddress());
        });
    });

    describe("2. InvestmentManager ↔ Offering Interaction", function () {
        it("Should route investments correctly through investment manager", async function () {
            const fixture = await loadFixture(deployInteractionFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, investmentManager, investor1 } = fixture;
            
            const config = await createOfferingConfig(fixture, false);
            
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

            await saleToken.connect(tokenOwner).transfer(offeringAddress, ethers.parseUnits("200000"));
            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("500");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);

            // Investment should go through investment manager
            await expect(
                investmentManager.connect(investor1).routeInvestment(
                    offeringAddress,
                    await paymentToken.getAddress(),
                    investmentAmount
                )
            ).to.emit(investmentManager, "InvestmentRouted")
            .and.to.emit(offering, "Invested");

            expect(await offering.totalRaised()).to.equal(ethers.parseUnits("500"));
        });

        it("Should handle token claims through investment manager", async function () {
            const fixture = await loadFixture(deployInteractionFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, investmentManager, investor1, escrow, treasuryOwner } = fixture;
            
            const config = await createOfferingConfig(fixture, false);
            
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

            await saleToken.connect(tokenOwner).transfer(offeringAddress, ethers.parseUnits("200000"));
            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("400");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                offeringAddress,
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Finalize offering
            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(offeringAddress);

            // Claim tokens through investment manager
            const initialBalance = await saleToken.balanceOf(investor1.address);
            
            await expect(
                investmentManager.connect(investor1).claimInvestmentTokens(offeringAddress)
            ).to.emit(investmentManager, "TokensClaimed")
            .and.to.emit(offering, "Claimed");

            const finalBalance = await saleToken.balanceOf(investor1.address);
            expect(finalBalance - initialBalance).to.equal(ethers.parseUnits("800")); // 400 USD / 0.5 = 800 tokens
        });
    });

    describe("3. Offering ↔ Escrow Interaction", function () {
        it("Should register offering with escrow automatically", async function () {
            const fixture = await loadFixture(deployInteractionFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, escrow } = fixture;
            
            const config = await createOfferingConfig(fixture, false);
            
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
            
            expect(await escrow.isOfferingRegistered(offeringAddress)).to.be.true;
            
            const offeringInfo = await escrow.getOfferingInfo(offeringAddress);
            expect(offeringInfo.isRegistered).to.be.true;
            expect(offeringInfo.owner).to.equal(config.tokenOwner);
        });

        it("Should deposit funds to escrow during investment", async function () {
            const fixture = await loadFixture(deployInteractionFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, investmentManager, investor1, escrow } = fixture;
            
            const config = await createOfferingConfig(fixture, false);
            
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

            await saleToken.connect(tokenOwner).transfer(offeringAddress, ethers.parseUnits("200000"));
            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("600");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);

            await expect(
                investmentManager.connect(investor1).routeInvestment(
                    offeringAddress,
                    await paymentToken.getAddress(),
                    investmentAmount
                )
            ).to.emit(escrow, "Deposited");

            const depositInfo = await escrow.getDepositInfo(offeringAddress, investor1.address);
            expect(depositInfo.amount).to.equal(investmentAmount);
            expect(depositInfo.token).to.equal(await paymentToken.getAddress());
        });

        it("Should finalize offering and transfer funds to owner", async function () {
            const fixture = await loadFixture(deployInteractionFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, investmentManager, investor1, escrow, treasuryOwner } = fixture;
            
            const config = await createOfferingConfig(fixture, false);
            
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

            await saleToken.connect(tokenOwner).transfer(offeringAddress, ethers.parseUnits("200000"));
            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("800");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                offeringAddress,
                await paymentToken.getAddress(),
                investmentAmount
            );

            await time.increaseTo(config.endDate + 10);

            const initialOwnerBalance = await paymentToken.balanceOf(tokenOwner);

            await expect(
                escrow.connect(treasuryOwner).finalizeOffering(offeringAddress)
            ).to.emit(escrow, "OfferingFinalized")
            .and.to.emit(offering, "OfferingFinalized");

            const finalOwnerBalance = await paymentToken.balanceOf(tokenOwner);
            expect(finalOwnerBalance - initialOwnerBalance).to.equal(investmentAmount);
        });
    });

    describe("4. Offering ↔ WrappedToken Interaction", function () {
        it("Should register investment in wrapped token during token claim", async function () {
            const fixture = await loadFixture(deployInteractionFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, payoutAdmin, investmentManager, investor1, escrow, treasuryOwner } = fixture;
            
            const config = await createOfferingConfig(fixture, true);
            
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

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("700");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                offeringAddress,
                await paymentToken.getAddress(),
                investmentAmount
            );

            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(offeringAddress);

            // Token claim should register investment in wrapped token
            await expect(
                investmentManager.connect(investor1).claimInvestmentTokens(offeringAddress)
            ).to.emit(wrappedToken, "InvestmentRegistered");

            const wrappedBalance = await wrappedToken.balanceOf(investor1.address);
            expect(wrappedBalance).to.equal(ethers.parseUnits("1400")); // 700 USD / 0.5 = 1400 tokens

            const investor = await wrappedToken.investors(investor1.address);
            expect(investor.deposited).to.equal(ethers.parseUnits("1400"));
            expect(investor.usdtValue).to.equal(ethers.parseUnits("700"));
        });

        it("Should set first payout date when offering is finalized", async function () {
            const fixture = await loadFixture(deployInteractionFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, payoutAdmin, investmentManager, investor1, escrow, treasuryOwner } = fixture;
            
            const config = await createOfferingConfig(fixture, true);
            
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

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("300");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                offeringAddress,
                await paymentToken.getAddress(),
                investmentAmount
            );

            // First payout date should be 0 initially
            expect(await wrappedToken.firstPayoutDate()).to.equal(0);

            await time.increaseTo(config.endDate + 10);
            
            // Finalization should set first payout date
            await expect(
                escrow.connect(treasuryOwner).finalizeOffering(offeringAddress)
            ).to.emit(wrappedToken, "FirstPayoutDateSet");

            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            expect(firstPayoutDate).to.be.greaterThan(0);
        });
    });

    describe("5. InvestmentManager ↔ Escrow Interaction", function () {
        it("Should handle refund notifications correctly", async function () {
            const fixture = await loadFixture(deployInteractionFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, investmentManager, investor1, escrow, treasuryOwner } = fixture;
            
            const config = await createOfferingConfig(fixture, false);
            
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

            await saleToken.connect(tokenOwner).transfer(offeringAddress, ethers.parseUnits("200000"));
            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("500");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                offeringAddress,
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Enable refunds should notify investment manager
            await expect(
                escrow.connect(treasuryOwner).enableRefundsByOwner(offeringAddress)
            ).to.emit(investmentManager, "refundEnabled");

            expect(await investmentManager.refundsEnabledForOffering(offeringAddress)).to.be.true;
        });

        it("Should process refunds through investment manager", async function () {
            const fixture = await loadFixture(deployInteractionFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, investmentManager, investor1, escrow, treasuryOwner } = fixture;
            
            const config = await createOfferingConfig(fixture, false);
            
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

            await saleToken.connect(tokenOwner).transfer(offeringAddress, ethers.parseUnits("200000"));
            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("600");
            const initialBalance = await paymentToken.balanceOf(investor1.address);

            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                offeringAddress,
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Enable refunds
            await escrow.connect(treasuryOwner).enableRefundsByOwner(offeringAddress);

            // Claim refund through investment manager
            await expect(
                investmentManager.connect(investor1).claimRefund(
                    offeringAddress,
                    await paymentToken.getAddress()
                )
            ).to.emit(investmentManager, "RefundClaimed")
            .and.to.emit(escrow, "Refunded");

            const finalBalance = await paymentToken.balanceOf(investor1.address);
            expect(finalBalance).to.equal(initialBalance);
        });
    });

    describe("6. Cross-Contract State Consistency", function () {
        it("Should maintain consistent state across all contracts during investment flow", async function () {
            const fixture = await loadFixture(deployInteractionFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, payoutAdmin, investmentManager, investor1, investor2, escrow, treasuryOwner } = fixture;
            
            const config = await createOfferingConfig(fixture, true);
            
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

            await time.increaseTo(config.startDate + 10);

            // Multiple investments
            const investment1 = ethers.parseUnits("400");
            const investment2 = ethers.parseUnits("600");

            await paymentToken.connect(investor1).approve(await offering.getAddress(), investment1);
            await paymentToken.connect(investor2).approve(await offering.getAddress(), investment2);

            await investmentManager.connect(investor1).routeInvestment(offeringAddress, await paymentToken.getAddress(), investment1);
            await investmentManager.connect(investor2).routeInvestment(offeringAddress, await paymentToken.getAddress(), investment2);

            // Check offering state
            expect(await offering.totalRaised()).to.equal(ethers.parseUnits("1000"));
            expect(await offering.pendingTokens(investor1.address)).to.equal(ethers.parseUnits("800"));
            expect(await offering.pendingTokens(investor2.address)).to.equal(ethers.parseUnits("1200"));

            // Check escrow state
            const depositInfo1 = await escrow.getDepositInfo(offeringAddress, investor1.address);
            const depositInfo2 = await escrow.getDepositInfo(offeringAddress, investor2.address);
            expect(depositInfo1.amount).to.equal(investment1);
            expect(depositInfo2.amount).to.equal(investment2);

            const totalTokenAmount = await escrow.getTotalTokenAmount(offeringAddress, await paymentToken.getAddress());
            expect(totalTokenAmount).to.equal(investment1 + investment2);

            // Finalize and claim tokens
            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(offeringAddress);
            await investmentManager.connect(investor1).claimInvestmentTokens(offeringAddress);
            await investmentManager.connect(investor2).claimInvestmentTokens(offeringAddress);

            // Check wrapped token state
            expect(await wrappedToken.balanceOf(investor1.address)).to.equal(ethers.parseUnits("800"));
            expect(await wrappedToken.balanceOf(investor2.address)).to.equal(ethers.parseUnits("1200"));
            expect(await wrappedToken.totalSupply()).to.equal(ethers.parseUnits("2000"));
            expect(await wrappedToken.totalUSDTInvested()).to.equal(ethers.parseUnits("1000"));

            const investor1Data = await wrappedToken.investors(investor1.address);
            const investor2Data = await wrappedToken.investors(investor2.address);
            expect(investor1Data.usdtValue).to.equal(investment1);
            expect(investor2Data.usdtValue).to.equal(investment2);
        });

        it("Should handle emergency scenarios consistently across contracts", async function () {
            const fixture = await loadFixture(deployInteractionFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, investmentManager, investor1, escrow, treasuryOwner } = fixture;
            
            const config = await createOfferingConfig(fixture, false);
            
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

            await saleToken.connect(tokenOwner).transfer(offeringAddress, ethers.parseUnits("200000"));
            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("750");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                offeringAddress,
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Cancel offering (emergency scenario)
            await offering.connect(tokenOwner).cancelOffering();

            // Check consistent state across contracts
            expect(await offering.isOfferingCancelled()).to.be.true;
            expect(await offering.isSaleClosed()).to.be.true;
            expect(await escrow.refundsEnabled(offeringAddress)).to.be.true;
            expect(await investmentManager.refundsEnabledForOffering(offeringAddress)).to.be.true;

            // Refund should work consistently
            const initialBalance = await paymentToken.balanceOf(investor1.address);
            await investmentManager.connect(investor1).claimRefund(
                offeringAddress,
                await paymentToken.getAddress()
            );
            const finalBalance = await paymentToken.balanceOf(investor1.address);

            expect(finalBalance - initialBalance).to.equal(investmentAmount);

            // Deposit should be cleared in escrow
            const depositInfo = await escrow.getDepositInfo(offeringAddress, investor1.address);
            expect(depositInfo.amount).to.equal(0);
        });
    });

    describe("7. Access Control Across Contracts", function () {
        it("Should enforce proper access control in cross-contract calls", async function () {
            const fixture = await loadFixture(deployInteractionFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, investmentManager, investor1, escrow } = fixture;
            
            const config = await createOfferingConfig(fixture, false);
            
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

            await saleToken.connect(tokenOwner).transfer(offeringAddress, ethers.parseUnits("200000"));

            // Direct investment to offering should fail (must go through investment manager)
            await time.increaseTo(config.startDate + 10);
            const investmentAmount = ethers.parseUnits("500");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);

            await expect(
                offering.connect(investor1).invest(
                    await paymentToken.getAddress(),
                    investor1.address,
                    investmentAmount
                )
            ).to.be.revertedWith("Caller is not the investmentManager contract");

            // Direct escrow refund should fail (must go through investment manager)
            await expect(
                escrow.connect(investor1).refund(offeringAddress, investor1.address)
            ).to.be.revertedWith("Only InvestmentManager can call this function");
        });

        it("Should allow proper role-based operations across contracts", async function () {
            const fixture = await loadFixture(deployInteractionFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, payoutAdmin, investmentManager, investor1, escrow, treasuryOwner } = fixture;
            
            const config = await createOfferingConfig(fixture, true);
            
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

            // Grant payout admin role
            const PAYOUT_ADMIN_ROLE = await wrappedToken.PAYOUT_ADMIN_ROLE();
            await wrappedToken.connect(deployer).grantRole(PAYOUT_ADMIN_ROLE, payoutAdmin.address);

            // Token owner should be able to cancel offering
            await expect(
                offering.connect(tokenOwner).cancelOffering()
            ).to.emit(offering, "OfferingCancelled");

            // Treasury owner should be able to enable refunds
            await expect(
                escrow.connect(treasuryOwner).enableRefundsByOwner(offeringAddress)
            ).to.emit(escrow, "RefundsEnabled");

            // Payout admin should be able to distribute payouts (if offering wasn't cancelled)
            // This test verifies the role exists and is properly configured
            expect(await wrappedToken.hasRole(PAYOUT_ADMIN_ROLE, payoutAdmin.address)).to.be.true;
        });
    });

    describe("8. Event Propagation Across Contracts", function () {
        it("Should emit events correctly across contract interactions", async function () {
            const fixture = await loadFixture(deployInteractionFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, investmentManager, investor1, escrow, treasuryOwner } = fixture;
            
            const config = await createOfferingConfig(fixture, false);
            
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

            await saleToken.connect(tokenOwner).transfer(offeringAddress, ethers.parseUnits("200000"));
            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("400");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);

            // Investment should emit events from both InvestmentManager and Offering
            await expect(
                investmentManager.connect(investor1).routeInvestment(
                    offeringAddress,
                    await paymentToken.getAddress(),
                    investmentAmount
                )
            ).to.emit(investmentManager, "InvestmentRouted")
            .withArgs(investor1.address, offeringAddress, await paymentToken.getAddress(), investmentAmount, ethers.parseUnits("800"))
            .and.to.emit(offering, "Invested")
            .and.to.emit(escrow, "Deposited");

            await time.increaseTo(config.endDate + 10);

            // Finalization should emit events from both Escrow and Offering
            await expect(
                escrow.connect(treasuryOwner).finalizeOffering(offeringAddress)
            ).to.emit(escrow, "OfferingFinalized")
            .and.to.emit(offering, "OfferingFinalized");

            // Token claim should emit events from both InvestmentManager and Offering
            await expect(
                investmentManager.connect(investor1).claimInvestmentTokens(offeringAddress)
            ).to.emit(investmentManager, "TokensClaimed")
            .and.to.emit(offering, "Claimed");
        });
    });
});