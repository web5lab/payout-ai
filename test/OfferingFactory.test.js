const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OfferingFactory (Integrated)", function () {
    let OfferingFactory, offeringFactory, owner, addr1, tokenOwner, treasuryOwner, investmentManager;
    let saleToken, paymentToken1, paymentToken2;
    let oracle1, oracle2;

    const getTimestamps = async (durationInDays) => {
        const latestBlock = await ethers.provider.getBlock("latest");
        const now = latestBlock.timestamp;
        const oneDay = 24 * 60 * 60;
        const startDate = now + oneDay;
        const endDate = startDate + durationInDays * oneDay;
        const maturityDate = endDate + 30 * oneDay;
        return { startDate, endDate, maturityDate };
    };

    beforeEach(async function () {
        [owner, addr1, tokenOwner, treasuryOwner, investmentManager] = await ethers.getSigners();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        saleToken = await MockERC20.deploy("Sale Token", "SALE");
        paymentToken1 = await MockERC20.deploy("DAI Stablecoin", "DAI");
        paymentToken2 = await MockERC20.deploy("USD Coin", "USDC");

        const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
        const price1 = ethers.parseUnits("0.99", 18);
        const price2 = ethers.parseUnits("1.00", 18);
        oracle1 = await MockV3Aggregator.deploy(price1, true);
        oracle2 = await MockV3Aggregator.deploy(price2, true);

        const WrappedTokenFactory = await ethers.getContractFactory("WrappedTokenFactory");
        const wrappedTokenFactory = await WrappedTokenFactory.deploy();

        OfferingFactory = await ethers.getContractFactory("OfferingFactory");
        offeringFactory = await OfferingFactory.deploy(wrappedTokenFactory.target);
    });

    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            expect(await offeringFactory.owner()).to.equal(owner.address);
        });
    });

    describe("createOffering", function () {
        it("Should deploy a full Offering ecosystem and emit event", async function () {
            const { startDate, endDate, maturityDate } = await getTimestamps(10);
            const tx = await offeringFactory.createOffering({
                saleToken: saleToken.target,
                minInvestment: 100,
                maxInvestment: 1000,
                startDate: startDate,
                endDate: endDate,
                maturityDate: maturityDate,
                autoTransfer: false,
                apyEnabled: true,
                fundraisingCap: 100000,
                tokenPrice: 1,
                tokenOwner: tokenOwner.address,
                escrowAddress: treasuryOwner.address,
                investmentManager: investmentManager.address,
                payoutTokenAddress: saleToken.target,
                payoutRate: 100,
                defaultPayoutFrequency: 0
            });
            await expect(tx).to.emit(offeringFactory, "OfferingDeployed").withArgs(0, owner.address, await offeringFactory.getOfferingAddress(0), tokenOwner.address);
        });

        it("Should correctly initialize the new Offering contract", async function () {
            const { startDate, endDate, maturityDate } = await getTimestamps(10);
            await offeringFactory.createOffering({
                saleToken: saleToken.target,
                minInvestment: 100,
                maxInvestment: 1000,
                startDate: startDate,
                endDate: endDate,
                maturityDate: maturityDate,
                autoTransfer: false,
                apyEnabled: true,
                fundraisingCap: 100000,
                tokenPrice: 1,
                tokenOwner: tokenOwner.address,
                escrowAddress: treasuryOwner.address,
                investmentManager: investmentManager.address,
                payoutTokenAddress: saleToken.target,
                payoutRate: 100,
                defaultPayoutFrequency: 0
            });
            const offeringAddress = await offeringFactory.getOfferingAddress(0);
            const offering = await ethers.getContractAt("Offering", offeringAddress);
            expect(await offering.saleToken()).to.equal(saleToken.target);
            const TOKEN_OWNER_ROLE = await offering.TOKEN_OWNER_ROLE();
            expect(await offering.hasRole(TOKEN_OWNER_ROLE, tokenOwner.address)).to.be.true;
        });

        it("Should revert if called by a non-owner", async function () {
            const { startDate, endDate, maturityDate } = await getTimestamps(10);
            await expect(
                offeringFactory.connect(addr1).createOffering({
                    saleToken: saleToken.target,
                    minInvestment: 100,
                    maxInvestment: 1000,
                    startDate: startDate,
                    endDate: endDate,
                    maturityDate: maturityDate,
                    autoTransfer: false,
                    apyEnabled: true,
                    fundraisingCap: 100000,
                    tokenPrice: 1,
                    tokenOwner: tokenOwner.address,
                    escrowAddress: treasuryOwner.address,
                    investmentManager: investmentManager.address,
                    payoutTokenAddress: saleToken.target,
                    payoutRate: 100,
                    defaultPayoutFrequency: 0
                })
            ).to.be.revertedWithCustomError(offeringFactory, "OwnableUnauthorizedAccount");
        });
    });

    describe("createOfferingWithPaymentTokens", function () {
        it("Should create an offering with multiple payment tokens", async function () {
            const { startDate, endDate, maturityDate } = await getTimestamps(10);
            const paymentTokens = [paymentToken1.target, paymentToken2.target];
            const oracles = [oracle1.target, oracle2.target];
            await offeringFactory.createOfferingWithPaymentTokens({
                saleToken: saleToken.target,
                minInvestment: 100,
                maxInvestment: 1000,
                startDate: startDate,
                endDate: endDate,
                maturityDate: maturityDate,
                autoTransfer: false,
                apyEnabled: false,
                fundraisingCap: 100000,
                tokenPrice: 1,
                tokenOwner: tokenOwner.address,
                escrowAddress: treasuryOwner.address,
                investmentManager: investmentManager.address,
                payoutTokenAddress: saleToken.target,
                payoutRate: 100,
                defaultPayoutFrequency: 0,
                paymentTokens: paymentTokens,
                oracles: oracles
            });
            const offeringAddress = await offeringFactory.getOfferingAddress(0);
            const offering = await ethers.getContractAt("Offering", offeringAddress);
            expect(await offering.whitelistedPaymentTokens(paymentToken1.target)).to.be.true;
            expect(await offering.whitelistedPaymentTokens(paymentToken2.target)).to.be.true;
            expect(await offering.tokenOracles(paymentToken1.target)).to.equal(oracle1.target);
            expect(await offering.tokenOracles(paymentToken2.target)).to.equal(oracle2.target);
        });

        it("Should revert if paymentTokens and oracles arrays have different lengths", async function () {
            const { startDate, endDate, maturityDate } = await getTimestamps(10);
            const paymentTokens = [paymentToken1.target];
            const oracles = [oracle1.target, oracle2.target];
            await expect(
                offeringFactory.createOfferingWithPaymentTokens({
                    saleToken: saleToken.target,
                    minInvestment: 100,
                    maxInvestment: 1000,
                    startDate: startDate,
                    endDate: endDate,
                    maturityDate: maturityDate,
                    autoTransfer: false,
                    apyEnabled: false,
                    fundraisingCap: 100000,
                    tokenPrice: 1,
                    tokenOwner: tokenOwner.address,
                    escrowAddress: treasuryOwner.address,
                    investmentManager: investmentManager.address,
                    payoutTokenAddress: saleToken.target,
                    payoutRate: 100,
                    defaultPayoutFrequency: 0,
                    paymentTokens: paymentTokens,
                    oracles: oracles
                })
            ).to.be.revertedWith("Array length mismatch");
        });

        it("Should revert if no payment tokens are provided", async function () {
            const { startDate, endDate, maturityDate } = await getTimestamps(10);
            await expect(
                offeringFactory.createOfferingWithPaymentTokens({
                    saleToken: saleToken.target,
                    minInvestment: 100,
                    maxInvestment: 1000,
                    startDate: startDate,
                    endDate: endDate,
                    maturityDate: maturityDate,
                    autoTransfer: false,
                    apyEnabled: false,
                    fundraisingCap: 100000,
                    tokenPrice: 1,
                    tokenOwner: tokenOwner.address,
                    escrowAddress: treasuryOwner.address,
                    investmentManager: investmentManager.address,
                    payoutTokenAddress: saleToken.target,
                    payoutRate: 100,
                    defaultPayoutFrequency: 0,
                    paymentTokens: [],
                    oracles: []
                })
            ).to.be.revertedWith("No payment tokens provided");
        });
    });

    describe("USDT Configuration", function () {
        it("Should allow owner to set USDT config", async function () {
            const usdtAddress = "0xdAC17F958D2ee523a2206206994597C13D831ec7"; // Mainnet USDT
            const usdtOracleAddress = "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D"; // Mainnet USDT/USD oracle
            await offeringFactory.connect(owner).setUSDTConfig(usdtAddress, usdtOracleAddress);
            const config = await offeringFactory.getUSDTConfig();
            expect(config.usdtToken).to.equal(usdtAddress);
            expect(config.usdtOracle).to.equal(usdtOracleAddress);
        });

        it("Should emit USDTConfigUpdated event", async function () {
            const usdtAddress = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
            const usdtOracleAddress = "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D";
            await expect(offeringFactory.connect(owner).setUSDTConfig(usdtAddress, usdtOracleAddress))
                .to.emit(offeringFactory, "USDTConfigUpdated")
                .withArgs(usdtAddress, usdtOracleAddress);
        });

        it("Should revert if non-owner tries to set USDT config", async function () {
            const usdtAddress = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
            const usdtOracleAddress = "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D";
            await expect(
                offeringFactory.connect(addr1).setUSDTConfig(usdtAddress, usdtOracleAddress)
            ).to.be.revertedWithCustomError(offeringFactory, "OwnableUnauthorizedAccount");
        });

        it("Should revert with zero address for USDT", async function () {
            const usdtOracleAddress = "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D";
            await expect(
                offeringFactory.connect(owner).setUSDTConfig(ethers.ZeroAddress, usdtOracleAddress)
            ).to.be.revertedWith("Invalid USDT address");
        });

        it("Should revert with zero address for oracle", async function () {
            const usdtAddress = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
            await expect(
                offeringFactory.connect(owner).setUSDTConfig(usdtAddress, ethers.ZeroAddress)
            ).to.be.revertedWith("Invalid oracle address");
        });
    });

    describe("View Functions", function () {
        it("Should return the correct offering address", async function () {
            const { startDate, endDate, maturityDate } = await getTimestamps(10);
            await offeringFactory.createOffering({
                saleToken: saleToken.target,
                minInvestment: 100,
                maxInvestment: 1000,
                startDate: startDate,
                endDate: endDate,
                maturityDate: maturityDate,
                autoTransfer: false,
                apyEnabled: true,
                fundraisingCap: 100000,
                tokenPrice: 1,
                tokenOwner: tokenOwner.address,
                escrowAddress: treasuryOwner.address,
                investmentManager: investmentManager.address,
                payoutTokenAddress: saleToken.target,
                payoutRate: 100,
                defaultPayoutFrequency: 0
            });
            const offeringAddress = await offeringFactory.getOfferingAddress(0);
            expect(offeringAddress).to.not.equal(ethers.ZeroAddress);
        });

        it("Should return all offering addresses", async function () {
            const { startDate, endDate, maturityDate } = await getTimestamps(10);
            await offeringFactory.createOffering({
                saleToken: saleToken.target,
                minInvestment: 100,
                maxInvestment: 1000,
                startDate: startDate,
                endDate: endDate,
                maturityDate: maturityDate,
                autoTransfer: false,
                apyEnabled: true,
                fundraisingCap: 100000,
                tokenPrice: 1,
                tokenOwner: tokenOwner.address,
                escrowAddress: treasuryOwner.address,
                investmentManager: investmentManager.address,
                payoutTokenAddress: saleToken.target,
                payoutRate: 100,
                defaultPayoutFrequency: 0
            });
            await offeringFactory.createOffering({
                saleToken: saleToken.target,
                minInvestment: 200,
                maxInvestment: 2000,
                startDate: startDate,
                endDate: endDate,
                maturityDate: maturityDate,
                autoTransfer: false,
                apyEnabled: true,
                fundraisingCap: 200000,
                tokenPrice: 2,
                tokenOwner: tokenOwner.address,
                escrowAddress: treasuryOwner.address,
                investmentManager: investmentManager.address,
                payoutTokenAddress: saleToken.target,
                payoutRate: 100,
                defaultPayoutFrequency: 0
            });
            const allOfferings = await offeringFactory.getAllOfferings();
            expect(allOfferings.length).to.equal(2);
            expect(allOfferings[0]).to.equal(await offeringFactory.getOfferingAddress(0));
            expect(allOfferings[1]).to.equal(await offeringFactory.getOfferingAddress(1));
        });

        it("Should return offering IDs by token owner", async function () {
            const { startDate, endDate, maturityDate } = await getTimestamps(10);
            await offeringFactory.createOffering({
                saleToken: saleToken.target,
                minInvestment: 100,
                maxInvestment: 1000,
                startDate: startDate,
                endDate: endDate,
                maturityDate: maturityDate,
                autoTransfer: false,
                apyEnabled: true,
                fundraisingCap: 100000,
                tokenPrice: 1,
                tokenOwner: tokenOwner.address,
                escrowAddress: treasuryOwner.address,
                investmentManager: investmentManager.address,
                payoutTokenAddress: saleToken.target,
                payoutRate: 100,
                defaultPayoutFrequency: 0
            });
            const offeringsByOwner = await offeringFactory.getOfferingIdsByTokenOwner(tokenOwner.address);
            expect(offeringsByOwner.length).to.equal(1);
            expect(offeringsByOwner[0]).to.equal(0);
        });
    });
});
