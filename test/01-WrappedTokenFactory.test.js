const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("WrappedTokenFactory Contract", function () {
    async function deployWrappedTokenFactoryFixture() {
        const [owner, creator1, creator2, admin1, admin2, offeringContract1, offeringContract2] = await ethers.getSigners();
        
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const peggedToken1 = await MockERC20.deploy("USDT Token", "USDT");
        const peggedToken2 = await MockERC20.deploy("DAI Token", "DAI");
        const payoutToken1 = await MockERC20.deploy("USDC Payout", "USDC");
        const payoutToken2 = await MockERC20.deploy("PAY Payout", "PAY");
        
        const WrappedTokenFactory = await ethers.getContractFactory("WrappedTokenFactory");
        const factory = await WrappedTokenFactory.deploy();
        
        const latestTime = await time.latest();
        const maturityDate1 = latestTime + (365 * 24 * 60 * 60); // 1 year
        const maturityDate2 = latestTime + (730 * 24 * 60 * 60); // 2 years
        const payoutPeriodDuration = 30 * 24 * 60 * 60; // 30 days
        
        return {
            factory,
            owner,
            creator1,
            creator2,
            admin1,
            admin2,
            offeringContract1,
            offeringContract2,
            peggedToken1,
            peggedToken2,
            payoutToken1,
            payoutToken2,
            maturityDate1,
            maturityDate2,
            payoutPeriodDuration
        };
    }

    describe("Deployment", function () {
        it("Should set the correct owner", async function () {
            const { factory, owner } = await loadFixture(deployWrappedTokenFactoryFixture);
            expect(await factory.owner()).to.equal(owner.address);
        });

        it("Should initialize with zero count", async function () {
            const { factory } = await loadFixture(deployWrappedTokenFactoryFixture);
            expect(await factory.count()).to.equal(0);
        });
    });

    describe("Creating Wrapped Tokens", function () {
        it("Should create wrapped token with correct configuration", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1, 
                maturityDate1,
                payoutPeriodDuration
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config = {
                name: "Wrapped USDT Q1 2025",
                symbol: "wUSDT-Q1-25",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutAPR: 1200, // 12% APR
                offeringContract: offeringContract1.address,
                admin: admin1.address,
                payoutPeriodDuration: payoutPeriodDuration
            };

            await expect(factory.connect(creator1).createWrappedToken(config))
                .to.emit(factory, "WrappedTokenDeployed")
                .withArgs(0, creator1.address, await factory.getWrappedTokenAddress(0), offeringContract1.address);

            const wrappedTokenAddress = await factory.getWrappedTokenAddress(0);
            expect(wrappedTokenAddress).to.not.equal(ethers.ZeroAddress);

            // Verify wrapped token configuration
            const wrappedToken = await ethers.getContractAt("WRAPPEDTOKEN", wrappedTokenAddress);
            expect(await wrappedToken.name()).to.equal("Wrapped USDT Q1 2025");
            expect(await wrappedToken.symbol()).to.equal("wUSDT-Q1-25");
            expect(await wrappedToken.peggedToken()).to.equal(await peggedToken1.getAddress());
            expect(await wrappedToken.payoutToken()).to.equal(await payoutToken1.getAddress());
            expect(await wrappedToken.maturityDate()).to.equal(maturityDate1);
            expect(await wrappedToken.payoutAPR()).to.equal(1200);
            expect(await wrappedToken.payoutPeriodDuration()).to.equal(payoutPeriodDuration);
        });

        it("Should grant correct roles to admin", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1, 
                maturityDate1,
                payoutPeriodDuration
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config = {
                name: "Test Token",
                symbol: "TEST",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutAPR: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address,
                payoutPeriodDuration: payoutPeriodDuration
            };

            await factory.connect(creator1).createWrappedToken(config);
            const wrappedTokenAddress = await factory.getWrappedTokenAddress(0);
            const wrappedToken = await ethers.getContractAt("WRAPPEDTOKEN", wrappedTokenAddress);
            
            const DEFAULT_ADMIN_ROLE = await wrappedToken.DEFAULT_ADMIN_ROLE();
            const PAYOUT_ADMIN_ROLE = await wrappedToken.PAYOUT_ADMIN_ROLE();
            const PAUSE_ROLE = await wrappedToken.PAUSE_ROLE();
            
            expect(await wrappedToken.hasRole(DEFAULT_ADMIN_ROLE, admin1.address)).to.be.true;
            expect(await wrappedToken.hasRole(PAYOUT_ADMIN_ROLE, admin1.address)).to.be.true;
            expect(await wrappedToken.hasRole(PAUSE_ROLE, admin1.address)).to.be.true;
        });

        it("Should track multiple wrapped tokens correctly", async function () {
            const { 
                factory, 
                creator1, 
                creator2, 
                admin1, 
                admin2, 
                offeringContract1, 
                offeringContract2, 
                peggedToken1, 
                peggedToken2, 
                payoutToken1, 
                payoutToken2, 
                maturityDate1, 
                maturityDate2,
                payoutPeriodDuration
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config1 = {
                name: "Wrapped Token 1",
                symbol: "WT1",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutAPR: 800,
                offeringContract: offeringContract1.address,
                admin: admin1.address,
                payoutPeriodDuration: payoutPeriodDuration
            };

            const config2 = {
                name: "Wrapped Token 2",
                symbol: "WT2",
                peggedToken: await peggedToken2.getAddress(),
                payoutToken: await payoutToken2.getAddress(),
                maturityDate: maturityDate2,
                payoutAPR: 1500,
                offeringContract: offeringContract2.address,
                admin: admin2.address,
                payoutPeriodDuration: payoutPeriodDuration
            };

            await factory.connect(creator1).createWrappedToken(config1);
            await factory.connect(creator2).createWrappedToken(config2);

            expect(await factory.count()).to.equal(2);

            const creator1Tokens = await factory.getWrappedTokenIdsByCreator(creator1.address);
            const creator2Tokens = await factory.getWrappedTokenIdsByCreator(creator2.address);
            
            expect(creator1Tokens.length).to.equal(1);
            expect(creator2Tokens.length).to.equal(1);
            expect(creator1Tokens[0]).to.equal(0);
            expect(creator2Tokens[0]).to.equal(1);
        });

        it("Should revert with invalid configuration", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                payoutToken1, 
                maturityDate1,
                payoutPeriodDuration
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            // Test zero address for peggedToken
            const invalidConfig = {
                name: "Invalid Token",
                symbol: "INVALID",
                peggedToken: ethers.ZeroAddress,
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutAPR: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address,
                payoutPeriodDuration: payoutPeriodDuration
            };

            await expect(factory.connect(creator1).createWrappedToken(invalidConfig))
                .to.be.revertedWithCustomError(factory, "InvalidStablecoin");
        });

        it("Should revert with zero payout period duration", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1, 
                maturityDate1
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const invalidConfig = {
                name: "Invalid Period Token",
                symbol: "IPT",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutAPR: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address,
                payoutPeriodDuration: 0 // Invalid
            };

            await expect(factory.connect(creator1).createWrappedToken(invalidConfig))
                .to.be.revertedWith("Invalid payout period");
        });
    });

    describe("View Functions", function () {
        it("Should return all wrapped tokens", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1, 
                maturityDate1,
                payoutPeriodDuration
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config = {
                name: "Test Token",
                symbol: "TEST",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutAPR: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address,
                payoutPeriodDuration: payoutPeriodDuration
            };

            await factory.connect(creator1).createWrappedToken(config);
            
            const allTokens = await factory.getAllWrappedTokens();
            expect(allTokens.length).to.equal(1);
            expect(allTokens[0]).to.equal(await factory.getWrappedTokenAddress(0));
        });

        it("Should return correct creator for wrapped token", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1, 
                maturityDate1,
                payoutPeriodDuration
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config = {
                name: "Creator Test Token",
                symbol: "CTT",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutAPR: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address,
                payoutPeriodDuration: payoutPeriodDuration
            };

            await factory.connect(creator1).createWrappedToken(config);
            const tokenAddress = await factory.getWrappedTokenAddress(0);
            
            expect(await factory.getWrappedTokenCreator(tokenAddress)).to.equal(creator1.address);
        });
    });
});