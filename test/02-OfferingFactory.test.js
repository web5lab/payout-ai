const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("OfferingFactory Contract", function () {
    async function deployOfferingFactoryFixture() {
        const [owner, creator, tokenOwner, treasuryOwner, investmentManager] = await ethers.getSigners();
        
        // Deploy mock tokens
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const saleToken = await MockERC20.deploy("Sale Token", "SALE");
        const paymentToken = await MockERC20.deploy("Payment Token", "PAY");
        const usdtToken = await MockERC20.deploy("USDT Token", "USDT");
        const payoutToken = await MockERC20.deploy("Payout Token", "PAYOUT");
        
        // Deploy mock oracles
        const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
        const payOracle = await MockV3Aggregator.deploy(ethers.parseUnits("1.0", 18), true);
        const ethOracle = await MockV3Aggregator.deploy(ethers.parseUnits("2000", 18), true);
        const usdtOracle = await MockV3Aggregator.deploy(ethers.parseUnits("1.0", 18), true);
        
        // Deploy factories
        const WrappedTokenFactory = await ethers.getContractFactory("WrappedTokenFactory");
        const wrappedTokenFactory = await WrappedTokenFactory.deploy();
        
        const OfferingFactory = await ethers.getContractFactory("OfferingFactory");
        const offeringFactory = await OfferingFactory.deploy(await wrappedTokenFactory.getAddress());
        
        // Deploy escrow
        const Escrow = await ethers.getContractFactory("Escrow");
        const escrow = await Escrow.deploy({ owner: treasuryOwner.address });
        
        return {
            offeringFactory,
            wrappedTokenFactory,
            escrow,
            owner,
            creator,
            tokenOwner,
            treasuryOwner,
            investmentManager,
            saleToken,
            paymentToken,
            usdtToken,
            payoutToken,
            payOracle,
            ethOracle,
            usdtOracle
        };
    }

    describe("Deployment", function () {
        it("Should set correct owner and wrapped token factory", async function () {
            const { offeringFactory, wrappedTokenFactory, owner } = await loadFixture(deployOfferingFactoryFixture);
            expect(await offeringFactory.owner()).to.equal(owner.address);
            expect(await offeringFactory.wrappedTokenFactory()).to.equal(await wrappedTokenFactory.getAddress());
        });

        it("Should revert with zero address for wrapped token factory", async function () {
            const OfferingFactory = await ethers.getContractFactory("OfferingFactory");
            await expect(OfferingFactory.deploy(ethers.ZeroAddress))
                .to.be.revertedWith("Invalid factory");
        });
    });

    describe("USDT Configuration", function () {
        it("Should set USDT configuration correctly", async function () {
            const { offeringFactory, usdtToken, usdtOracle, owner } = await loadFixture(deployOfferingFactoryFixture);
            
            await expect(offeringFactory.connect(owner).setUSDTConfig(
                await usdtToken.getAddress(),
                await usdtOracle.getAddress()
            ))
                .to.emit(offeringFactory, "USDTConfigUpdated")
                .withArgs(await usdtToken.getAddress(), await usdtOracle.getAddress());
            
            const config = await offeringFactory.getUSDTConfig();
            expect(config.usdtToken).to.equal(await usdtToken.getAddress());
            expect(config.usdtOracle).to.equal(await usdtOracle.getAddress());
        });

        it("Should revert USDT config with zero addresses", async function () {
            const { offeringFactory, usdtOracle, owner } = await loadFixture(deployOfferingFactoryFixture);
            
            await expect(offeringFactory.connect(owner).setUSDTConfig(
                ethers.ZeroAddress,
                await usdtOracle.getAddress()
            )).to.be.revertedWith("Invalid USDT address");
        });
    });

    describe("Creating Offerings", function () {
        it("Should create offering without APY", async function () {
            const { 
                offeringFactory, 
                escrow,
                owner,
                tokenOwner,
                investmentManager,
                saleToken,
                paymentToken,
                payoutToken,
                payOracle
            } = await loadFixture(deployOfferingFactoryFixture);
            
            const now = await time.latest();
            const config = {
                saleToken: await saleToken.getAddress(),
                minInvestment: ethers.parseUnits("100", 18),
                maxInvestment: ethers.parseUnits("5000", 18),
                startDate: now + 300,
                endDate: now + 300 + 3600,
                apyEnabled: false,
                softCap: ethers.parseUnits("10000", 18),
                fundraisingCap: ethers.parseUnits("100000", 18),
                tokenPrice: ethers.parseUnits("0.5", 18),
                tokenOwner: tokenOwner.address,
                escrowAddress: await escrow.getAddress(),
                investmentManager: investmentManager.address,
                payoutTokenAddress: await payoutToken.getAddress(),
                payoutRate: 1000,
                payoutPeriodDuration: 2592000,
                maturityDate: now + 300 + 7200
            };

            const paymentTokens = [await paymentToken.getAddress()];
            const oracles = [await payOracle.getAddress()];

            await expect(offeringFactory.connect(owner).createOfferingWithPaymentTokens(
                config,
                paymentTokens,
                oracles
            ))
                .to.emit(offeringFactory, "OfferingDeployed");

            expect(await offeringFactory.count()).to.equal(1);
            
            const offeringAddress = await offeringFactory.getOfferingAddress(0);
            const offering = await ethers.getContractAt("Offering", offeringAddress);
            
            expect(await offering.saleToken()).to.equal(await saleToken.getAddress());
            expect(await offering.apyEnabled()).to.be.false;
            expect(await offering.wrappedTokenAddress()).to.equal(ethers.ZeroAddress);
        });

        it("Should create offering with APY and wrapped token", async function () {
            const { 
                offeringFactory, 
                escrow,
                owner,
                tokenOwner,
                investmentManager,
                saleToken,
                paymentToken,
                payoutToken,
                payOracle
            } = await loadFixture(deployOfferingFactoryFixture);
            
            const now = await time.latest();
            const config = {
                saleToken: await saleToken.getAddress(),
                minInvestment: ethers.parseUnits("100", 18),
                maxInvestment: ethers.parseUnits("5000", 18),
                startDate: now + 300,
                endDate: now + 300 + 3600,
                apyEnabled: true, // APY ENABLED
                softCap: ethers.parseUnits("10000", 18),
                fundraisingCap: ethers.parseUnits("100000", 18),
                tokenPrice: ethers.parseUnits("0.5", 18),
                tokenOwner: tokenOwner.address,
                escrowAddress: await escrow.getAddress(),
                investmentManager: investmentManager.address,
                payoutTokenAddress: await payoutToken.getAddress(),
                payoutRate: 1200,
                payoutPeriodDuration: 2592000,
                maturityDate: now + 300 + 31536000 // 1 year
            };

            const paymentTokens = [await paymentToken.getAddress()];
            const oracles = [await payOracle.getAddress()];

            await offeringFactory.connect(owner).createOfferingWithPaymentTokens(
                config,
                paymentTokens,
                oracles
            );

            const offeringAddress = await offeringFactory.getOfferingAddress(0);
            const offering = await ethers.getContractAt("Offering", offeringAddress);
            
            expect(await offering.apyEnabled()).to.be.true;
            
            const wrappedTokenAddress = await offering.wrappedTokenAddress();
            expect(wrappedTokenAddress).to.not.equal(ethers.ZeroAddress);
            
            const wrappedToken = await ethers.getContractAt("WRAPPEDTOKEN", wrappedTokenAddress);
            expect(await wrappedToken.name()).to.include("Sale Token");
            expect(await wrappedToken.symbol()).to.include("wSALE");
            expect(await wrappedToken.payoutAPR()).to.equal(1200);
        });

        it("Should configure payment tokens and oracles correctly", async function () {
            const { 
                offeringFactory, 
                escrow,
                owner,
                tokenOwner,
                investmentManager,
                saleToken,
                paymentToken,
                usdtToken,
                payoutToken,
                payOracle,
                ethOracle,
                usdtOracle
            } = await loadFixture(deployOfferingFactoryFixture);
            
            const now = await time.latest();
            const config = {
                saleToken: await saleToken.getAddress(),
                minInvestment: ethers.parseUnits("100", 18),
                maxInvestment: ethers.parseUnits("5000", 18),
                startDate: now + 300,
                endDate: now + 300 + 3600,
                apyEnabled: false,
                softCap: ethers.parseUnits("10000", 18),
                fundraisingCap: ethers.parseUnits("100000", 18),
                tokenPrice: ethers.parseUnits("0.5", 18),
                tokenOwner: tokenOwner.address,
                escrowAddress: await escrow.getAddress(),
                investmentManager: investmentManager.address,
                payoutTokenAddress: await payoutToken.getAddress(),
                payoutRate: 1000,
                payoutPeriodDuration: 2592000,
                maturityDate: now + 300 + 7200
            };

            const paymentTokens = [
                await paymentToken.getAddress(),
                ethers.ZeroAddress, // Native ETH
                await usdtToken.getAddress()
            ];
            const oracles = [
                await payOracle.getAddress(),
                await ethOracle.getAddress(),
                await usdtOracle.getAddress()
            ];

            await offeringFactory.connect(owner).createOfferingWithPaymentTokens(
                config,
                paymentTokens,
                oracles
            );

            const offeringAddress = await offeringFactory.getOfferingAddress(0);
            const offering = await ethers.getContractAt("Offering", offeringAddress);
            
            // Check payment tokens are whitelisted
            expect(await offering.whitelistedPaymentTokens(await paymentToken.getAddress())).to.be.true;
            expect(await offering.whitelistedPaymentTokens(ethers.ZeroAddress)).to.be.true;
            expect(await offering.whitelistedPaymentTokens(await usdtToken.getAddress())).to.be.true;
            
            // Check oracles are set
            expect(await offering.tokenOracles(await paymentToken.getAddress())).to.equal(await payOracle.getAddress());
            expect(await offering.tokenOracles(ethers.ZeroAddress)).to.equal(await ethOracle.getAddress());
            expect(await offering.tokenOracles(await usdtToken.getAddress())).to.equal(await usdtOracle.getAddress());
        });

        it("Should revert with mismatched payment tokens and oracles arrays", async function () {
            const { 
                offeringFactory, 
                escrow,
                owner,
                tokenOwner,
                investmentManager,
                saleToken,
                paymentToken,
                payoutToken,
                payOracle,
                ethOracle
            } = await loadFixture(deployOfferingFactoryFixture);
            
            const now = await time.latest();
            const config = {
                saleToken: await saleToken.getAddress(),
                minInvestment: ethers.parseUnits("100", 18),
                maxInvestment: ethers.parseUnits("5000", 18),
                startDate: now + 300,
                endDate: now + 300 + 3600,
                apyEnabled: false,
                softCap: ethers.parseUnits("10000", 18),
                fundraisingCap: ethers.parseUnits("100000", 18),
                tokenPrice: ethers.parseUnits("0.5", 18),
                tokenOwner: tokenOwner.address,
                escrowAddress: await escrow.getAddress(),
                investmentManager: investmentManager.address,
                payoutTokenAddress: await payoutToken.getAddress(),
                payoutRate: 1000,
                payoutPeriodDuration: 2592000,
                maturityDate: now + 300 + 7200
            };

            const paymentTokens = [await paymentToken.getAddress()];
            const oracles = [await payOracle.getAddress(), await ethOracle.getAddress()]; // Mismatched length

            await expect(offeringFactory.connect(owner).createOfferingWithPaymentTokens(
                config,
                paymentTokens,
                oracles
            )).to.be.revertedWith("Array length mismatch");
        });
    });

    describe("Wrapped Token Factory Integration", function () {
        it("Should update wrapped token factory reference", async function () {
            const { offeringFactory, owner } = await loadFixture(deployOfferingFactoryFixture);
            
            const NewWrappedTokenFactory = await ethers.getContractFactory("WrappedTokenFactory");
            const newFactory = await NewWrappedTokenFactory.deploy();
            
            await expect(offeringFactory.connect(owner).setWrappedTokenFactory(await newFactory.getAddress()))
                .to.emit(offeringFactory, "WrappedTokenFactoryUpdated");
            
            expect(await offeringFactory.wrappedTokenFactory()).to.equal(await newFactory.getAddress());
        });

        it("Should revert wrapped token factory update with zero address", async function () {
            const { offeringFactory, owner } = await loadFixture(deployOfferingFactoryFixture);
            
            await expect(offeringFactory.connect(owner).setWrappedTokenFactory(ethers.ZeroAddress))
                .to.be.revertedWith("Invalid factory");
        });
    });
});