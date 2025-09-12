const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("OfferingFactory Tests", function () {
    // Constants for test configuration
    const MIN_INVESTMENT = ethers.parseUnits("100", 18); // $100
    const MAX_INVESTMENT = ethers.parseUnits("5000", 18); // $5000
    const SOFT_CAP = ethers.parseUnits("10000", 18); // $10k
    const FUNDRAISING_CAP = ethers.parseUnits("100000", 18); // $100k
    const TOKEN_PRICE = ethers.parseUnits("0.5", 18); // $0.5 per token
    const PAYOUT_APR = 1200; // 12% APR in basis points
    const PAYOUT_PERIOD_DURATION = 30 * 24 * 60 * 60; // 30 days

    async function deployFactoryFixture() {
        const [
            deployer,
            admin,
            tokenOwner,
            treasuryOwner,
            investor1,
            investor2,
            payoutAdmin
        ] = await ethers.getSigners();

        console.log("🏗️ Deploying factory ecosystem...");

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

        // Mint initial tokens
        await saleToken.connect(deployer).mint(tokenOwner.address, ethers.parseUnits("10000000"));
        await paymentToken.connect(deployer).mint(investor1.address, ethers.parseUnits("50000"));
        await paymentToken.connect(deployer).mint(investor2.address, ethers.parseUnits("50000"));
        await payoutToken.connect(deployer).mint(payoutAdmin.address, ethers.parseUnits("100000"));

        console.log("✅ Factory ecosystem deployed successfully");

        return {
            deployer,
            admin,
            tokenOwner,
            treasuryOwner,
            investor1,
            investor2,
            payoutAdmin,
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

    describe("1. Factory Deployment and Setup", function () {
        it("Should deploy factory with correct initial state", async function () {
            const fixture = await loadFixture(deployFactoryFixture);
            const { offeringFactory, wrappedTokenFactory } = fixture;

            expect(await offeringFactory.getAddress()).to.not.equal(ethers.ZeroAddress);
            expect(await offeringFactory.count()).to.equal(0);
            expect(await offeringFactory.wrappedTokenFactory()).to.equal(await wrappedTokenFactory.getAddress());
        });

        it("Should allow owner to update wrapped token factory", async function () {
            const fixture = await loadFixture(deployFactoryFixture);
            const { offeringFactory, deployer } = fixture;

            const WrappedTokenFactory = await ethers.getContractFactory("WrappedTokenFactory");
            const newFactory = await WrappedTokenFactory.deploy();

            await expect(
                offeringFactory.connect(deployer).setWrappedTokenFactory(await newFactory.getAddress())
            ).to.emit(offeringFactory, "WrappedTokenFactoryUpdated");

            expect(await offeringFactory.wrappedTokenFactory()).to.equal(await newFactory.getAddress());
        });

        it("Should reject invalid wrapped token factory address", async function () {
            const fixture = await loadFixture(deployFactoryFixture);
            const { offeringFactory, deployer } = fixture;

            await expect(
                offeringFactory.connect(deployer).setWrappedTokenFactory(ethers.ZeroAddress)
            ).to.be.revertedWith("Invalid factory");
        });
    });

    describe("2. Create Offering WITHOUT APY", function () {
        it("Should create standard offering successfully", async function () {
            const fixture = await loadFixture(deployFactoryFixture);
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

        it("Should register offering with escrow automatically", async function () {
            const fixture = await loadFixture(deployFactoryFixture);
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

        it("Should configure payment tokens and oracles correctly", async function () {
            const fixture = await loadFixture(deployFactoryFixture);
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

            const offeringAddress = event.args.offeringAddress;
            const offering = await ethers.getContractAt("Offering", offeringAddress);
            
            expect(await offering.whitelistedPaymentTokens(await paymentToken.getAddress())).to.be.true;
            expect(await offering.tokenOracles(await paymentToken.getAddress())).to.equal(await paymentOracle.getAddress());
        });
    });

    describe("3. Create Offering WITH APY", function () {
        it("Should create APY offering with wrapped token", async function () {
            const fixture = await loadFixture(deployFactoryFixture);
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
            const fixture = await loadFixture(deployFactoryFixture);
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
            expect(await wrappedToken.payoutPeriodDuration()).to.equal(PAYOUT_PERIOD_DURATION);
        });

        it("Should generate correct wrapped token names", async function () {
            const fixture = await loadFixture(deployFactoryFixture);
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

            const offeringAddress = event.args.offeringAddress;
            const offering = await ethers.getContractAt("Offering", offeringAddress);
            const wrappedTokenAddress = await offering.wrappedTokenAddress();
            const wrappedToken = await ethers.getContractAt("WRAPPEDTOKEN", wrappedTokenAddress);

            const name = await wrappedToken.name();
            const symbol = await wrappedToken.symbol();

            expect(name).to.equal("Sale Token Wrapped");
            expect(symbol).to.equal("wSALE");
        });
    });

    describe("4. Multiple Offerings Management", function () {
        it("Should track multiple offerings correctly", async function () {
            const fixture = await loadFixture(deployFactoryFixture);
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
            const fixture = await loadFixture(deployFactoryFixture);
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

        it("Should track offerings by token owner", async function () {
            const fixture = await loadFixture(deployFactoryFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, tokenOwner } = fixture;
            
            const config = await createOfferingConfig(fixture, false);
            
            // Create 2 offerings for the same token owner
            await offeringFactory.connect(deployer).createOfferingWithPaymentTokens(
                config,
                [await paymentToken.getAddress()],
                [await paymentOracle.getAddress()]
            );

            await offeringFactory.connect(deployer).createOfferingWithPaymentTokens(
                config,
                [await paymentToken.getAddress()],
                [await paymentOracle.getAddress()]
            );

            const offeringIds = await offeringFactory.getOfferingIdsByTokenOwner(tokenOwner.address);
            expect(offeringIds.length).to.equal(2);
            expect(offeringIds[0]).to.equal(0);
            expect(offeringIds[1]).to.equal(1);
        });
    });

    describe("5. Validation and Error Handling", function () {
        it("Should reject invalid configuration parameters", async function () {
            const fixture = await loadFixture(deployFactoryFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle } = fixture;
            
            const config = await createOfferingConfig(fixture, false);
            
            // Test invalid escrow address
            const invalidConfig = { ...config, escrowAddress: ethers.ZeroAddress };
            await expect(
                offeringFactory.connect(deployer).createOfferingWithPaymentTokens(
                    invalidConfig,
                    [await paymentToken.getAddress()],
                    [await paymentOracle.getAddress()]
                )
            ).to.be.revertedWith("Invalid escrow address");
        });

        it("Should reject mismatched payment tokens and oracles arrays", async function () {
            const fixture = await loadFixture(deployFactoryFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle } = fixture;
            
            const config = await createOfferingConfig(fixture, false);
            
            await expect(
                offeringFactory.connect(deployer).createOfferingWithPaymentTokens(
                    config,
                    [await paymentToken.getAddress()],
                    [await paymentOracle.getAddress(), await paymentOracle.getAddress()] // Mismatched arrays
                )
            ).to.be.revertedWith("Array length mismatch");
        });

        it("Should reject empty payment tokens array", async function () {
            const fixture = await loadFixture(deployFactoryFixture);
            const { offeringFactory, deployer } = fixture;
            
            const config = await createOfferingConfig(fixture, false);
            
            await expect(
                offeringFactory.connect(deployer).createOfferingWithPaymentTokens(
                    config,
                    [], // Empty array
                    []
                )
            ).to.be.revertedWith("No payment tokens provided");
        });

        it("Should only allow owner to create offerings", async function () {
            const fixture = await loadFixture(deployFactoryFixture);
            const { offeringFactory, investor1, paymentToken, paymentOracle } = fixture;
            
            const config = await createOfferingConfig(fixture, false);
            
            await expect(
                offeringFactory.connect(investor1).createOfferingWithPaymentTokens(
                    config,
                    [await paymentToken.getAddress()],
                    [await paymentOracle.getAddress()]
                )
            ).to.be.revertedWithCustomError(offeringFactory, "OwnableUnauthorizedAccount");
        });
    });

    describe("6. USDT Configuration", function () {
        it("Should allow owner to set USDT configuration", async function () {
            const fixture = await loadFixture(deployFactoryFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle } = fixture;

            await expect(
                offeringFactory.connect(deployer).setUSDTConfig(
                    await paymentToken.getAddress(),
                    await paymentOracle.getAddress()
                )
            ).to.emit(offeringFactory, "USDTConfigUpdated");

            const [usdtToken, usdtOracle] = await offeringFactory.getUSDTConfig();
            expect(usdtToken).to.equal(await paymentToken.getAddress());
            expect(usdtOracle).to.equal(await paymentOracle.getAddress());
        });

        it("Should reject invalid USDT configuration", async function () {
            const fixture = await loadFixture(deployFactoryFixture);
            const { offeringFactory, deployer, paymentOracle } = fixture;

            await expect(
                offeringFactory.connect(deployer).setUSDTConfig(
                    ethers.ZeroAddress,
                    await paymentOracle.getAddress()
                )
            ).to.be.revertedWith("Invalid USDT address");

            await expect(
                offeringFactory.connect(deployer).setUSDTConfig(
                    await paymentOracle.getAddress(),
                    ethers.ZeroAddress
                )
            ).to.be.revertedWith("Invalid oracle address");
        });
    });
});