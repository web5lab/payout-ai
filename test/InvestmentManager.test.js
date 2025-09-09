const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("InvestmentManager Contract", function () {
    const MIN_INVESTMENT = ethers.parseUnits("100", 18);
    const MAX_INVESTMENT = ethers.parseUnits("5000", 18);
    const FUNDRAISING_CAP = ethers.parseUnits("100000", 18);
    const TOKEN_PRICE = ethers.parseUnits("0.1", 18); // 1 SALE token = 0.1 USD

    async function deployInvestmentManagerFixture() {
        const [admin, tokenOwner, treasuryOwner, investor1, investor2, otherAccount] = await ethers.getSigners();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const saleToken = await MockERC20.deploy("Sale Token", "SALE");
        const paymentToken = await MockERC20.deploy("Payment Token", "PAY"); // For ERC20 payments

        const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
        const price = ethers.parseUnits("2000", 18); // 1 PAY token = 2000 USD (also used for ETH/USD mock)
        const oracle = await MockV3Aggregator.deploy(price, true);

        const WrappedTokenFactory = await ethers.getContractFactory("WrappedTokenFactory");
        const wrappedTokenFactory = await WrappedTokenFactory.deploy();

        const OfferingFactory = await ethers.getContractFactory("OfferingFactory");
        const offeringFactory = await OfferingFactory.deploy(wrappedTokenFactory.target);
        
        const Escrow = await ethers.getContractFactory("Escrow");
        const escrow = await Escrow.deploy({ owner: treasuryOwner.address });

        const InvestmentManager = await ethers.getContractFactory("InvestmentManager");
        const investmentManager = await InvestmentManager.deploy();

        // Set USDT config in factory (even if not used directly in this test, it's a factory dependency)
        await offeringFactory.connect(admin).setUSDTConfig(paymentToken.target, oracle.target);

        return {
            admin, tokenOwner, treasuryOwner, investor1, investor2, otherAccount,
            saleToken, paymentToken, oracle,
            offeringFactory, investmentManager, wrappedTokenFactory, escrow
        };
    }

    async function createAndInitializeOffering(fixture, config) {
        const { admin, tokenOwner, treasuryOwner, saleToken, paymentToken, oracle, offeringFactory,investmentManager } = fixture;
        const { apyEnabled, autoTransfer } = config;

        const latestTime = await time.latest();
        const startDate = latestTime + 100;
        const endDate = startDate + (10 * 24 * 60 * 60);
        const maturityDate = endDate + (30 * 24 * 60 * 60);

        const tx = await offeringFactory.connect(admin).createOfferingWithPaymentTokens(
            {
                saleToken: saleToken.target,
                minInvestment: MIN_INVESTMENT,
                maxInvestment: MAX_INVESTMENT,
                startDate: startDate,
                endDate: endDate,
                maturityDate: maturityDate,
                autoTransfer: autoTransfer || false,
                apyEnabled: apyEnabled || false,
                fundraisingCap: FUNDRAISING_CAP,
                tokenPrice: TOKEN_PRICE,
                tokenOwner: tokenOwner.address,
                escrowAddress: treasuryOwner.address,
                investmentManager: investmentManager.target,
                payoutTokenAddress: paymentToken.target,
                payoutRate: 100,
                defaultPayoutFrequency: 0, // Daily
                paymentTokens: [paymentToken.target, ethers.ZeroAddress],
                oracles: [oracle.target, oracle.target]
            }
        );

        const receipt = await tx.wait();
        const offeringDeployedEvent = receipt.logs.find(
            (event) => event.fragment && event.fragment.name === "OfferingDeployed"
        );
        // Ensure the event is found
        expect(offeringDeployedEvent).to.not.be.undefined;

        const offeringAddress = offeringDeployedEvent.args.offeringAddress;
        const offering = await ethers.getContractAt("Offering", offeringAddress); // Get offering instance here

        return { offeringAddress, offering, startDate, endDate, maturityDate };
    }

    describe("Deployment and Initialization", function () {
        it("Should set the deployer as the owner", async function () {
            const { admin, investmentManager } = await loadFixture(deployInvestmentManagerFixture);
            expect(await investmentManager.owner()).to.equal(admin.address);
        });
    });

    describe("Route Investment (ERC20)", function () {
        it("Should successfully route an ERC20 investment to an offering", async function () {
            const fixture = await loadFixture(deployInvestmentManagerFixture);
            const { investor1, paymentToken, saleToken, investmentManager, tokenOwner } = fixture;
            const {  offering, startDate } = await createAndInitializeOffering(fixture, { apyEnabled: false, autoTransfer: false });

            const paymentAmount = ethers.parseUnits("0.05", 18); // 0.05 PAY tokens = 100 USD (within min/max investment)
            const expectedTokens = ethers.parseUnits("1000", 18); // 100 USD / 0.1 USD/SALE = 1000 SALE

            // Mint payment tokens to investor and approve Offering
            const offeringAddressResolved = await offering.getAddress();
            await paymentToken.mint(investor1.address, paymentAmount);
            await paymentToken.connect(investor1).approve(offeringAddressResolved, paymentAmount);

            // Mint sale tokens to offering for distribution
            await saleToken.mint(tokenOwner.address, expectedTokens);
            await saleToken.connect(tokenOwner).transfer(offeringAddressResolved, expectedTokens);

            await time.increaseTo(startDate);

            // Route investment via InvestmentManager
            await expect(investmentManager.connect(investor1).routeInvestment(
                offeringAddressResolved,
                paymentToken.target,
                paymentAmount
            ))
                .to.emit(investmentManager, "InvestmentRouted")
                .withArgs(investor1.address, offeringAddressResolved, paymentToken.target, paymentAmount, 0) // tokensReceived is 0 in InvestmentManager event
                .and.to.emit(offering, "Invested");

            // Verify balances
            const escrowAddress = await offering.escrowAddress();
            expect(await paymentToken.balanceOf(escrowAddress)).to.equal(paymentAmount);
            expect(await offering.totalRaised()).to.equal(ethers.parseUnits("100", 18)); // 100 USD
            expect(await offering.pendingTokens(investor1.address)).to.equal(expectedTokens);
        });

        it("Should revert if investor has not approved Offering for ERC20 transfer", async function () {
            const fixture = await loadFixture(deployInvestmentManagerFixture);
            const { investor1, paymentToken, investmentManager } = fixture;
            const { offeringAddress, offering, startDate } = await createAndInitializeOffering(fixture, { apyEnabled: false, autoTransfer: false });

            const paymentAmount = ethers.parseUnits("0.05", 18);

            // Mint payment tokens to investor, but DON'T approve Offering
            await paymentToken.mint(investor1.address, paymentAmount);

            await time.increaseTo(startDate);

            const offeringAddressResolved = await offering.getAddress();
            await expect(investmentManager.connect(investor1).routeInvestment(
                offeringAddressResolved,
                paymentToken.target,
                paymentAmount
            )).to.be.revertedWithCustomError(paymentToken, "ERC20InsufficientAllowance");
        });
    });

    describe("Route Investment (Native ETH)", function () {
        it("Should successfully route a native ETH investment to an offering", async function () {
            const fixture = await loadFixture(deployInvestmentManagerFixture);
            const { admin, investor1, saleToken, investmentManager, tokenOwner } = fixture;
            const { offeringAddress, offering, startDate } = await createAndInitializeOffering(fixture, { apyEnabled: false, autoTransfer: false });

            const paymentAmount = ethers.parseUnits("0.1", 18); // 0.1 ETH = 200 USD (assuming 1 ETH = 2000 USD for simplicity in this test context)
            const expectedTokens = ethers.parseUnits("2000", 18); // 200 USD / 0.1 USD/SALE = 2000 SALE

            // Mint sale tokens to offering for distribution
            const offeringAddressResolved = await offering.getAddress();
            await saleToken.mint(tokenOwner.address, expectedTokens);
            await saleToken.connect(tokenOwner).transfer(offeringAddressResolved, expectedTokens);

            await time.increaseTo(startDate);

            // Route native ETH investment via InvestmentManager
            await expect(investmentManager.connect(investor1).routeInvestment(
                offeringAddressResolved,
                ethers.ZeroAddress, // Native ETH
                paymentAmount,
                { value: paymentAmount }
            ))
                .to.emit(investmentManager, "InvestmentRouted")
                .withArgs(investor1.address, offeringAddressResolved, ethers.ZeroAddress, paymentAmount, 0)
                .and.to.emit(offering, "Invested");

            // Verify balances
            const escrowAddress = await offering.escrowAddress();
            expect(await ethers.provider.getBalance(escrowAddress)).to.equal(paymentAmount);
            expect(await offering.totalRaised()).to.equal(ethers.parseUnits("200", 18)); // 200 USD
            expect(await offering.pendingTokens(investor1.address)).to.equal(expectedTokens);
        });

        it("Should revert if native ETH sent does not match _paymentAmount", async function () {
            const fixture = await loadFixture(deployInvestmentManagerFixture);
            const { admin, investor1, investmentManager } = fixture;
            const { offeringAddress, offering, startDate } = await createAndInitializeOffering(fixture, { apyEnabled: false, autoTransfer: false });

            const paymentAmount = ethers.parseUnits("0.1", 18);

            await time.increaseTo(startDate);

            const offeringAddressResolved = await offering.getAddress();
            await expect(investmentManager.connect(investor1).routeInvestment(
                offeringAddressResolved,
                ethers.ZeroAddress, // Native ETH
                paymentAmount,
                { value: ethers.parseUnits("0.05", 18) } // Sending less ETH
            )).to.be.revertedWith("Incorrect native amount"); // This revert string is from Offering.sol
        });

        it("Should handle claiming tokens after maturity", async function () {
            const fixture = await loadFixture(deployInvestmentManagerFixture);
            const { investor1, paymentToken, saleToken, investmentManager, tokenOwner } = fixture;
            const { offering, startDate, maturityDate } = await createAndInitializeOffering(fixture, { apyEnabled: false, autoTransfer: false });

            const paymentAmount = ethers.parseUnits("0.05", 18);
            const expectedTokens = ethers.parseUnits("1000", 18);

            const offeringAddressResolved = await offering.getAddress();
            await paymentToken.mint(investor1.address, paymentAmount);
            await paymentToken.connect(investor1).approve(offeringAddressResolved, paymentAmount);
            await saleToken.mint(tokenOwner.address, expectedTokens);
            await saleToken.connect(tokenOwner).transfer(offeringAddressResolved, expectedTokens);

            await time.increaseTo(startDate);
            await investmentManager.connect(investor1).routeInvestment(
                offeringAddressResolved,
                paymentToken.target,
                paymentAmount
            );

            // Fast forward to maturity
            await time.increaseTo(maturityDate + 1);

            // Claim tokens via InvestmentManager
            await expect(investmentManager.connect(investor1).claimInvestmentTokens(offeringAddressResolved))
                .to.emit(investmentManager, "TokensClaimed")
                .withArgs(investor1.address, offeringAddressResolved, expectedTokens);

            expect(await saleToken.balanceOf(investor1.address)).to.equal(expectedTokens);
        });
    });

    describe("Rescue Functions", function () {
        it("Should allow owner to rescue ERC20 tokens", async function () {
            const { admin, otherAccount, paymentToken, investmentManager } = await loadFixture(deployInvestmentManagerFixture);
            const amount = ethers.parseUnits("50", 18);

            // Simulate accidental ERC20 transfer to InvestmentManager
            await paymentToken.mint(investmentManager.target, amount);
            expect(await paymentToken.balanceOf(investmentManager.target)).to.equal(amount);

            await expect(investmentManager.connect(admin).rescueERC20(paymentToken.target, amount, otherAccount.address))
                .to.changeTokenBalances(paymentToken, [investmentManager, otherAccount], [-amount, amount]);
        });

        it("Should allow owner to rescue native currency", async function () {
            const { admin, otherAccount, investmentManager } = await loadFixture(deployInvestmentManagerFixture);
            const amount = ethers.parseUnits("1", 18);

            // Simulate accidental native currency transfer to InvestmentManager
            await admin.sendTransaction({ to: investmentManager.target, value: amount });
            expect(await ethers.provider.getBalance(investmentManager.target)).to.equal(amount);

            await expect(investmentManager.connect(admin).rescueNative(amount, otherAccount.address))
                .to.changeEtherBalances([investmentManager, otherAccount], [-amount, amount]);
        });

        it("Should revert if non-owner tries to rescue ERC20 tokens", async function () {
            const { investor1, otherAccount, paymentToken, investmentManager } = await loadFixture(deployInvestmentManagerFixture);
            const amount = ethers.parseUnits("50", 18);
            await paymentToken.mint(investmentManager.target, amount);

            await expect(investmentManager.connect(investor1).rescueERC20(paymentToken.target, amount, otherAccount.address))
                .to.be.revertedWithCustomError(investmentManager, "OwnableUnauthorizedAccount")
                .withArgs(investor1.address);
        });

        it("Should revert if non-owner tries to rescue native currency", async function () {
            const { admin, investor1, otherAccount, investmentManager } = await loadFixture(deployInvestmentManagerFixture);
            const amount = ethers.parseUnits("1", 18);
            await admin.sendTransaction({ to: investmentManager.target, value: amount });

            await expect(investmentManager.connect(investor1).rescueNative(amount, otherAccount.address))
                .to.be.revertedWithCustomError(investmentManager, "OwnableUnauthorizedAccount")
                .withArgs(investor1.address);
        });
    });
});
