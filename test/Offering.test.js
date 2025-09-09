const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Offering Contract (Integrated)", function () {
    const MIN_INVESTMENT = ethers.parseUnits("100", 18);
    const MAX_INVESTMENT = ethers.parseUnits("5000", 18);
    const FUNDRAISING_CAP = ethers.parseUnits("100000", 18);
    const TOKEN_PRICE = ethers.parseUnits("0.1", 18);

    async function deployOfferingEcosystemFixture() {
        const [admin, tokenOwner, treasuryOwner, investor1, investor2, otherAccount, investmentManager] = await ethers.getSigners();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const saleToken = await MockERC20.deploy("Sale Token", "SALE");
        const paymentToken = await MockERC20.deploy("Payment Token", "PAY");

        const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
        const price = ethers.parseUnits("2", 18);
        const oracle = await MockV3Aggregator.deploy(price, true);

        const Offering = await ethers.getContractFactory("Offering");
        const offering = await Offering.deploy();
        
        return { offering, admin, tokenOwner, treasuryOwner, investor1, investor2, otherAccount, investmentManager, saleToken, paymentToken, oracle };
    }

    async function initializeOffering(fixture, config) {
        const { offering, admin, tokenOwner, treasuryOwner, saleToken, investmentManager } = fixture;
        const { apyEnabled, autoTransfer } = config;

        const latestTime = await time.latest();
        const startDate = latestTime + 100;
        const endDate = startDate + (10 * 24 * 60 * 60);
        const maturityDate = endDate + (30 * 24 * 60 * 60);

        const Escrow = await ethers.getContractFactory("Escrow");
        const escrow = await Escrow.deploy(treasuryOwner.address, offering.target);

        let wrappedToken;
        let wrappedTokenAddress = ethers.ZeroAddress;
        if (apyEnabled) {
            const WRAPEDTOKEN = await ethers.getContractFactory("WRAPEDTOKEN");
            wrappedToken = await WRAPEDTOKEN.deploy("Wrapped Sale", "wSALE", saleToken.target, maturityDate, offering.target);
            wrappedTokenAddress = wrappedToken.target;
        }

        await offering.connect(admin).initialize(
            saleToken.target, MIN_INVESTMENT, MAX_INVESTMENT,
            startDate, endDate, maturityDate,
            autoTransfer || false,
            FUNDRAISING_CAP, TOKEN_PRICE, tokenOwner.address,
            escrow.target, apyEnabled, wrappedTokenAddress,
            investmentManager.address
        );
        
        return { escrow, wrappedToken, startDate, endDate, maturityDate };
    }

    describe("Initialization", function () {
        it("Should initialize with correct values", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, saleToken, tokenOwner } = fixture;
            const { startDate, endDate, maturityDate, escrow } = await initializeOffering(fixture, { apyEnabled: false });

            expect(await offering.saleToken()).to.equal(saleToken.target);
            expect(await offering.minInvestment()).to.equal(MIN_INVESTMENT);
            expect(await offering.maxInvestment()).to.equal(MAX_INVESTMENT);
            expect(await offering.startDate()).to.equal(startDate);
            expect(await offering.endDate()).to.equal(endDate);
            expect(await offering.maturityDate()).to.equal(maturityDate);
            expect(await offering.fundraisingCap()).to.equal(FUNDRAISING_CAP);
            expect(await offering.tokenPrice()).to.equal(TOKEN_PRICE);
            expect(await offering.hasRole(await offering.TOKEN_OWNER_ROLE(), tokenOwner.address)).to.be.true;
            expect(await offering.escrowAddress()).to.equal(escrow.target);
        });

        it("Should revert if already initialized", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            await initializeOffering(fixture, { apyEnabled: false });
            await expect(initializeOffering(fixture, { apyEnabled: false })).to.be.revertedWith("Already initialized");
        });

        it("Should revert with invalid sale token address", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, admin, tokenOwner, investmentManager } = fixture;
            await expect(offering.connect(admin).initialize(
                ethers.ZeroAddress, MIN_INVESTMENT, MAX_INVESTMENT, 0, 0, 0, false, FUNDRAISING_CAP, TOKEN_PRICE, tokenOwner.address, ethers.ZeroAddress, false, ethers.ZeroAddress, investmentManager.address
            )).to.be.revertedWith("Invalid sale token");
        });
    });

    describe("Investment Logic", function () {
        it("Should process a valid investment", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, admin, investor1, paymentToken, oracle, investmentManager } = fixture;
            const { escrow, startDate } = await initializeOffering(fixture, { apyEnabled: false });

            await offering.connect(admin).setWhitelistedPaymentToken(paymentToken.target, true);
            await offering.connect(admin).setTokenOracle(paymentToken.target, oracle.target);

            const paymentAmount = ethers.parseUnits("100", 18);
            await paymentToken.mint(investor1.address, paymentAmount);
            await paymentToken.connect(investor1).approve(offering.target, paymentAmount);

            await time.increaseTo(startDate);
            await offering.connect(investmentManager).invest(paymentToken.target, investor1.address, paymentAmount);

            const expectedUsdValue = ethers.parseUnits("200", 18);
            expect(await offering.totalRaised()).to.equal(expectedUsdValue);
            expect(await paymentToken.balanceOf(escrow.target)).to.equal(paymentAmount);
        });

        it("Should revert if sale is not open", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, admin, investor1, paymentToken, oracle, investmentManager } = fixture;
            await initializeOffering(fixture, { apyEnabled: false });
            await offering.connect(admin).setWhitelistedPaymentToken(paymentToken.target, true);
            await offering.connect(admin).setTokenOracle(paymentToken.target, oracle.target);
            const paymentAmount = ethers.parseUnits("100", 18);
            await expect(offering.connect(investmentManager).invest(paymentToken.target, investor1.address, paymentAmount)).to.be.revertedWith("Sale not started");
        });

        it("Should revert if investment is below minimum", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, admin, investor1, paymentToken, oracle, investmentManager } = fixture;
            const { startDate } = await initializeOffering(fixture, { apyEnabled: false });
            await offering.connect(admin).setWhitelistedPaymentToken(paymentToken.target, true);
            await offering.connect(admin).setTokenOracle(paymentToken.target, oracle.target);
            const paymentAmount = ethers.parseUnits("10", 18); // Below $100 USD value
            await paymentToken.mint(investor1.address, paymentAmount);
            await paymentToken.connect(investor1).approve(offering.target, paymentAmount);
            await time.increaseTo(startDate);
            await expect(offering.connect(investmentManager).invest(paymentToken.target, investor1.address, paymentAmount)).to.be.revertedWith("Below min investment");
        });

        it("Should revert if investment exceeds maximum", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, admin, investor1, paymentToken, oracle, investmentManager } = fixture;
            const { startDate } = await initializeOffering(fixture, { apyEnabled: false });
            await offering.connect(admin).setWhitelistedPaymentToken(paymentToken.target, true);
            await offering.connect(admin).setTokenOracle(paymentToken.target, oracle.target);
            const paymentAmount = ethers.parseUnits("3000", 18); // Above $5000 USD value
            await paymentToken.mint(investor1.address, paymentAmount);
            await paymentToken.connect(investor1).approve(offering.target, paymentAmount);
            await time.increaseTo(startDate);
            await expect(offering.connect(investmentManager).invest(paymentToken.target, investor1.address, paymentAmount)).to.be.revertedWith("Exceeds max investment");
        });

        it("Should revert if fundraising cap is exceeded", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, admin, tokenOwner, investor1, investor2, paymentToken, oracle, investmentManager } = fixture;
            const { startDate } = await initializeOffering(fixture, { apyEnabled: false });
            await offering.connect(admin).setWhitelistedPaymentToken(paymentToken.target, true);
            await offering.connect(admin).setTokenOracle(paymentToken.target, oracle.target);
            await offering.connect(tokenOwner).setInvestmentLimits(MIN_INVESTMENT, ethers.parseUnits("100000", 18));


            // investor1 invests close to the cap
            const paymentAmount1 = ethers.parseUnits("49900", 18); // 99800 USD
            await paymentToken.mint(investor1.address, paymentAmount1);
            await paymentToken.connect(investor1).approve(offering.target, paymentAmount1);
            await time.increaseTo(startDate);
            await offering.connect(investmentManager).invest(paymentToken.target, investor1.address, paymentAmount1);

            // investor2 tries to invest, which would exceed the cap
            const paymentAmount2 = ethers.parseUnits("101", 18); // 202 USD
            await paymentToken.mint(investor2.address, paymentAmount2);
            await paymentToken.connect(investor2).approve(offering.target, paymentAmount2);
            await expect(offering.connect(investmentManager).invest(paymentToken.target, investor2.address, paymentAmount2)).to.be.revertedWith("Exceeds cap");
        });
    });

    describe("Claiming Logic", function () {
        it("Should allow claiming after maturity", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, admin, investor1, saleToken, paymentToken, oracle, investmentManager } = fixture;
            const { maturityDate, startDate } = await initializeOffering(fixture, { apyEnabled: false, autoTransfer: false });

            await offering.connect(admin).setWhitelistedPaymentToken(paymentToken.target, true);
            await offering.connect(admin).setTokenOracle(paymentToken.target, oracle.target);
            
            const paymentAmount = ethers.parseUnits("100", 18);
            const expectedTokens = ethers.parseUnits("2000", 18);
            await saleToken.mint(offering.target, expectedTokens);
            await paymentToken.mint(investor1.address, paymentAmount);
            await paymentToken.connect(investor1).approve(offering.target, paymentAmount);

            await time.increaseTo(startDate);
            await offering.connect(investmentManager).invest(paymentToken.target, investor1.address, paymentAmount);
            
            await time.increaseTo(maturityDate + 1);
            await expect(offering.connect(investor1).claimTokens()).to.changeTokenBalances(
                saleToken,
                [offering, investor1],
                [-expectedTokens, expectedTokens]
            );
        });

        it("Should revert claiming before maturity", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, admin, investor1, paymentToken, oracle, investmentManager } = fixture;
            const { startDate } = await initializeOffering(fixture, { apyEnabled: false, autoTransfer: false });

            await offering.connect(admin).setWhitelistedPaymentToken(paymentToken.target, true);
            await offering.connect(admin).setTokenOracle(paymentToken.target, oracle.target);
            
            const paymentAmount = ethers.parseUnits("100", 18);
            await paymentToken.mint(investor1.address, paymentAmount);
            await paymentToken.connect(investor1).approve(offering.target, paymentAmount);

            await time.increaseTo(startDate);
            await offering.connect(investmentManager).invest(paymentToken.target, investor1.address, paymentAmount);
            
            await expect(offering.connect(investor1).claimTokens()).to.be.revertedWith("Maturity not reached");
        });

        it("Should revert if no tokens to claim", async function () {
            const fixture = await loadFixture(deployOfferingEcosystemFixture);
            const { offering, investor1 } = fixture;
            const { maturityDate } = await initializeOffering(fixture, { apyEnabled: false, autoTransfer: false });
            await time.increaseTo(maturityDate + 1);
            await expect(offering.connect(investor1).claimTokens()).to.be.revertedWith("No tokens to claim");
        });
    });

    describe("Admin Functions", function () {
        it("Should allow admin to set whitelisted token", async function () {
            const { offering, admin, paymentToken, investmentManager } = await loadFixture(deployOfferingEcosystemFixture);
            await initializeOffering({ offering, admin, tokenOwner: admin, treasuryOwner: admin, saleToken: paymentToken, investmentManager }, { apyEnabled: false });
            await offering.connect(admin).setWhitelistedPaymentToken(paymentToken.target, true);
            expect(await offering.whitelistedPaymentTokens(paymentToken.target)).to.be.true;
        });

        it("Should allow admin to set token oracle", async function () {
            const { offering, admin, paymentToken, oracle, investmentManager } = await loadFixture(deployOfferingEcosystemFixture);
            await initializeOffering({ offering, admin, tokenOwner: admin, treasuryOwner: admin, saleToken: paymentToken, investmentManager }, { apyEnabled: false });
            await offering.connect(admin).setTokenOracle(paymentToken.target, oracle.target);
            expect(await offering.tokenOracles(paymentToken.target)).to.equal(oracle.target);
        });

        it("Should allow token owner to set token price", async function () {
            const { offering, admin, tokenOwner, paymentToken, investmentManager } = await loadFixture(deployOfferingEcosystemFixture);
            await initializeOffering({ offering, admin, tokenOwner, treasuryOwner: admin, saleToken: paymentToken, investmentManager }, { apyEnabled: false });
            const newPrice = ethers.parseUnits("0.2", 18);
            await offering.connect(tokenOwner).setTokenPrice(newPrice);
            expect(await offering.tokenPrice()).to.equal(newPrice);
        });

        it("Should revert if non-admin tries to set whitelisted token", async function () {
            const { offering, admin, otherAccount, paymentToken, investmentManager } = await loadFixture(deployOfferingEcosystemFixture);
            await initializeOffering({ offering, admin, tokenOwner: admin, treasuryOwner: admin, saleToken: paymentToken, investmentManager }, { apyEnabled: false });
            await expect(offering.connect(otherAccount).setWhitelistedPaymentToken(paymentToken.target, true)).to.be.reverted;
        });

        it("Should revert if non-token-owner tries to set token price", async function () {
            const { offering, admin, otherAccount, paymentToken, investmentManager } = await loadFixture(deployOfferingEcosystemFixture);
            await initializeOffering({ offering, admin, tokenOwner: admin, treasuryOwner: admin, saleToken: paymentToken, investmentManager }, { apyEnabled: false });
            const newPrice = ethers.parseUnits("0.2", 18);
            await expect(offering.connect(otherAccount).setTokenPrice(newPrice)).to.be.reverted;
        });
    });
});
