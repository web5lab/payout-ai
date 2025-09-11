const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Offering Contract", function () {
    async function deployOfferingEcosystemFixture() {
        const [admin, tokenOwner, treasuryOwner, investmentManager, investor1, investor2] = await ethers.getSigners();

        // Deploy mock tokens
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const saleToken = await MockERC20.deploy("Sale Token", "SALE");
        const paymentToken = await MockERC20.deploy("Payment Token", "PAY");
        const payoutToken = await MockERC20.deploy("Payout Token", "PAYOUT");

        // Deploy mock oracles
        const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
        const payOracle = await MockV3Aggregator.deploy(ethers.parseUnits("1.0", 18), true);
        const ethOracle = await MockV3Aggregator.deploy(ethers.parseUnits("2000", 18), true);

        // Deploy escrow
        const Escrow = await ethers.getContractFactory("Escrow");
        const escrow = await Escrow.deploy({ owner: treasuryOwner.address });

        // Deploy offering
        const Offering = await ethers.getContractFactory("Offering");
        const offering = await Offering.deploy();
        
        return { 
            offering, escrow, admin, tokenOwner, treasuryOwner, investmentManager, 
            investor1, investor2, saleToken, paymentToken, payoutToken, payOracle, ethOracle 
        };
    }

    async function initializeOffering(fixture, config = {}) {
        const { 
            offering, escrow, admin, tokenOwner, investmentManager, 
            saleToken, payoutToken 
        } = fixture;

        const now = await time.latest();
        const initConfig = {
            saleToken: await saleToken.getAddress(),
            minInvestment: ethers.parseUnits("100", 18),
            maxInvestment: ethers.parseUnits("5000", 18),
            startDate: now + 300,
            endDate: now + 300 + 3600,
            softCap: ethers.parseUnits("10000", 18),
            fundraisingCap: ethers.parseUnits("100000", 18),
            tokenPrice: ethers.parseUnits("0.5", 18),
            tokenOwner: tokenOwner.address,
            escrowAddress: await escrow.getAddress(),
            apyEnabled: config.apyEnabled || false,
            wrappedTokenAddress: config.wrappedTokenAddress || ethers.ZeroAddress,
            investmentManager: investmentManager.address,
            payoutTokenAddress: await payoutToken.getAddress(),
            payoutRate: 1200
        };

        await offering.connect(admin).initialize(initConfig);
        
        return { ...initConfig };
    }

    describe("Initialization", function () {
        it("Should initialize with correct parameters", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, saleToken, tokenOwner } = fixture;
            const config = await initializeOffering(fixture);

            expect(await offering.saleToken()).to.equal(await saleToken.getAddress());
            expect(await offering.minInvestment()).to.equal(config.minInvestment);
            expect(await offering.maxInvestment()).to.equal(config.maxInvestment);
            expect(await offering.startDate()).to.equal(config.startDate);
            expect(await offering.endDate()).to.equal(config.endDate);
            expect(await offering.softCap()).to.equal(config.softCap);
            expect(await offering.fundraisingCap()).to.equal(config.fundraisingCap);
            expect(await offering.tokenPrice()).to.equal(config.tokenPrice);
            
            const TOKEN_OWNER_ROLE = await offering.TOKEN_OWNER_ROLE();
            expect(await offering.hasRole(TOKEN_OWNER_ROLE, tokenOwner.address)).to.be.true;
        });

        it("Should prevent double initialization", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            await initializeOffering(fixture);
            
            await expect(initializeOffering(fixture))
                .to.be.revertedWith("Already initialized");
        });

        it("Should validate initialization parameters", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, admin, escrow, investmentManager, payoutToken } = fixture;

            const now = await time.latest();
            const invalidConfig = {
                saleToken: ethers.ZeroAddress, // Invalid
                minInvestment: ethers.parseUnits("100", 18),
                maxInvestment: ethers.parseUnits("5000", 18),
                startDate: now + 300,
                endDate: now + 300 + 3600,
                softCap: ethers.parseUnits("10000", 18),
                fundraisingCap: ethers.parseUnits("100000", 18),
                tokenPrice: ethers.parseUnits("0.5", 18),
                tokenOwner: admin.address,
                escrowAddress: await escrow.getAddress(),
                apyEnabled: false,
                wrappedTokenAddress: ethers.ZeroAddress,
                investmentManager: investmentManager.address,
                payoutTokenAddress: await payoutToken.getAddress(),
                payoutRate: 1200
            };

            await expect(offering.connect(admin).initialize(invalidConfig))
                .to.be.revertedWith("Invalid sale token");
        });
    });

    describe("Investment Processing", function () {
        it("Should process valid investment", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, admin, investmentManager, investor1, paymentToken, payOracle } = fixture;
            const config = await initializeOffering(fixture);

            // Configure payment token and oracle
            await offering.connect(admin).setWhitelistedPaymentToken(await paymentToken.getAddress(), true);
            await offering.connect(admin).setTokenOracle(await paymentToken.getAddress(), await payOracle.getAddress());

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("500", 18); // $500
            await paymentToken.mint(investor1.address, investmentAmount);
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);

            await expect(offering.connect(investmentManager).invest(
                await paymentToken.getAddress(),
                investor1.address,
                investmentAmount
            ))
                .to.emit(offering, "Invested")
                .withArgs(investor1.address, await paymentToken.getAddress(), investmentAmount, ethers.parseUnits("1000", 18));

            expect(await offering.totalRaised()).to.equal(ethers.parseUnits("500", 18));
        });

        it("Should enforce investment limits", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, admin, investmentManager, investor1, paymentToken, payOracle } = fixture;
            const config = await initializeOffering(fixture);

            await offering.connect(admin).setWhitelistedPaymentToken(await paymentToken.getAddress(), true);
            await offering.connect(admin).setTokenOracle(await paymentToken.getAddress(), await payOracle.getAddress());

            await time.increaseTo(config.startDate + 10);

            // Test below minimum
            const belowMin = ethers.parseUnits("50", 18); // $50 < $100 min
            await paymentToken.mint(investor1.address, belowMin);
            await paymentToken.connect(investor1).approve(await offering.getAddress(), belowMin);

            await expect(offering.connect(investmentManager).invest(
                await paymentToken.getAddress(),
                investor1.address,
                belowMin
            )).to.be.revertedWith("Below min investment");
        });

        it("Should close sale when fundraising cap reached", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, admin, investmentManager, investor1, paymentToken, payOracle } = fixture;
            const config = await initializeOffering(fixture);

            await offering.connect(admin).setWhitelistedPaymentToken(await paymentToken.getAddress(), true);
            await offering.connect(admin).setTokenOracle(await paymentToken.getAddress(), await payOracle.getAddress());

            await time.increaseTo(config.startDate + 10);

            // Invest up to cap
            const capAmount = ethers.parseUnits("100000", 18); // Fundraising cap
            await paymentToken.mint(investor1.address, capAmount);
            await paymentToken.connect(investor1).approve(await offering.getAddress(), capAmount);

            await expect(offering.connect(investmentManager).invest(
                await paymentToken.getAddress(),
                investor1.address,
                capAmount
            ))
                .to.emit(offering, "SaleClosed")
                .withArgs(capAmount);

            expect(await offering.isSaleClosed()).to.be.true;
        });

        it("Should emit soft cap reached event", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, admin, investmentManager, investor1, paymentToken, payOracle } = fixture;
            const config = await initializeOffering(fixture);

            await offering.connect(admin).setWhitelistedPaymentToken(await paymentToken.getAddress(), true);
            await offering.connect(admin).setTokenOracle(await paymentToken.getAddress(), await payOracle.getAddress());

            await time.increaseTo(config.startDate + 10);

            const softCapAmount = ethers.parseUnits("10000", 18);
            await paymentToken.mint(investor1.address, softCapAmount);
            await paymentToken.connect(investor1).approve(await offering.getAddress(), softCapAmount);

            await expect(offering.connect(investmentManager).invest(
                await paymentToken.getAddress(),
                investor1.address,
                softCapAmount
            ))
                .to.emit(offering, "SoftCapReached")
                .withArgs(softCapAmount, config.softCap);
        });
    });

    describe("Offering Lifecycle", function () {
        it("Should finalize offering correctly", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, escrow, treasuryOwner } = fixture;
            const config = await initializeOffering(fixture);

            await time.increaseTo(config.endDate + 10);

            await expect(escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress()))
                .to.emit(offering, "OfferingFinalized");

            expect(await offering.isOfferingFinalized()).to.be.true;
            expect(await offering.isSaleClosed()).to.be.true;
        });

        it("Should cancel offering and enable refunds", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, tokenOwner } = fixture;
            await initializeOffering(fixture);

            await expect(offering.connect(tokenOwner).cancelOffering())
                .to.emit(offering, "OfferingCancelled");

            expect(await offering.isOfferingCancelled()).to.be.true;
            expect(await offering.isSaleClosed()).to.be.true;
        });

        it("Should allow early finalization when soft cap reached", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, admin, tokenOwner, investmentManager, investor1, paymentToken, payOracle } = fixture;
            const config = await initializeOffering(fixture);

            await offering.connect(admin).setWhitelistedPaymentToken(await paymentToken.getAddress(), true);
            await offering.connect(admin).setTokenOracle(await paymentToken.getAddress(), await payOracle.getAddress());

            await time.increaseTo(config.startDate + 10);

            // Reach soft cap
            const softCapAmount = ethers.parseUnits("10000", 18);
            await paymentToken.mint(investor1.address, softCapAmount);
            await paymentToken.connect(investor1).approve(await offering.getAddress(), softCapAmount);

            await offering.connect(investmentManager).invest(
                await paymentToken.getAddress(),
                investor1.address,
                softCapAmount
            );

            // Early finalization
            await expect(offering.connect(tokenOwner).finalizeOfferingSoftCap())
                .to.emit(offering, "OfferingFinalized");

            expect(await offering.isOfferingFinalized()).to.be.true;
        });
    });

    describe("Token Claims", function () {
        it("Should allow token claims after finalization", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, escrow, admin, tokenOwner, treasuryOwner, investmentManager, investor1, paymentToken, saleToken, payOracle } = fixture;
            const config = await initializeOffering(fixture);

            await offering.connect(admin).setWhitelistedPaymentToken(await paymentToken.getAddress(), true);
            await offering.connect(admin).setTokenOracle(await paymentToken.getAddress(), await payOracle.getAddress());

            // Register offering in escrow
            await escrow.connect(treasuryOwner).registerOffering(await offering.getAddress(), tokenOwner.address);

            await time.increaseTo(config.startDate + 10);

            // Make investment
            const investmentAmount = ethers.parseUnits("1000", 18);
            const expectedTokens = ethers.parseUnits("2000", 18);
            
            await paymentToken.mint(investor1.address, investmentAmount);
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await saleToken.mint(tokenOwner.address, expectedTokens);
            await saleToken.connect(tokenOwner).transfer(await offering.getAddress(), expectedTokens);

            await offering.connect(investmentManager).invest(
                await paymentToken.getAddress(),
                investor1.address,
                investmentAmount
            );

            // Finalize offering
            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());

            // Claim tokens
            await expect(offering.connect(investmentManager).claimTokens(investor1.address))
                .to.emit(offering, "Claimed")
                .withArgs(investor1.address, expectedTokens);

            expect(await saleToken.balanceOf(investor1.address)).to.equal(expectedTokens);
        });

        it("Should prevent claims before finalization", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, admin, investmentManager, investor1, paymentToken, payOracle } = fixture;
            const config = await initializeOffering(fixture);

            await offering.connect(admin).setWhitelistedPaymentToken(await paymentToken.getAddress(), true);
            await offering.connect(admin).setTokenOracle(await paymentToken.getAddress(), await payOracle.getAddress());

            await time.increaseTo(config.startDate + 10);

            const investmentAmount = ethers.parseUnits("500", 18);
            await paymentToken.mint(investor1.address, investmentAmount);
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);

            await offering.connect(investmentManager).invest(
                await paymentToken.getAddress(),
                investor1.address,
                investmentAmount
            );

            await expect(offering.connect(investmentManager).claimTokens(investor1.address))
                .to.be.revertedWith("Offering not finalized yet");
        });
    });

    describe("Oracle Integration", function () {
        it("Should calculate USD value using oracle", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, admin, investmentManager, investor1, paymentToken, payOracle } = fixture;
            const config = await initializeOffering(fixture);

            await offering.connect(admin).setWhitelistedPaymentToken(await paymentToken.getAddress(), true);
            await offering.connect(admin).setTokenOracle(await paymentToken.getAddress(), await payOracle.getAddress());

            await time.increaseTo(config.startDate + 10);

            // Oracle returns 1.0 USD per PAY token
            const paymentAmount = ethers.parseUnits("500", 18); // 500 PAY = $500
            const expectedUSDValue = ethers.parseUnits("500", 18);
            const expectedTokens = ethers.parseUnits("1000", 18); // $500 / $0.5 = 1000 tokens

            await paymentToken.mint(investor1.address, paymentAmount);
            await paymentToken.connect(investor1).approve(await offering.getAddress(), paymentAmount);

            await offering.connect(investmentManager).invest(
                await paymentToken.getAddress(),
                investor1.address,
                paymentAmount
            );

            expect(await offering.totalRaised()).to.equal(expectedUSDValue);
            expect(await offering.pendingTokens(investor1.address)).to.equal(expectedTokens);
        });

        it("Should revert with stale oracle data", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, admin, investmentManager, investor1, paymentToken } = fixture;
            const config = await initializeOffering(fixture);

            // Deploy oracle with stale data
            const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
            const staleOracle = await MockV3Aggregator.deploy(ethers.parseUnits("1.0", 18), false); // Not fresh

            await offering.connect(admin).setWhitelistedPaymentToken(await paymentToken.getAddress(), true);
            await offering.connect(admin).setTokenOracle(await paymentToken.getAddress(), await staleOracle.getAddress());

            await time.increaseTo(config.startDate + 10);

            const paymentAmount = ethers.parseUnits("500", 18);
            await paymentToken.mint(investor1.address, paymentAmount);
            await paymentToken.connect(investor1).approve(await offering.getAddress(), paymentAmount);

            await expect(offering.connect(investmentManager).invest(
                await paymentToken.getAddress(),
                investor1.address,
                paymentAmount
            )).to.be.revertedWith("Price data too stale");
        });
    });

    describe("Admin Functions", function () {
        it("Should allow admin to pause and unpause", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, admin } = fixture;
            await initializeOffering(fixture);

            await offering.connect(admin).pause();
            expect(await offering.paused()).to.be.true;

            await offering.connect(admin).unpause();
            expect(await offering.paused()).to.be.false;
        });

        it("Should allow admin to set payment token whitelist", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, admin, paymentToken } = fixture;
            await initializeOffering(fixture);

            await expect(offering.connect(admin).setWhitelistedPaymentToken(
                await paymentToken.getAddress(), 
                true
            ))
                .to.emit(offering, "PaymentTokenWhitelisted")
                .withArgs(await paymentToken.getAddress(), true);

            expect(await offering.whitelistedPaymentTokens(await paymentToken.getAddress())).to.be.true;
        });

        it("Should allow admin to set token oracle", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, admin, paymentToken, payOracle } = fixture;
            await initializeOffering(fixture);

            await expect(offering.connect(admin).setTokenOracle(
                await paymentToken.getAddress(),
                await payOracle.getAddress()
            ))
                .to.emit(offering, "OracleSet")
                .withArgs(await paymentToken.getAddress(), await payOracle.getAddress());

            expect(await offering.tokenOracles(await paymentToken.getAddress()))
                .to.equal(await payOracle.getAddress());
        });

        it("Should allow token owner to reclaim unclaimed tokens", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, escrow, admin, tokenOwner, treasuryOwner, investmentManager, investor1, paymentToken, saleToken, payOracle } = fixture;
            const config = await initializeOffering(fixture);

            await offering.connect(admin).setWhitelistedPaymentToken(await paymentToken.getAddress(), true);
            await offering.connect(admin).setTokenOracle(await paymentToken.getAddress(), await payOracle.getAddress());
            await escrow.connect(treasuryOwner).registerOffering(await offering.getAddress(), tokenOwner.address);

            // Transfer more tokens than will be claimed
            const totalTokens = ethers.parseUnits("10000", 18);
            await saleToken.mint(tokenOwner.address, totalTokens);
            await saleToken.connect(tokenOwner).transfer(await offering.getAddress(), totalTokens);

            await time.increaseTo(config.startDate + 10);

            // Small investment
            const investmentAmount = ethers.parseUnits("500", 18);
            await paymentToken.mint(investor1.address, investmentAmount);
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);

            await offering.connect(investmentManager).invest(
                await paymentToken.getAddress(),
                investor1.address,
                investmentAmount
            );

            // Finalize
            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());

            // Reclaim unclaimed tokens
            const unclaimedAmount = ethers.parseUnits("9000", 18); // 10000 - 1000 claimed
            
            await expect(offering.connect(tokenOwner).reclaimUnclaimedTokens(tokenOwner.address))
                .to.emit(offering, "UnclaimedTokensReclaimed")
                .withArgs(tokenOwner.address, unclaimedAmount);
        });
    });

    describe("Status Queries", function () {
        it("Should return correct offering status", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering } = fixture;
            const config = await initializeOffering(fixture);

            // Before start
            let status = await offering.getOfferingStatus();
            expect(status.saleActive).to.be.false;
            expect(status.finalized).to.be.false;
            expect(status.cancelled).to.be.false;

            // During sale
            await time.increaseTo(config.startDate + 10);
            status = await offering.getOfferingStatus();
            expect(status.saleActive).to.be.true;

            // After end
            await time.increaseTo(config.endDate + 10);
            status = await offering.getOfferingStatus();
            expect(status.saleActive).to.be.false;
        });

        it("Should check finalization conditions", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering } = fixture;
            const config = await initializeOffering(fixture);

            // Before end date
            expect(await offering.canFinalize()).to.be.false;

            // After end date
            await time.increaseTo(config.endDate + 10);
            expect(await offering.canFinalize()).to.be.true;
        });
    });
});