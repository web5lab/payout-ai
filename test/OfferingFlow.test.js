const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Complete Offering Flow Tests", function () {
    // Constants for test configuration
    const MIN_INVESTMENT = ethers.parseUnits("100", 18); // $100
    const MAX_INVESTMENT = ethers.parseUnits("5000", 18); // $5000
    const SOFT_CAP = ethers.parseUnits("10000", 18); // $10k
    const FUNDRAISING_CAP = ethers.parseUnits("100000", 18); // $100k
    const TOKEN_PRICE = ethers.parseUnits("0.5", 18); // $0.5 per token
    const PAYOUT_APR = 1200; // 12% APR in basis points
    const PAYOUT_PERIOD_DURATION = 30 * 24 * 60 * 60; // 30 days

    async function deployCompleteEcosystemFixture() {
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

        console.log("🏗️ Deploying complete ecosystem...");

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
        await saleToken.connect(deployer).mint(tokenOwner.address, ethers.parseUnits("10000000")); // 10M sale tokens
        await paymentToken.connect(deployer).mint(investor1.address, ethers.parseUnits("50000"));
        await paymentToken.connect(deployer).mint(investor2.address, ethers.parseUnits("50000"));
        await paymentToken.connect(deployer).mint(investor3.address, ethers.parseUnits("50000"));
        await payoutToken.connect(deployer).mint(payoutAdmin.address, ethers.parseUnits("100000"));

        console.log("✅ Ecosystem deployed successfully");

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

    describe("1. Offering Factory Deployment and Setup", function () {
        it("Should deploy all contracts successfully", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { offeringFactory, wrappedTokenFactory, investmentManager, escrow } = fixture;

            expect(await offeringFactory.getAddress()).to.not.equal(ethers.ZeroAddress);
            expect(await wrappedTokenFactory.getAddress()).to.not.equal(ethers.ZeroAddress);
            expect(await investmentManager.getAddress()).to.not.equal(ethers.ZeroAddress);
            expect(await escrow.getAddress()).to.not.equal(ethers.ZeroAddress);
        });

        it("Should have correct initial state", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { offeringFactory } = fixture;

            expect(await offeringFactory.count()).to.equal(0);
        });
    });

    describe("2. Create Offering WITHOUT APY", function () {
        it("Should create offering without APY successfully", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle } = fixture;
            
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

            expect(event).to.not.be.undefined;
            expect(await offeringFactory.count()).to.equal(1);

            const offeringAddress = event.args.offeringAddress;
            const offering = await ethers.getContractAt("Offering", offeringAddress);
            
            expect(await offering.apyEnabled()).to.be.false;
            expect(await offering.wrappedTokenAddress()).to.equal(ethers.ZeroAddress);
        });

        it("Should register offering with escrow", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
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
            const isRegistered = await escrow.isOfferingRegistered(offeringAddress);
            
            expect(isRegistered).to.be.true;
        });
    });

    describe("3. Create Offering WITH APY", function () {
        it("Should create offering with APY successfully", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle } = fixture;
            
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

            expect(event).to.not.be.undefined;
            expect(await offeringFactory.count()).to.equal(1);

            const offeringAddress = event.args.offeringAddress;
            const offering = await ethers.getContractAt("Offering", offeringAddress);
            
            expect(await offering.apyEnabled()).to.be.true;
            expect(await offering.wrappedTokenAddress()).to.not.equal(ethers.ZeroAddress);
        });

        it("Should deploy wrapped token with correct configuration", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, payoutToken } = fixture;
            
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

            expect(await wrappedToken.peggedToken()).to.equal(await saleToken.getAddress());
            expect(await wrappedToken.payoutToken()).to.equal(await payoutToken.getAddress());
            expect(await wrappedToken.maturityDate()).to.equal(config.maturityDate);
            expect(await wrappedToken.payoutAPR()).to.equal(PAYOUT_APR);
        });
    });

    describe("4. Investment Flow - WITHOUT APY", function () {
        async function setupOfferingWithoutAPY() {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner } = fixture;
            
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

            // Transfer sale tokens to offering
            const totalTokensForSale = ethers.parseUnits("200000"); // 200k tokens
            await saleToken.connect(tokenOwner).transfer(offeringAddress, totalTokensForSale);

            return { ...fixture, offering, config };
        }

        it("Should allow investment during sale period", async function () {
            const { offering, config, investmentManager, investor1, paymentToken } = await setupOfferingWithoutAPY();
            
            const investmentAmount = ethers.parseUnits("500"); // $500
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            
            // Fast forward to sale start
            await time.increaseTo(config.startDate + 10);
            
            await expect(
                investmentManager.connect(investor1).routeInvestment(
                    await offering.getAddress(),
                    await paymentToken.getAddress(),
                    investmentAmount
                )
            ).to.emit(investmentManager, "InvestmentRouted");

            expect(await offering.totalRaised()).to.equal(ethers.parseUnits("500")); // $500 USD
            expect(await offering.pendingTokens(investor1.address)).to.equal(ethers.parseUnits("1000")); // 1000 tokens at $0.5 each
        });

        it("Should handle multiple investments", async function () {
            const { offering, config, investmentManager, investor1, investor2, paymentToken } = await setupOfferingWithoutAPY();
            
            await time.increaseTo(config.startDate + 10);
            
            // Investor 1 invests $300
            const investment1 = ethers.parseUnits("300");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investment1);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investment1
            );

            // Investor 2 invests $700
            const investment2 = ethers.parseUnits("700");
            await paymentToken.connect(investor2).approve(await offering.getAddress(), investment2);
            await investmentManager.connect(investor2).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investment2
            );

            expect(await offering.totalRaised()).to.equal(ethers.parseUnits("1000")); // $1000 total
            expect(await offering.pendingTokens(investor1.address)).to.equal(ethers.parseUnits("600")); // 600 tokens
            expect(await offering.pendingTokens(investor2.address)).to.equal(ethers.parseUnits("1400")); // 1400 tokens
        });

        it("Should finalize offering and allow token claims", async function () {
            const { offering, config, investmentManager, investor1, paymentToken, escrow, treasuryOwner } = await setupOfferingWithoutAPY();
            
            await time.increaseTo(config.startDate + 10);
            
            const investmentAmount = ethers.parseUnits("500");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Fast forward past end date
            await time.increaseTo(config.endDate + 10);
            
            // Finalize offering
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            
            expect(await offering.isOfferingFinalized()).to.be.true;

            // Claim tokens
            await expect(
                investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress())
            ).to.emit(investmentManager, "TokensClaimed");
        });
    });

    describe("5. Investment Flow - WITH APY", function () {
        async function setupOfferingWithAPY() {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, payoutAdmin } = fixture;
            
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

            // Transfer sale tokens to offering
            const totalTokensForSale = ethers.parseUnits("200000");
            await saleToken.connect(tokenOwner).transfer(offeringAddress, totalTokensForSale);

            // Grant payout admin role
            const PAYOUT_ADMIN_ROLE = await wrappedToken.PAYOUT_ADMIN_ROLE();
            await wrappedToken.connect(deployer).grantRole(PAYOUT_ADMIN_ROLE, payoutAdmin.address);

            return { ...fixture, offering, wrappedToken, config };
        }

        it("Should mint wrapped tokens on investment", async function () {
            const { offering, wrappedToken, config, investmentManager, investor1, paymentToken, escrow, treasuryOwner } = await setupOfferingWithAPY();
            
            const investmentAmount = ethers.parseUnits("400"); // $400
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            
            await time.increaseTo(config.startDate + 10);
            
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Finalize offering first to trigger token claiming
            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());

            // Now claim tokens which should register investment in wrapped token
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());

            // Check wrapped tokens were minted
            const wrappedBalance = await wrappedToken.balanceOf(investor1.address);
            expect(wrappedBalance).to.equal(ethers.parseUnits("800")); // 800 tokens at $0.5 each

            // Check investment was registered
            const investor = await wrappedToken.investors(investor1.address);
            expect(investor.deposited).to.equal(ethers.parseUnits("800"));
            expect(investor.usdtValue).to.equal(ethers.parseUnits("400"));
        });

        it("Should handle payout distribution and claims", async function () {
            const { offering, wrappedToken, config, investmentManager, investor1, paymentToken, payoutToken, payoutAdmin, escrow, treasuryOwner } = await setupOfferingWithAPY();
            
            await time.increaseTo(config.startDate + 10);
            
            // Investment
            const investmentAmount = ethers.parseUnits("1000"); // $1000
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Finalize offering to set first payout date and claim tokens
            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());

            // Fast forward to first payout date
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);

            // Admin distributes payout
            const payoutAmount = ethers.parseUnits("100");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payoutAmount);

            // User claims payout
            const initialPayoutBalance = await payoutToken.balanceOf(investor1.address);
            await wrappedToken.connect(investor1).claimAvailablePayouts();
            const finalPayoutBalance = await payoutToken.balanceOf(investor1.address);
            
            expect(finalPayoutBalance - initialPayoutBalance).to.equal(payoutAmount);
        });

        it("Should allow final token redemption at maturity", async function () {
            const { offering, wrappedToken, config, investmentManager, investor1, paymentToken, saleToken, escrow, treasuryOwner } = await setupOfferingWithAPY();
            
            await time.increaseTo(config.startDate + 10);
            
            const investmentAmount = ethers.parseUnits("600"); // $600
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Finalize offering and claim tokens
            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());

            // Fast forward to maturity
            await time.increaseTo(config.maturityDate + 10);

            // Claim final tokens
            const initialSaleBalance = await saleToken.balanceOf(investor1.address);
            await wrappedToken.connect(investor1).claimFinalTokens();
            const finalSaleBalance = await saleToken.balanceOf(investor1.address);
            
            const tokensReceived = finalSaleBalance - initialSaleBalance;
            expect(tokensReceived).to.equal(ethers.parseUnits("1200")); // 1200 tokens at $0.5 each
        });
    });

    describe("6. KYB Validation Flow", function () {
        it("Should allow KYB validated investments", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, investmentManager, investor1, kybValidator } = fixture;
            
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

            // Transfer sale tokens
            await saleToken.connect(tokenOwner).transfer(offeringAddress, ethers.parseUnits("200000"));

            // Get fresh timestamp to avoid timestamp issues
            await time.increaseTo(config.startDate + 10);
            

            // Generate KYB signature
            const nonce = 1;
            const expiry = (await time.latest()) + 3600; // 1 hour from now
            const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
            
            const messageHash = ethers.solidityPackedKeccak256(
                ["string", "address", "uint256", "uint256", "uint256", "address"],
                ["KYB_VALIDATION", investor1.address, nonce, expiry, chainId, await investmentManager.getAddress()]
            );
            
            const signature = await kybValidator.signMessage(ethers.getBytes(messageHash));

            const investmentAmount = ethers.parseUnits("500");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);

            await expect(
                investmentManager.connect(investor1).routeInvestmentWithKYB(
                    offeringAddress,
                    await paymentToken.getAddress(),
                    investmentAmount,
                    nonce,
                    expiry,
                    signature
                )
            ).to.emit(investmentManager, "KYBValidatedInvestment");
        });
    });

    describe("7. Emergency Scenarios", function () {
        it("Should handle offering cancellation and refunds", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
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

            // Investment
            const investmentAmount = ethers.parseUnits("500");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                offeringAddress,
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Cancel offering
            await offering.connect(tokenOwner).cancelOffering();
            expect(await offering.isOfferingCancelled()).to.be.true;

            // Claim refund
            const initialBalance = await paymentToken.balanceOf(investor1.address);
            await expect(
                investmentManager.connect(investor1).claimRefund(
                    offeringAddress,
                    await paymentToken.getAddress()
                )
            ).to.emit(investmentManager, "RefundClaimed");
            
            const finalBalance = await paymentToken.balanceOf(investor1.address);
            expect(finalBalance - initialBalance).to.equal(investmentAmount);
        });

        it("Should handle emergency unlock in APY offerings", async function () {
            const { offering, wrappedToken, config, investmentManager, investor1, paymentToken, saleToken, deployer, escrow, treasuryOwner } = await setupOfferingWithAPY();
            
            await time.increaseTo(config.startDate + 10);
            
            const investmentAmount = ethers.parseUnits("800"); // $800
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Finalize offering and claim tokens
            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());

            // Enable emergency unlock with 10% penalty
            await wrappedToken.connect(deployer).enableEmergencyUnlock(1000);

            // Use emergency unlock
            const initialSaleBalance = await saleToken.balanceOf(investor1.address);
            await wrappedToken.connect(investor1).emergencyUnlock();
            const finalSaleBalance = await saleToken.balanceOf(investor1.address);
            
            const tokensReceived = finalSaleBalance - initialSaleBalance;
            const expectedTokens = (ethers.parseUnits("1600") * 90n) / 100n; // 90% after 10% penalty
            expect(tokensReceived).to.equal(expectedTokens);
        });

        async function setupOfferingWithAPY() {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, payoutAdmin } = fixture;
            
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

            // Transfer sale tokens to offering
            const totalTokensForSale = ethers.parseUnits("200000");
            await saleToken.connect(tokenOwner).transfer(offeringAddress, totalTokensForSale);

            // Grant payout admin role
            const PAYOUT_ADMIN_ROLE = await wrappedToken.PAYOUT_ADMIN_ROLE();
            await wrappedToken.connect(deployer).grantRole(PAYOUT_ADMIN_ROLE, payoutAdmin.address);

            return { ...fixture, offering, wrappedToken, config };
        }
    });

    describe("8. Edge Cases and Validations", function () {
        it("Should enforce investment limits", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
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

            // Test minimum investment
            const belowMinimum = ethers.parseUnits("50"); // Below $100 minimum
            await paymentToken.connect(investor1).approve(await offering.getAddress(), belowMinimum);
            
            await expect(
                investmentManager.connect(investor1).routeInvestment(
                    offeringAddress,
                    await paymentToken.getAddress(),
                    belowMinimum
                )
            ).to.be.revertedWith("Below min investment");

            // Test maximum investment
            const aboveMaximum = ethers.parseUnits("6000"); // Above $5000 maximum
            await paymentToken.connect(investor1).approve(await offering.getAddress(), aboveMaximum);
            
            await expect(
                investmentManager.connect(investor1).routeInvestment(
                    offeringAddress,
                    await paymentToken.getAddress(),
                    aboveMaximum
                )
            ).to.be.revertedWith("Exceeds max investment");
        });

        it("Should handle fundraising cap correctly", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, investmentManager, investor1, investor2 } = fixture;
            
            // Create offering with lower cap for testing
            const config = await createOfferingConfig(fixture, false);
            config.fundraisingCap = ethers.parseUnits("1000"); // $1000 cap
            config.softCap = ethers.parseUnits("500"); // $500 soft cap (must be <= fundraising cap)
            
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

            // Investor 1 invests close to cap
            const investment1 = ethers.parseUnits("900"); // $900
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investment1);
            await investmentManager.connect(investor1).routeInvestment(
                offeringAddress,
                await paymentToken.getAddress(),
                investment1
            );

            // Investor 2 tries to exceed cap
            const investment2 = ethers.parseUnits("200"); // $200, would exceed $1000 cap
            await paymentToken.connect(investor2).approve(await offering.getAddress(), investment2);
            
            await expect(
                investmentManager.connect(investor2).routeInvestment(
                    offeringAddress,
                    await paymentToken.getAddress(),
                    investment2
                )
            ).to.be.revertedWith("Exceeds cap");
        });

        it("Should prevent investments outside sale period", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
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

            const investmentAmount = ethers.parseUnits("500");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);

            // Try to invest before sale starts
            await expect(
                investmentManager.connect(investor1).routeInvestment(
                    offeringAddress,
                    await paymentToken.getAddress(),
                    investmentAmount
                )
            ).to.be.revertedWith("Sale not started");

            // Try to invest after sale ends
            await time.increaseTo(config.endDate + 10);
            
            await expect(
                investmentManager.connect(investor1).routeInvestment(
                    offeringAddress,
                    await paymentToken.getAddress(),
                    investmentAmount
                )
            ).to.be.revertedWith("Sale ended");
        });
    });

    describe("9. Multiple Offerings Management", function () {
        it("Should track multiple offerings correctly", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle } = fixture;
            
            // Create first offering without APY
            const config1 = await createOfferingConfig(fixture, false);
            await offeringFactory.connect(deployer).createOfferingWithPaymentTokens(
                config1,
                [await paymentToken.getAddress()],
                [await paymentOracle.getAddress()]
            );

            // Create second offering with APY
            const config2 = await createOfferingConfig(fixture, true);
            await offeringFactory.connect(deployer).createOfferingWithPaymentTokens(
                config2,
                [await paymentToken.getAddress()],
                [await paymentOracle.getAddress()]
            );

            expect(await offeringFactory.count()).to.equal(2);

            const offering1Address = await offeringFactory.getOfferingAddress(0);
            const offering2Address = await offeringFactory.getOfferingAddress(1);

            const offering1 = await ethers.getContractAt("Offering", offering1Address);
            const offering2 = await ethers.getContractAt("Offering", offering2Address);

            expect(await offering1.apyEnabled()).to.be.false;
            expect(await offering2.apyEnabled()).to.be.true;
        });

        it("Should return all offerings", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle } = fixture;
            
            const config = await createOfferingConfig(fixture, false);
            
            // Create 3 offerings
            for (let i = 0; i < 3; i++) {
                await offeringFactory.connect(deployer).createOfferingWithPaymentTokens(
                    config,
                    [await paymentToken.getAddress()],
                    [await paymentOracle.getAddress()]
                );
            }

            const allOfferings = await offeringFactory.getAllOfferings();
            expect(allOfferings.length).to.equal(3);
            expect(allOfferings[0]).to.not.equal(ethers.ZeroAddress);
            expect(allOfferings[1]).to.not.equal(ethers.ZeroAddress);
            expect(allOfferings[2]).to.not.equal(ethers.ZeroAddress);
        });
    });

    describe("10. Complete End-to-End Flow", function () {
        it("Should handle complete offering lifecycle without APY", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, investmentManager, investor1, investor2, escrow, treasuryOwner } = fixture;
            
            // 1. Create offering
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

            // 2. Setup tokens
            await saleToken.connect(tokenOwner).transfer(offeringAddress, ethers.parseUnits("200000"));
            
            // 3. Start sale and investments
            await time.increaseTo(config.startDate + 10);
            
            const investment1 = ethers.parseUnits("1000");
            const investment2 = ethers.parseUnits("2000");
            
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investment1);
            await paymentToken.connect(investor2).approve(await offering.getAddress(), investment2);
            
            await investmentManager.connect(investor1).routeInvestment(offeringAddress, await paymentToken.getAddress(), investment1);
            await investmentManager.connect(investor2).routeInvestment(offeringAddress, await paymentToken.getAddress(), investment2);

            // 4. Verify investments
            expect(await offering.totalRaised()).to.equal(ethers.parseUnits("3000"));
            expect(await offering.pendingTokens(investor1.address)).to.equal(ethers.parseUnits("2000"));
            expect(await offering.pendingTokens(investor2.address)).to.equal(ethers.parseUnits("4000"));

            // 5. Finalize offering
            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(offeringAddress);
            
            // 6. Claim tokens
            const initialBalance1 = await saleToken.balanceOf(investor1.address);
            const initialBalance2 = await saleToken.balanceOf(investor2.address);
            
            await investmentManager.connect(investor1).claimInvestmentTokens(offeringAddress);
            await investmentManager.connect(investor2).claimInvestmentTokens(offeringAddress);
            
            const finalBalance1 = await saleToken.balanceOf(investor1.address);
            const finalBalance2 = await saleToken.balanceOf(investor2.address);
            
            expect(finalBalance1 - initialBalance1).to.equal(ethers.parseUnits("2000"));
            expect(finalBalance2 - initialBalance2).to.equal(ethers.parseUnits("4000"));
        });

        it("Should handle complete offering lifecycle with APY", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, investmentManager, investor1, escrow, treasuryOwner, payoutToken, payoutAdmin } = fixture;
            
            // 1. Create APY offering
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

            // 2. Setup
            await saleToken.connect(tokenOwner).transfer(offeringAddress, ethers.parseUnits("200000"));
            const PAYOUT_ADMIN_ROLE = await wrappedToken.PAYOUT_ADMIN_ROLE();
            await wrappedToken.connect(deployer).grantRole(PAYOUT_ADMIN_ROLE, payoutAdmin.address);
            
            // 3. Investment
            const currentTime = await time.latest();
            const safeStartTime = Math.max(currentTime + 100, config.startDate);
            await time.increaseTo(safeStartTime);
            const investmentAmount = ethers.parseUnits("1000");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(offeringAddress, await paymentToken.getAddress(), investmentAmount);

            await time.increaseTo(safeStartTime + 3700); // 1 hour + 100 seconds after safe start
            await escrow.connect(treasuryOwner).finalizeOffering(offeringAddress);
            await investmentManager.connect(investor1).claimInvestmentTokens(offeringAddress);

            // 5. Verify wrapped tokens
            const wrappedBalance = await wrappedToken.balanceOf(investor1.address);
            expect(wrappedBalance).to.equal(ethers.parseUnits("2000"));

            // 6. Payout distribution
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(Number(firstPayoutDate) + 10);
            
            const payoutAmount = ethers.parseUnits("100");
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payoutAmount);

            // 7. Claim payout
            const initialPayoutBalance = await payoutToken.balanceOf(investor1.address);
            await wrappedToken.connect(investor1).claimAvailablePayouts();
            const finalPayoutBalance = await payoutToken.balanceOf(investor1.address);
            expect(finalPayoutBalance - initialPayoutBalance).to.equal(payoutAmount);

            // 8. Final token redemption at maturity
            await time.increaseTo(config.maturityDate + 10);
            const initialSaleBalance = await saleToken.balanceOf(investor1.address);
            await wrappedToken.connect(investor1).claimFinalTokens();
            const finalSaleBalance = await saleToken.balanceOf(investor1.address);
            expect(finalSaleBalance - initialSaleBalance).to.equal(ethers.parseUnits("2000"));
        });
    });
});