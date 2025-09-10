const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("InvestmentManager KYB Validation", function () {
    const MIN_INVESTMENT = ethers.parseUnits("100", 18);
    const MAX_INVESTMENT = ethers.parseUnits("5000", 18);
    const FUNDRAISING_CAP = ethers.parseUnits("100000", 18);
    const TOKEN_PRICE = ethers.parseUnits("0.1", 18);

    async function deployKYBTestFixture() {
        const [admin, tokenOwner, treasuryOwner, kybValidator, investor1, investor2, investor3] = await ethers.getSigners();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const saleToken = await MockERC20.deploy("Sale Token", "SALE");
        const paymentToken = await MockERC20.deploy("Payment Token", "PAY");

        const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
        const oracle = await MockV3Aggregator.deploy(ethers.parseUnits("1.0", 18), true);

        const WrappedTokenFactory = await ethers.getContractFactory("WrappedTokenFactory");
        const wrappedTokenFactory = await WrappedTokenFactory.deploy();

        const OfferingFactory = await ethers.getContractFactory("OfferingFactory");
        const offeringFactory = await OfferingFactory.deploy(wrappedTokenFactory.target);

        const InvestmentManager = await ethers.getContractFactory("InvestmentManager");
        const investmentManager = await InvestmentManager.deploy();

        const Escrow = await ethers.getContractFactory("Escrow");
        const escrow = await Escrow.deploy({ owner: treasuryOwner.address });

        // Configure system
        await investmentManager.connect(admin).setEscrowContract(escrow.target);
        await investmentManager.connect(admin).setKYBValidator(kybValidator.address);
        await escrow.connect(treasuryOwner).setInvestmentManager(investmentManager.target);
        await offeringFactory.connect(admin).setUSDTConfig(paymentToken.target, oracle.target);

        return {
            admin, tokenOwner, treasuryOwner, kybValidator, investor1, investor2, investor3,
            saleToken, paymentToken, oracle,
            offeringFactory, investmentManager, escrow, wrappedTokenFactory
        };
    }

    async function createTestOffering(fixture) {
        const { admin, tokenOwner, saleToken, paymentToken, oracle, offeringFactory, investmentManager, escrow } = fixture;

        const latestTime = await time.latest();
        const startDate = latestTime + 100;
        const endDate = startDate + 3600;
        const maturityDate = endDate + 7200;

        const tx = await offeringFactory.connect(admin).createOfferingWithPaymentTokens(
            {
                saleToken: saleToken.target,
                minInvestment: MIN_INVESTMENT,
                maxInvestment: MAX_INVESTMENT,
                startDate: startDate,
                endDate: endDate,
                maturityDate: maturityDate,
                autoTransfer: true,
                apyEnabled: false,
                fundraisingCap: FUNDRAISING_CAP,
                tokenPrice: TOKEN_PRICE,
                tokenOwner: tokenOwner.address,
                escrowAddress: escrow.target,
                investmentManager: investmentManager.target,
                payoutTokenAddress: paymentToken.target,
                payoutRate: 100,
                payoutPeriodDuration: 2592000,
                firstPayoutDate: startDate + 1800,
                customWrappedName: "",
                customWrappedSymbol: ""
            },
            [paymentToken.target],
            [oracle.target]
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find(log => log.fragment && log.fragment.name === 'OfferingDeployed');
        const offeringAddress = event.args.offeringAddress;
        const offering = await ethers.getContractAt("Offering", offeringAddress);

        // Register offering and transfer tokens
        await escrow.connect(fixture.treasuryOwner).registerOffering(offeringAddress, tokenOwner.address);
        await saleToken.mint(tokenOwner.address, ethers.parseUnits("100000", 18));
        await saleToken.connect(tokenOwner).transfer(offeringAddress, ethers.parseUnits("100000", 18));

        return { offering, offeringAddress, startDate, endDate, maturityDate };
    }

    async function generateKYBSignature(walletAddress, nonce, expiry, chainId, contractAddress, signer) {
        const messageHash = ethers.solidityPackedKeccak256(
            ["string", "address", "uint256", "uint256", "uint256", "address"],
            ["KYB_VALIDATION", walletAddress, nonce, expiry, chainId, contractAddress]
        );
        
        const signature = await signer.signMessage(ethers.getBytes(messageHash));
        return { messageHash, signature, nonce, expiry };
    }

    describe("KYB Validator Setup", function () {
        it("Should set KYB validator correctly", async function () {
            const { investmentManager, admin, kybValidator } = await loadFixture(deployKYBTestFixture);
            
            await expect(investmentManager.connect(admin).setKYBValidator(kybValidator.address))
                .to.emit(investmentManager, "KYBValidatorUpdated")
                .withArgs(ethers.ZeroAddress, kybValidator.address);
            
            expect(await investmentManager.getKYBValidator()).to.equal(kybValidator.address);
        });

        it("Should revert when setting zero address as KYB validator", async function () {
            const { investmentManager, admin } = await loadFixture(deployKYBTestFixture);
            
            await expect(investmentManager.connect(admin).setKYBValidator(ethers.ZeroAddress))
                .to.be.revertedWith("Invalid KYB validator address");
        });

        it("Should revert when non-owner tries to set KYB validator", async function () {
            const { investmentManager, investor1, kybValidator } = await loadFixture(deployKYBTestFixture);
            
            await expect(investmentManager.connect(investor1).setKYBValidator(kybValidator.address))
                .to.be.revertedWithCustomError(investmentManager, "OwnableUnauthorizedAccount");
        });
    });

    describe("KYB Signature Verification", function () {
        it("Should verify valid KYB signature", async function () {
            const { investmentManager, kybValidator } = await loadFixture(deployKYBTestFixture);
            
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const contractAddress = await investmentManager.getAddress();
            const walletAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
            const nonce = Date.now();
            const expiry = (await time.latest()) + 3600;

            const sigData = await generateKYBSignature(
                walletAddress, nonce, expiry, chainId, contractAddress, kybValidator
            );

            const isValid = await investmentManager.verifyKYBSignature(
                walletAddress, sigData.nonce, sigData.expiry, sigData.signature
            );

            expect(isValid).to.be.true;
        });

        it("Should reject signature from wrong signer", async function () {
            const { investmentManager, admin } = await loadFixture(deployKYBTestFixture);
            
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const contractAddress = await investmentManager.getAddress();
            const walletAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
            const nonce = Date.now();
            const expiry = (await time.latest()) + 3600;

            // Sign with wrong signer (admin instead of kybValidator)
            const sigData = await generateKYBSignature(
                walletAddress, nonce, expiry, chainId, contractAddress, admin
            );

            const isValid = await investmentManager.verifyKYBSignature(
                walletAddress, sigData.nonce, sigData.expiry, sigData.signature
            );

            expect(isValid).to.be.false;
        });

        it("Should reject expired signature", async function () {
            const { investmentManager, kybValidator } = await loadFixture(deployKYBTestFixture);
            
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const contractAddress = await investmentManager.getAddress();
            const walletAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
            const nonce = Date.now();
            const expiry = (await time.latest()) - 100; // Already expired

            const sigData = await generateKYBSignature(
                walletAddress, nonce, expiry, chainId, contractAddress, kybValidator
            );

            await expect(investmentManager.verifyKYBSignature(
                walletAddress, sigData.nonce, sigData.expiry, sigData.signature
            )).to.be.revertedWith("Signature expired");
        });

        it("Should reject reused signature", async function () {
            const { investmentManager, kybValidator, investor1 } = await loadFixture(deployKYBTestFixture);
            
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const contractAddress = await investmentManager.getAddress();
            const nonce = Date.now();
            const expiry = (await time.latest()) + 3600;

            const sigData = await generateKYBSignature(
                investor1.address, nonce, expiry, chainId, contractAddress, kybValidator
            );

            // First validation should work
            await investmentManager.connect(investor1).validateWalletKYB(
                sigData.nonce, sigData.expiry, sigData.signature
            );

            // Second use of same signature should fail
            const isValidSecondTime = await investmentManager.verifyKYBSignature(
                investor1.address, sigData.nonce, sigData.expiry, sigData.signature
            );

            expect(isValidSecondTime).to.be.false;
        });
    });

    describe("Wallet Validation", function () {
        it("Should validate wallet with correct signature", async function () {
            const { investmentManager, kybValidator, investor1 } = await loadFixture(deployKYBTestFixture);
            
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const contractAddress = await investmentManager.getAddress();
            const nonce = Date.now();
            const expiry = (await time.latest()) + 3600;

            const sigData = await generateKYBSignature(
                investor1.address, nonce, expiry, chainId, contractAddress, kybValidator
            );

            await expect(investmentManager.connect(investor1).validateWalletKYB(
                sigData.nonce, sigData.expiry, sigData.signature
            ))
                .to.emit(investmentManager, "WalletKYBValidated")
                .withArgs(investor1.address, kybValidator.address);

            expect(await investmentManager.isWalletKYBValidated(investor1.address)).to.be.true;
        });

        it("Should prevent double validation of same wallet", async function () {
            const { investmentManager, kybValidator, investor1 } = await loadFixture(deployKYBTestFixture);
            
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const contractAddress = await investmentManager.getAddress();
            const nonce = Date.now();
            const expiry = (await time.latest()) + 3600;

            const sigData = await generateKYBSignature(
                investor1.address, nonce, expiry, chainId, contractAddress, kybValidator
            );

            // First validation
            await investmentManager.connect(investor1).validateWalletKYB(
                sigData.nonce, sigData.expiry, sigData.signature
            );

            // Second validation should fail
            const nonce2 = Date.now() + 1;
            const expiry2 = (await time.latest()) + 3600;
            const sigData2 = await generateKYBSignature(
                investor1.address, nonce2, expiry2, chainId, contractAddress, kybValidator
            );

            await expect(investmentManager.connect(investor1).validateWalletKYB(
                sigData2.nonce, sigData2.expiry, sigData2.signature
            )).to.be.revertedWith("Wallet already validated");
        });
    });

    describe("KYB Investment Routing", function () {
        it("Should allow investment with valid KYB signature", async function () {
            const fixture = await loadFixture(deployKYBTestFixture);
            const { investmentManager, kybValidator, investor1, paymentToken, saleToken } = fixture;
            const { offeringAddress, startDate } = await createTestOffering(fixture);

            await time.increaseTo(startDate + 10);

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const contractAddress = await investmentManager.getAddress();
            const nonce = Date.now();
            const expiry = (await time.latest()) + 3600;
            const investAmount = ethers.parseUnits("500", 18);

            const sigData = await generateKYBSignature(
                investor1.address, nonce, expiry, chainId, contractAddress, kybValidator
            );

            await paymentToken.mint(investor1.address, investAmount);
            await paymentToken.connect(investor1).approve(offeringAddress, investAmount);

            await expect(investmentManager.connect(investor1).routeInvestmentWithKYB(
                offeringAddress,
                paymentToken.target,
                investAmount,
                sigData.nonce,
                sigData.expiry,
                sigData.signature
            ))
                .to.emit(investmentManager, "KYBValidatedInvestment");

            // Check investment was successful
            const investorBalance = await saleToken.balanceOf(investor1.address);
            expect(investorBalance).to.be.gt(0);
        });

        it("Should require new signature for subsequent investments", async function () {
            const fixture = await loadFixture(deployKYBTestFixture);
            const { investmentManager, kybValidator, investor1, paymentToken } = fixture;
            const { offeringAddress, startDate } = await createTestOffering(fixture);

            await time.increaseTo(startDate + 10);

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const contractAddress = await investmentManager.getAddress();
            const nonce = Date.now();
            const expiry = (await time.latest()) + 3600;

            // First investment with signature
            const sigData = await generateKYBSignature(
                investor1.address, nonce, expiry, chainId, contractAddress, kybValidator
            );

            const investAmount1 = ethers.parseUnits("300", 18);
            await paymentToken.mint(investor1.address, investAmount1 * 2n);
            await paymentToken.connect(investor1).approve(offeringAddress, investAmount1);

            await investmentManager.connect(investor1).routeInvestmentWithKYB(
                offeringAddress,
                paymentToken.target,
                investAmount1,
                sigData.nonce,
                sigData.expiry,
                sigData.signature
            );

            // Second investment with new signature
            const nonce2 = Date.now() + 1;
            const expiry2 = (await time.latest()) + 3600;
            
            const sigData2 = await generateKYBSignature(
                investor1.address, nonce2, expiry2, chainId, contractAddress, kybValidator
            );
            
            const investAmount2 = ethers.parseUnits("200", 18);
            await paymentToken.connect(investor1).approve(offeringAddress, investAmount2);

            await expect(investmentManager.connect(investor1).routeInvestmentWithKYB(
                offeringAddress,
                paymentToken.target,
                investAmount2,
                sigData2.nonce,
                sigData2.expiry,
                sigData2.signature
            ))
                .to.emit(investmentManager, "KYBValidatedInvestment")
        });

        it("Should reject second investment with same signature", async function () {
            const fixture = await loadFixture(deployKYBTestFixture);
            const { investmentManager, kybValidator, investor1, paymentToken } = fixture;
            const { offeringAddress, startDate } = await createTestOffering(fixture);

            await time.increaseTo(startDate + 10);

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const contractAddress = await investmentManager.getAddress();
            const nonce = Date.now();
            const expiry = (await time.latest()) + 3600;

            const sigData = await generateKYBSignature(
                investor1.address, nonce, expiry, chainId, contractAddress, kybValidator
            );

            const investAmount = ethers.parseUnits("300", 18);
            await paymentToken.mint(investor1.address, investAmount * 2n);
            await paymentToken.connect(investor1).approve(offeringAddress, investAmount * 2n);

            // First investment
            await investmentManager.connect(investor1).routeInvestmentWithKYB(
                offeringAddress,
                paymentToken.target,
                investAmount,
                sigData.nonce,
                sigData.expiry,
                sigData.signature
            );

            // Second investment with same signature should fail
            await expect(investmentManager.connect(investor1).routeInvestmentWithKYB(
                offeringAddress,
                paymentToken.target,
                investAmount,
                sigData.nonce,
                sigData.expiry,
                sigData.signature
            )).to.be.revertedWith("Invalid KYB signature");
        });

        it("Should reject investment with invalid signature", async function () {
            const fixture = await loadFixture(deployKYBTestFixture);
            const { investmentManager, admin, investor1, paymentToken } = fixture; // Use admin instead of kybValidator
            const { offeringAddress, startDate } = await createTestOffering(fixture);

            await time.increaseTo(startDate + 10);

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const contractAddress = await investmentManager.getAddress();
            const nonce = Date.now();
            const expiry = (await time.latest()) + 3600;
            const investAmount = ethers.parseUnits("300", 18);

            // Generate signature with wrong signer
            const invalidSigData = await generateKYBSignature(
                investor1.address, nonce, expiry, chainId, contractAddress, admin // Wrong signer!
            );

            await paymentToken.mint(investor1.address, investAmount);
            await paymentToken.connect(investor1).approve(offeringAddress, investAmount);

            await expect(investmentManager.connect(investor1).routeInvestmentWithKYB(
                offeringAddress,
                paymentToken.target,
                investAmount,
                invalidSigData.nonce,
                invalidSigData.expiry,
                invalidSigData.signature
            )).to.be.revertedWith("Invalid KYB signature");
        });

        it("Should reject investment with expired signature", async function () {
            const fixture = await loadFixture(deployKYBTestFixture);
            const { investmentManager, kybValidator, investor1, paymentToken } = fixture;
            const { offeringAddress, startDate } = await createTestOffering(fixture);

            await time.increaseTo(startDate + 10);

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const contractAddress = await investmentManager.getAddress();
            const nonce = Date.now();
            const expiry = (await time.latest()) - 100; // Already expired
            const investAmount = ethers.parseUnits("300", 18);

            const expiredSigData = await generateKYBSignature(
                investor1.address, nonce, expiry, chainId, contractAddress, kybValidator
            );

            await paymentToken.mint(investor1.address, investAmount);
            await paymentToken.connect(investor1).approve(offeringAddress, investAmount);

            await expect(investmentManager.connect(investor1).routeInvestmentWithKYB(
                offeringAddress,
                paymentToken.target,
                investAmount,
                expiredSigData.nonce,
                expiredSigData.expiry,
                expiredSigData.signature
            )).to.be.revertedWith("Signature expired");
        });

        it("Should handle native ETH investment with KYB", async function () {
            const fixture = await loadFixture(deployKYBTestFixture);
            const { investmentManager, kybValidator, investor1 } = fixture;
            const { offeringAddress, startDate } = await createTestOffering(fixture);

            await time.increaseTo(startDate + 10);

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const contractAddress = await investmentManager.getAddress();
            const nonce = Date.now();
            const expiry = (await time.latest()) + 3600;
            const investAmount = ethers.parseUnits("0.1", 18); // 0.1 ETH

            const sigData = await generateKYBSignature(
                investor1.address, nonce, expiry, chainId, contractAddress, kybValidator
            );

            await expect(investmentManager.connect(investor1).routeInvestmentWithKYB(
                offeringAddress,
                ethers.ZeroAddress, // Native ETH
                investAmount,
                sigData.nonce,
                sigData.expiry,
                sigData.signature,
                { value: investAmount }
            ))
                .to.emit(investmentManager, "WalletKYBValidated")
                .and.to.emit(investmentManager, "KYBValidatedInvestment");
        });
    });

    describe("Integration with Existing Functions", function () {
        it("Should work alongside regular routeInvestment function", async function () {
            const fixture = await loadFixture(deployKYBTestFixture);
            const { investmentManager, kybValidator, investor1, investor2, paymentToken } = fixture;
            const { offeringAddress, startDate } = await createTestOffering(fixture);

            await time.increaseTo(startDate + 10);

            // Investor1 uses KYB validation
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const contractAddress = await investmentManager.getAddress();
            const nonce = Date.now();
            const expiry = (await time.latest()) + 3600;
            const investAmount1 = ethers.parseUnits("300", 18);

            const sigData = await generateKYBSignature(
                investor1.address, nonce, expiry, chainId, contractAddress, kybValidator
            );

            await paymentToken.mint(investor1.address, investAmount1);
            await paymentToken.connect(investor1).approve(offeringAddress, investAmount1);

            await investmentManager.connect(investor1).routeInvestmentWithKYB(
                offeringAddress,
                paymentToken.target,
                investAmount1,
                sigData.nonce,
                sigData.expiry,
                sigData.signature
            );

            // Investor2 uses regular investment (no KYB)
            const investAmount2 = ethers.parseUnits("400", 18);
            await paymentToken.mint(investor2.address, investAmount2);
            await paymentToken.connect(investor2).approve(offeringAddress, investAmount2);

            await expect(investmentManager.connect(investor2).routeInvestment(
                offeringAddress,
                paymentToken.target,
                investAmount2
            ))
                .to.emit(investmentManager, "InvestmentRouted")
                .and.to.not.emit(investmentManager, "KYBValidatedInvestment");

            // Both investments should be successful
            const offering = await ethers.getContractAt("Offering", offeringAddress);
            const totalRaised = await offering.totalRaised();
            expect(totalRaised).to.equal(ethers.parseUnits("700", 18)); // $300 + $400
        });
    });

    describe("View Functions", function () {
        it("Should return correct KYB validator", async function () {
            const { investmentManager, kybValidator } = await loadFixture(deployKYBTestFixture);
            expect(await investmentManager.getKYBValidator()).to.equal(kybValidator.address);
        });

        it("Should track signature usage correctly", async function () {
            const { investmentManager, kybValidator, investor1 } = await loadFixture(deployKYBTestFixture);
            
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const contractAddress = await investmentManager.getAddress();
            const nonce = Date.now();
            const expiry = (await time.latest()) + 3600;

            const sigData = await generateKYBSignature(
                investor1.address, nonce, expiry, chainId, contractAddress, kybValidator
            );

            // Create the same hash as contract would
            const messageHash = ethers.solidityPackedKeccak256(
                ["string", "address", "uint256", "uint256", "uint256", "address"],
                ["KYB_VALIDATION", investor1.address, nonce, expiry, chainId, contractAddress]
            );
            const ethSignedMessageHash = ethers.hashMessage(ethers.getBytes(messageHash));

            expect(await investmentManager.isSignatureUsed(ethSignedMessageHash)).to.be.false;

            // Use signature for investment
            await paymentToken.mint(investor1.address, ethers.parseUnits("300", 18));
            await paymentToken.connect(investor1).approve(offeringAddress, ethers.parseUnits("300", 18));
            
            await investmentManager.connect(investor1).routeInvestmentWithKYB(
                offeringAddress,
                paymentToken.target,
                ethers.parseUnits("300", 18),
                sigData.nonce, sigData.expiry, sigData.signature
            );

            expect(await investmentManager.isSignatureUsed(ethSignedMessageHash)).to.be.true;
        });
    });

    describe("Error Handling", function () {
        it("Should revert when KYB validator is not set", async function () {
            const { admin, investor1 } = await loadFixture(deployKYBTestFixture);
            
            // Deploy fresh InvestmentManager without setting KYB validator
            const InvestmentManager = await ethers.getContractFactory("InvestmentManager");
            const freshInvestmentManager = await InvestmentManager.deploy();

            const nonce = Date.now();
            const expiry = (await time.latest()) + 3600;

            await expect(freshInvestmentManager.verifyKYBSignature(
                investor1.address, nonce, expiry, "0x1234"
            )).to.be.revertedWith("KYB validator not set");
        });
    });
});