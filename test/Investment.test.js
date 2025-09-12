import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("Investment Flow Tests", function () {
    // Constants for test configuration
    const MIN_INVESTMENT = ethers.parseUnits("100", 18); // $100
    const MAX_INVESTMENT = ethers.parseUnits("5000", 18); // $5000
    const SOFT_CAP = ethers.parseUnits("10000", 18); // $10k
    const FUNDRAISING_CAP = ethers.parseUnits("100000", 18); // $100k
    const TOKEN_PRICE = ethers.parseUnits("0.5", 18); // $0.5 per token
    const PAYOUT_APR = 1200; // 12% APR in basis points
    const PAYOUT_PERIOD_DURATION = 30 * 24 * 60 * 60; // 30 days

    async function deployInvestmentFixture() {
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

        console.log("🏗️ Deploying investment ecosystem...");

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

        console.log("✅ Investment ecosystem deployed successfully");

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

    async function setupOfferingWithoutAPY() {
        const fixture = await loadFixture(deployInvestmentFixture);
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

    async function setupOfferingWithAPY() {
        const fixture = await loadFixture(deployInvestmentFixture);
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

    describe("1. Investment Flow - WITHOUT APY", function () {
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

        it("Should handle multiple investments from same investor", async function () {
            const { offering, config, investmentManager, investor1, paymentToken } = await setupOfferingWithoutAPY();
            
            await time.increaseTo(config.startDate + 10);
            
            // First investment
            const investment1 = ethers.parseUnits("300");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investment1);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investment1
            );

            // Second investment
            const investment2 = ethers.parseUnits("200");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investment2);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investment2
            );

            expect(await offering.totalRaised()).to.equal(ethers.parseUnits("500")); // $500 total
            expect(await offering.pendingTokens(investor1.address)).to.equal(ethers.parseUnits("1000")); // 1000 tokens
            expect(await offering.totalInvested(investor1.address)).to.equal(ethers.parseUnits("500")); // $500 total invested
        });

        it("Should handle multiple investors", async function () {
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
            const { offering, config, investmentManager, investor1, paymentToken, escrow, treasuryOwner, saleToken } = await setupOfferingWithoutAPY();
            
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
            const initialBalance = await saleToken.balanceOf(investor1.address);
            await expect(
                investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress())
            ).to.emit(investmentManager, "TokensClaimed");
            
            const finalBalance = await saleToken.balanceOf(investor1.address);
            expect(finalBalance - initialBalance).to.equal(ethers.parseUnits("1000"));
        });

        it("Should trigger soft cap reached event", async function () {
            const { offering, config, investmentManager, investor1, paymentToken } = await setupOfferingWithoutAPY();
            
            await time.increaseTo(config.startDate + 10);
            
            // Invest exactly the soft cap amount
            const softCapInvestment = SOFT_CAP; // $10,000
            await paymentToken.connect(investor1).approve(await offering.getAddress(), softCapInvestment);
            
            await expect(
                investmentManager.connect(investor1).routeInvestment(
                    await offering.getAddress(),
                    await paymentToken.getAddress(),
                    softCapInvestment
                )
            ).to.emit(offering, "SoftCapReached");

            expect(await offering.isSoftCapReached()).to.be.true;
        });

        it("Should close sale when fundraising cap is reached", async function () {
            const fixture = await loadFixture(deployInvestmentFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, investmentManager, investor1 } = fixture;
            
            // Create offering with lower cap for testing
            const config = await createOfferingConfig(fixture, false);
            config.fundraisingCap = ethers.parseUnits("1000"); // $1000 cap
            config.softCap = ethers.parseUnits("500"); // $500 soft cap
            
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

            // Invest exactly the fundraising cap
            const capInvestment = ethers.parseUnits("1000");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), capInvestment);
            
            await expect(
                investmentManager.connect(investor1).routeInvestment(
                    offeringAddress,
                    await paymentToken.getAddress(),
                    capInvestment
                )
            ).to.emit(offering, "SaleClosed");

            expect(await offering.isSaleClosed()).to.be.true;
        });
    });

    describe("2. Investment Flow - WITH APY", function () {
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

        it("Should handle multiple APY investments", async function () {
            const { offering, wrappedToken, config, investmentManager, investor1, investor2, paymentToken, escrow, treasuryOwner } = await setupOfferingWithAPY();
            
            await time.increaseTo(config.startDate + 10);
            
            // Investor 1 invests $600
            const investment1 = ethers.parseUnits("600");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investment1);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investment1
            );

            // Investor 2 invests $400
            const investment2 = ethers.parseUnits("400");
            await paymentToken.connect(investor2).approve(await offering.getAddress(), investment2);
            await investmentManager.connect(investor2).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investment2
            );

            // Finalize and claim tokens
            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());
            
            await investmentManager.connect(investor1).claimInvestmentTokens(await offering.getAddress());
            await investmentManager.connect(investor2).claimInvestmentTokens(await offering.getAddress());

            // Check wrapped token balances
            const balance1 = await wrappedToken.balanceOf(investor1.address);
            const balance2 = await wrappedToken.balanceOf(investor2.address);
            
            expect(balance1).to.equal(ethers.parseUnits("1200")); // 1200 tokens
            expect(balance2).to.equal(ethers.parseUnits("800")); // 800 tokens

            // Check total supply
            const totalSupply = await wrappedToken.totalSupply();
            expect(totalSupply).to.equal(ethers.parseUnits("2000"));
        });

        it("Should set first payout date on finalization", async function () {
            const { offering, wrappedToken, config, investmentManager, investor1, paymentToken, escrow, treasuryOwner } = await setupOfferingWithAPY();
            
            await time.increaseTo(config.startDate + 10);
            
            const investmentAmount = ethers.parseUnits("500");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Check first payout date is not set yet
            expect(await wrappedToken.firstPayoutDate()).to.equal(0);

            // Finalize offering
            await time.increaseTo(config.endDate + 10);
            await escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress());

            // Check first payout date is now set
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            expect(firstPayoutDate).to.be.greaterThan(0);
            
            const expectedFirstPayoutDate = config.endDate + 10 + PAYOUT_PERIOD_DURATION;
            expect(firstPayoutDate).to.be.closeTo(expectedFirstPayoutDate, 100); // Allow 100 seconds tolerance
        });
    });

    describe("3. KYB Validation Flow", function () {
        it("Should allow KYB validated investments", async function () {
            const { offering, config, investmentManager, investor1, paymentToken, kybValidator, saleToken, tokenOwner } = await setupOfferingWithoutAPY();

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
                    await offering.getAddress(),
                    await paymentToken.getAddress(),
                    investmentAmount,
                    nonce,
                    expiry,
                    signature
                )
            ).to.emit(investmentManager, "KYBValidatedInvestment");

            expect(await offering.totalRaised()).to.equal(ethers.parseUnits("500"));
        });

        it("Should reject invalid KYB signatures", async function () {
            const { offering, config, investmentManager, investor1, paymentToken, kybValidator } = await setupOfferingWithoutAPY();

            await time.increaseTo(config.startDate + 10);

            // Generate invalid signature (wrong nonce)
            const nonce = 1;
            const wrongNonce = 2;
            const expiry = (await time.latest()) + 3600;
            const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
            
            const messageHash = ethers.solidityPackedKeccak256(
                ["string", "address", "uint256", "uint256", "uint256", "address"],
                ["KYB_VALIDATION", investor1.address, wrongNonce, expiry, chainId, await investmentManager.getAddress()]
            );
            
            const signature = await kybValidator.signMessage(ethers.getBytes(messageHash));

            const investmentAmount = ethers.parseUnits("500");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);

            await expect(
                investmentManager.connect(investor1).routeInvestmentWithKYB(
                    await offering.getAddress(),
                    await paymentToken.getAddress(),
                    investmentAmount,
                    nonce, // Using correct nonce but signature was for wrong nonce
                    expiry,
                    signature
                )
            ).to.be.revertedWith("Invalid KYB signature");
        });

        it("Should reject expired KYB signatures", async function () {
            const { offering, config, investmentManager, investor1, paymentToken, kybValidator } = await setupOfferingWithoutAPY();

            await time.increaseTo(config.startDate + 10);

            // Generate expired signature
            const nonce = 1;
            const expiry = (await time.latest()) - 100; // Already expired
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
                    await offering.getAddress(),
                    await paymentToken.getAddress(),
                    investmentAmount,
                    nonce,
                    expiry,
                    signature
                )
            ).to.be.revertedWith("Signature expired");
        });

        it("Should prevent signature replay attacks", async function () {
            const { offering, config, investmentManager, investor1, paymentToken, kybValidator } = await setupOfferingWithoutAPY();

            await time.increaseTo(config.startDate + 10);

            // Generate valid signature
            const nonce = 1;
            const expiry = (await time.latest()) + 3600;
            const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
            
            const messageHash = ethers.solidityPackedKeccak256(
                ["string", "address", "uint256", "uint256", "uint256", "address"],
                ["KYB_VALIDATION", investor1.address, nonce, expiry, chainId, await investmentManager.getAddress()]
            );
            
            const signature = await kybValidator.signMessage(ethers.getBytes(messageHash));

            const investmentAmount = ethers.parseUnits("250"); // Half of max to allow second attempt
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount * 2n);

            // First use should succeed
            await investmentManager.connect(investor1).routeInvestmentWithKYB(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount,
                nonce,
                expiry,
                signature
            );

            // Second use of same signature should fail
            await expect(
                investmentManager.connect(investor1).routeInvestmentWithKYB(
                    await offering.getAddress(),
                    await paymentToken.getAddress(),
                    investmentAmount,
                    nonce,
                    expiry,
                    signature
                )
            ).to.be.revertedWith("Invalid KYB signature");
        });
    });

    describe("4. Investment Validation and Limits", function () {
        it("Should enforce minimum investment", async function () {
            const { offering, config, investmentManager, investor1, paymentToken } = await setupOfferingWithoutAPY();

            await time.increaseTo(config.startDate + 10);

            // Test below minimum investment
            const belowMinimum = ethers.parseUnits("50"); // Below $100 minimum
            await paymentToken.connect(investor1).approve(await offering.getAddress(), belowMinimum);
            
            await expect(
                investmentManager.connect(investor1).routeInvestment(
                    await offering.getAddress(),
                    await paymentToken.getAddress(),
                    belowMinimum
                )
            ).to.be.revertedWith("Below min investment");
        });

        it("Should enforce maximum investment", async function () {
            const { offering, config, investmentManager, investor1, paymentToken } = await setupOfferingWithoutAPY();

            await time.increaseTo(config.startDate + 10);

            // Test above maximum investment
            const aboveMaximum = ethers.parseUnits("6000"); // Above $5000 maximum
            await paymentToken.connect(investor1).approve(await offering.getAddress(), aboveMaximum);
            
            await expect(
                investmentManager.connect(investor1).routeInvestment(
                    await offering.getAddress(),
                    await paymentToken.getAddress(),
                    aboveMaximum
                )
            ).to.be.revertedWith("Exceeds max investment");
        });

        it("Should enforce cumulative maximum investment", async function () {
            const { offering, config, investmentManager, investor1, paymentToken } = await setupOfferingWithoutAPY();

            await time.increaseTo(config.startDate + 10);

            // First investment at maximum
            const maxInvestment = ethers.parseUnits("5000");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), maxInvestment);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                maxInvestment
            );

            // Second investment should fail even if small
            const smallInvestment = ethers.parseUnits("100");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), smallInvestment);
            
            await expect(
                investmentManager.connect(investor1).routeInvestment(
                    await offering.getAddress(),
                    await paymentToken.getAddress(),
                    smallInvestment
                )
            ).to.be.revertedWith("Exceeds max investment");
        });

        it("Should prevent investments outside sale period", async function () {
            const { offering, config, investmentManager, investor1, paymentToken } = await setupOfferingWithoutAPY();

            const investmentAmount = ethers.parseUnits("500");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);

            // Try to invest before sale starts
            await expect(
                investmentManager.connect(investor1).routeInvestment(
                    await offering.getAddress(),
                    await paymentToken.getAddress(),
                    investmentAmount
                )
            ).to.be.revertedWith("Sale not started");

            // Try to invest after sale ends
            await time.increaseTo(config.endDate + 10);
            
            await expect(
                investmentManager.connect(investor1).routeInvestment(
                    await offering.getAddress(),
                    await paymentToken.getAddress(),
                    investmentAmount
                )
            ).to.be.revertedWith("Sale ended");
        });

        it("Should prevent investments when sale is closed", async function () {
            const fixture = await loadFixture(deployInvestmentFixture);
            const { offeringFactory, deployer, paymentToken, paymentOracle, saleToken, tokenOwner, investmentManager, investor1, investor2 } = fixture;
            
            // Create offering with lower cap for testing
            const config = await createOfferingConfig(fixture, false);
            config.fundraisingCap = ethers.parseUnits("1000"); // $1000 cap
            config.softCap = ethers.parseUnits("500"); // $500 soft cap
            
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

            // Investor 1 reaches the cap
            const capInvestment = ethers.parseUnits("1000");
            await paymentToken.connect(investor1).approve(await offering.getAddress(), capInvestment);
            await investmentManager.connect(investor1).routeInvestment(
                offeringAddress,
                await paymentToken.getAddress(),
                capInvestment
            );

            // Investor 2 tries to invest after cap is reached
            const additionalInvestment = ethers.parseUnits("100");
            await paymentToken.connect(investor2).approve(await offering.getAddress(), additionalInvestment);
            
            await expect(
                investmentManager.connect(investor2).routeInvestment(
                    offeringAddress,
                    await paymentToken.getAddress(),
                    additionalInvestment
                )
            ).to.be.revertedWith("Sale is closed");
        });
    });
});