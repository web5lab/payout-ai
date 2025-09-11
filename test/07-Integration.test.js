const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Complete Ecosystem Integration Tests", function () {
    async function deployCompleteEcosystemFixture() {
        const [admin, tokenOwner, treasuryOwner, kybValidator, investor1, investor2, investor3, payoutAdmin] = await ethers.getSigners();

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

        // Deploy core infrastructure
        const WrappedTokenFactory = await ethers.getContractFactory("WrappedTokenFactory");
        const wrappedTokenFactory = await WrappedTokenFactory.deploy();

        const OfferingFactory = await ethers.getContractFactory("OfferingFactory");
        const offeringFactory = await OfferingFactory.deploy(await wrappedTokenFactory.getAddress());

        const InvestmentManager = await ethers.getContractFactory("InvestmentManager");
        const investmentManager = await InvestmentManager.deploy();

        const Escrow = await ethers.getContractFactory("Escrow");
        const escrow = await Escrow.deploy({ owner: treasuryOwner.address });

        // Configure system
        await investmentManager.connect(admin).setEscrowContract(await escrow.getAddress());
        await investmentManager.connect(admin).setKYBValidator(kybValidator.address);
        await escrow.connect(treasuryOwner).setInvestmentManager(await investmentManager.getAddress());
        await offeringFactory.connect(admin).setUSDTConfig(
            await usdtToken.getAddress(),
            await usdtOracle.getAddress()
        );

        // Mint initial tokens
        await saleToken.mint(tokenOwner.address, ethers.parseUnits("1000000", 18));
        await paymentToken.mint(investor1.address, ethers.parseUnits("10000", 18));
        await paymentToken.mint(investor2.address, ethers.parseUnits("10000", 18));
        await paymentToken.mint(investor3.address, ethers.parseUnits("10000", 18));
        await usdtToken.mint(investor1.address, ethers.parseUnits("10000", 6));
        await payoutToken.mint(payoutAdmin.address, ethers.parseUnits("100000", 18));

        return {
            admin, tokenOwner, treasuryOwner, kybValidator, investor1, investor2, investor3, payoutAdmin,
            saleToken, paymentToken, usdtToken, payoutToken,
            payOracle, ethOracle, usdtOracle,
            wrappedTokenFactory, offeringFactory, investmentManager, escrow
        };
    }

    async function createCompleteOffering(fixture, config = {}) {
        const { 
            admin, tokenOwner, saleToken, payoutToken, payOracle, ethOracle, usdtOracle,
            offeringFactory, escrow, investmentManager, paymentToken, usdtToken
        } = fixture;

        const now = await time.latest();
        const offeringConfig = {
            saleToken: await saleToken.getAddress(),
            minInvestment: ethers.parseUnits("100", 18),
            maxInvestment: ethers.parseUnits("5000", 18),
            startDate: now + 300,
            endDate: now + 300 + 3600,
            apyEnabled: config.apyEnabled || false,
            softCap: ethers.parseUnits("10000", 18),
            fundraisingCap: ethers.parseUnits("100000", 18),
            tokenPrice: ethers.parseUnits("0.5", 18),
            tokenOwner: tokenOwner.address,
            escrowAddress: await escrow.getAddress(),
            investmentManager: investmentManager.address,
            payoutTokenAddress: await payoutToken.getAddress(),
            payoutRate: 1200,
            payoutPeriodDuration: 2592000,
            maturityDate: now + 300 + 31536000
        };

        const paymentTokens = [
            await paymentToken.getAddress(),
            ethers.ZeroAddress,
            await usdtToken.getAddress()
        ];
        const oracles = [
            await payOracle.getAddress(),
            await ethOracle.getAddress(),
            await usdtOracle.getAddress()
        ];

        const tx = await offeringFactory.connect(admin).createOfferingWithPaymentTokens(
            offeringConfig,
            paymentTokens,
            oracles
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find(log => log.fragment && log.fragment.name === 'OfferingDeployed');
        const offeringAddress = event.args.offeringAddress;
        const offering = await ethers.getContractAt("Offering", offeringAddress);

        // Register offering and transfer tokens
        await escrow.connect(fixture.treasuryOwner).registerOffering(offeringAddress, tokenOwner.address);
        await saleToken.connect(tokenOwner).transfer(offeringAddress, ethers.parseUnits("200000", 18));

        let wrappedToken;
        if (config.apyEnabled) {
            const wrappedTokenAddress = await offering.wrappedTokenAddress();
            wrappedToken = await ethers.getContractAt("WRAPPEDTOKEN", wrappedTokenAddress);
            
            // Grant payout admin role
            const PAYOUT_ADMIN_ROLE = await wrappedToken.PAYOUT_ADMIN_ROLE();
            await wrappedToken.connect(admin).grantRole(PAYOUT_ADMIN_ROLE, fixture.payoutAdmin.address);
        }

        return { offering, offeringAddress, wrappedToken, config: offeringConfig };
    }

    describe("Complete Investment Flow", function () {
        it("Should handle complete APY-enabled investment lifecycle", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { investmentManager, investor1, paymentToken, payoutToken, payoutAdmin } = fixture;
            const { offering, wrappedToken, config } = await createCompleteOffering(fixture, { apyEnabled: true });

            await time.increaseTo(config.startDate + 10);

            // 1. Investment
            const investmentAmount = ethers.parseUnits("1000", 18); // $1000
            const expectedTokens = ethers.parseUnits("2000", 18); // $1000 / $0.5 = 2000 tokens
            
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            
            await expect(investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            ))
                .to.emit(investmentManager, "InvestmentRouted")
                .and.to.emit(offering, "Invested")
                .and.to.emit(wrappedToken, "InvestmentRegistered");

            expect(await wrappedToken.balanceOf(investor1.address)).to.equal(expectedTokens);

            // 2. Set first payout date (simulating offering finalization)
            await wrappedToken.connect(await offering.getAddress()).setFirstPayoutDate();

            // 3. Payout distribution
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(firstPayoutDate + 10);
            
            const payoutAmount = ethers.parseUnits("100", 18);
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount);
            
            await expect(wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payoutAmount))
                .to.emit(wrappedToken, "PayoutDistributed");

            // 4. Payout claim
            await expect(wrappedToken.connect(investor1).claimAvailablePayouts())
                .to.emit(wrappedToken, "PayoutClaimed");

            expect(await payoutToken.balanceOf(investor1.address)).to.equal(payoutAmount);

            // 5. Final token claim at maturity
            await time.increaseTo(config.maturityDate + 10);
            
            await expect(wrappedToken.connect(investor1).claimFinalTokens())
                .to.emit(wrappedToken, "FinalTokensClaimed");

            expect(await saleToken.balanceOf(investor1.address)).to.equal(expectedTokens);
        });

        it("Should handle multi-token investment scenario", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { investmentManager, investor1, investor2, investor3, paymentToken, usdtToken } = fixture;
            const { offering, config } = await createCompleteOffering(fixture);

            await time.increaseTo(config.startDate + 10);

            // Investment 1: PAY tokens
            const payInvestment = ethers.parseUnits("500", 18); // $500
            await paymentToken.connect(investor1).approve(await offering.getAddress(), payInvestment);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                payInvestment
            );

            // Investment 2: Native ETH
            const ethInvestment = ethers.parseUnits("0.1", 18); // 0.1 ETH = $200
            await investmentManager.connect(investor2).routeInvestment(
                await offering.getAddress(),
                ethers.ZeroAddress,
                ethInvestment,
                { value: ethInvestment }
            );

            // Investment 3: USDT (6 decimals)
            const usdtInvestment = ethers.parseUnits("300", 6); // $300
            await usdtToken.connect(investor3).approve(await offering.getAddress(), usdtInvestment);
            await investmentManager.connect(investor3).routeInvestment(
                await offering.getAddress(),
                await usdtToken.getAddress(),
                usdtInvestment
            );

            // Check total raised
            const totalRaised = await offering.totalRaised();
            expect(totalRaised).to.equal(ethers.parseUnits("1000", 18)); // $500 + $200 + $300

            // Check escrow balances
            const escrowAddress = await fixture.escrow.getAddress();
            expect(await paymentToken.balanceOf(escrowAddress)).to.equal(payInvestment);
            expect(await ethers.provider.getBalance(escrowAddress)).to.equal(ethInvestment);
            expect(await usdtToken.balanceOf(escrowAddress)).to.equal(usdtInvestment);
        });

        it("Should handle complete refund scenario", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { investmentManager, investor1, paymentToken, escrow, treasuryOwner } = fixture;
            const { offering, config } = await createCompleteOffering(fixture);

            await time.increaseTo(config.startDate + 10);

            // Make investment
            const investmentAmount = ethers.parseUnits("1000", 18);
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Enable refunds
            await escrow.connect(treasuryOwner).enableRefundsByOwner(await offering.getAddress());

            // Claim refund
            const initialBalance = await paymentToken.balanceOf(investor1.address);
            
            await expect(investmentManager.connect(investor1).claimRefund(
                await offering.getAddress(),
                await paymentToken.getAddress()
            ))
                .to.emit(investmentManager, "RefundClaimed")
                .and.to.emit(escrow, "Refunded");

            const finalBalance = await paymentToken.balanceOf(investor1.address);
            expect(finalBalance - initialBalance).to.equal(investmentAmount);
        });
    });

    describe("KYB Integration Flow", function () {
        async function generateKYBSignature(walletAddress, nonce, expiry, chainId, contractAddress, signer) {
            const messageHash = ethers.solidityPackedKeccak256(
                ["string", "address", "uint256", "uint256", "uint256", "address"],
                ["KYB_VALIDATION", walletAddress, nonce, expiry, chainId, contractAddress]
            );
            
            const signature = await signer.signMessage(ethers.getBytes(messageHash));
            return { messageHash, signature, nonce, expiry };
        }

        it("Should handle complete KYB-validated investment flow", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { investmentManager, kybValidator, investor1, paymentToken } = fixture;
            const { offering, config } = await createCompleteOffering(fixture);

            await time.increaseTo(config.startDate + 10);

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const contractAddress = await investmentManager.getAddress();
            const nonce = Date.now();
            const expiry = (await time.latest()) + 3600;
            const investmentAmount = ethers.parseUnits("1000", 18);

            const sigData = await generateKYBSignature(
                investor1.address, nonce, expiry, chainId, contractAddress, kybValidator
            );

            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);

            await expect(investmentManager.connect(investor1).routeInvestmentWithKYB(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount,
                sigData.nonce,
                sigData.expiry,
                sigData.signature
            ))
                .to.emit(investmentManager, "KYBValidatedInvestment")
                .and.to.emit(offering, "Invested");

            expect(await offering.totalRaised()).to.equal(investmentAmount);
        });

        it("Should require new signature for each KYB investment", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { investmentManager, kybValidator, investor1, paymentToken } = fixture;
            const { offering, config } = await createCompleteOffering(fixture);

            await time.increaseTo(config.startDate + 10);

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const contractAddress = await investmentManager.getAddress();

            // First investment
            const nonce1 = Date.now();
            const expiry1 = (await time.latest()) + 3600;
            const investment1 = ethers.parseUnits("500", 18);

            const sig1 = await generateKYBSignature(
                investor1.address, nonce1, expiry1, chainId, contractAddress, kybValidator
            );

            await paymentToken.connect(investor1).approve(await offering.getAddress(), investment1 * 2n);

            await investmentManager.connect(investor1).routeInvestmentWithKYB(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investment1,
                sig1.nonce, sig1.expiry, sig1.signature
            );

            // Second investment requires new signature
            const nonce2 = Date.now() + 1;
            const expiry2 = (await time.latest()) + 3600;
            const investment2 = ethers.parseUnits("300", 18);

            const sig2 = await generateKYBSignature(
                investor1.address, nonce2, expiry2, chainId, contractAddress, kybValidator
            );

            await expect(investmentManager.connect(investor1).routeInvestmentWithKYB(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investment2,
                sig2.nonce, sig2.expiry, sig2.signature
            ))
                .to.emit(investmentManager, "KYBValidatedInvestment");

            expect(await offering.totalRaised()).to.equal(investment1 + investment2);
        });
    });

    describe("APY and Payout Integration", function () {
        it("Should handle complete APY payout cycle", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { investmentManager, investor1, investor2, paymentToken, payoutToken, payoutAdmin } = fixture;
            const { offering, wrappedToken, config } = await createCompleteOffering(fixture, { apyEnabled: true });

            await time.increaseTo(config.startDate + 10);

            // Multiple investments
            const investment1 = ethers.parseUnits("600", 18); // $600 = 60%
            const investment2 = ethers.parseUnits("400", 18); // $400 = 40%

            await paymentToken.connect(investor1).approve(await offering.getAddress(), investment1);
            await paymentToken.connect(investor2).approve(await offering.getAddress(), investment2);

            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investment1
            );

            await investmentManager.connect(investor2).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investment2
            );

            // Set first payout date
            await wrappedToken.connect(await offering.getAddress()).setFirstPayoutDate();

            // Distribute payout
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(firstPayoutDate + 10);

            const totalPayout = ethers.parseUnits("1000", 18);
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), totalPayout);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(totalPayout);

            // Check proportional distribution
            const user1Info = await wrappedToken.getUserPayoutInfo(investor1.address);
            const user2Info = await wrappedToken.getUserPayoutInfo(investor2.address);

            expect(user1Info.totalClaimable).to.equal(ethers.parseUnits("600", 18)); // 60%
            expect(user2Info.totalClaimable).to.equal(ethers.parseUnits("400", 18)); // 40%

            // Claim payouts
            await wrappedToken.connect(investor1).claimAvailablePayouts();
            await wrappedToken.connect(investor2).claimAvailablePayouts();

            expect(await payoutToken.balanceOf(investor1.address)).to.equal(ethers.parseUnits("600", 18));
            expect(await payoutToken.balanceOf(investor2.address)).to.equal(ethers.parseUnits("400", 18));
        });

        it("Should handle emergency unlock during payout cycle", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { investmentManager, investor1, investor2, paymentToken, payoutToken, payoutAdmin, admin } = fixture;
            const { offering, wrappedToken, config } = await createCompleteOffering(fixture, { apyEnabled: true });

            await time.increaseTo(config.startDate + 10);

            // Investments
            const investment1 = ethers.parseUnits("500", 18);
            const investment2 = ethers.parseUnits("500", 18);

            await paymentToken.connect(investor1).approve(await offering.getAddress(), investment1);
            await paymentToken.connect(investor2).approve(await offering.getAddress(), investment2);

            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investment1
            );

            await investmentManager.connect(investor2).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investment2
            );

            // Set first payout date and distribute first payout
            await wrappedToken.connect(await offering.getAddress()).setFirstPayoutDate();
            
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(firstPayoutDate + 10);

            const payout1 = ethers.parseUnits("200", 18);
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout1);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout1);

            // Both users claim first payout
            await wrappedToken.connect(investor1).claimAvailablePayouts();
            await wrappedToken.connect(investor2).claimAvailablePayouts();

            expect(await payoutToken.balanceOf(investor1.address)).to.equal(ethers.parseUnits("100", 18));
            expect(await payoutToken.balanceOf(investor2.address)).to.equal(ethers.parseUnits("100", 18));

            // Investor1 emergency unlocks
            await wrappedToken.connect(admin).enableEmergencyUnlock(1500); // 15% penalty
            await wrappedToken.connect(investor1).emergencyUnlock();

            // Second payout - only investor2 should receive
            await time.increase(config.payoutPeriodDuration + 10);

            const payout2 = ethers.parseUnits("100", 18);
            await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payout2);
            await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payout2);

            const user2Info = await wrappedToken.getUserPayoutInfo(investor2.address);
            expect(user2Info.totalClaimable).to.equal(payout2); // Gets all of second payout

            await wrappedToken.connect(investor2).claimAvailablePayouts();
            expect(await payoutToken.balanceOf(investor2.address)).to.equal(ethers.parseUnits("200", 18));
        });
    });

    describe("Escrow Integration", function () {
        it("Should handle offering finalization and fund transfer", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { investmentManager, investor1, paymentToken, escrow, treasuryOwner, tokenOwner } = fixture;
            const { offering, config } = await createCompleteOffering(fixture);

            await time.increaseTo(config.startDate + 10);

            // Make investment
            const investmentAmount = ethers.parseUnits("5000", 18);
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            // Finalize offering
            await time.increaseTo(config.endDate + 10);

            const initialBalance = await paymentToken.balanceOf(tokenOwner.address);
            
            await expect(escrow.connect(treasuryOwner).finalizeOffering(await offering.getAddress()))
                .to.emit(escrow, "OfferingFinalized")
                .and.to.emit(offering, "OfferingFinalized");

            const finalBalance = await paymentToken.balanceOf(tokenOwner.address);
            expect(finalBalance - initialBalance).to.equal(investmentAmount);

            expect(await offering.isOfferingFinalized()).to.be.true;
        });

        it("Should handle offering cancellation and refunds", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { investmentManager, investor1, investor2, paymentToken, tokenOwner, escrow } = fixture;
            const { offering, config } = await createCompleteOffering(fixture);

            await time.increaseTo(config.startDate + 10);

            // Multiple investments
            const investment1 = ethers.parseUnits("800", 18);
            const investment2 = ethers.parseUnits("600", 18);

            await paymentToken.connect(investor1).approve(await offering.getAddress(), investment1);
            await paymentToken.connect(investor2).approve(await offering.getAddress(), investment2);

            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investment1
            );

            await investmentManager.connect(investor2).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investment2
            );

            // Cancel offering
            await expect(offering.connect(tokenOwner).cancelOffering())
                .to.emit(offering, "OfferingCancelled")
                .and.to.emit(escrow, "RefundsEnabled");

            // Process refunds
            const balance1Before = await paymentToken.balanceOf(investor1.address);
            const balance2Before = await paymentToken.balanceOf(investor2.address);

            await investmentManager.connect(investor1).claimRefund(
                await offering.getAddress(),
                await paymentToken.getAddress()
            );

            await investmentManager.connect(investor2).claimRefund(
                await offering.getAddress(),
                await paymentToken.getAddress()
            );

            const balance1After = await paymentToken.balanceOf(investor1.address);
            const balance2After = await paymentToken.balanceOf(investor2.address);

            expect(balance1After - balance1Before).to.equal(investment1);
            expect(balance2After - balance2Before).to.equal(investment2);
        });
    });

    describe("Edge Cases and Error Handling", function () {
        it("Should handle investment limits correctly", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { investmentManager, investor1, paymentToken } = fixture;
            const { offering, config } = await createCompleteOffering(fixture);

            await time.increaseTo(config.startDate + 10);

            // Test below minimum
            const belowMin = ethers.parseUnits("50", 18); // $50 < $100 min
            await paymentToken.connect(investor1).approve(await offering.getAddress(), belowMin);

            await expect(investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                belowMin
            )).to.be.revertedWith("Below min investment");

            // Test above maximum
            const aboveMax = ethers.parseUnits("6000", 18); // $6000 > $5000 max
            await paymentToken.connect(investor1).approve(await offering.getAddress(), aboveMax);

            await expect(investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                aboveMax
            )).to.be.revertedWith("Exceeds max investment");
        });

        it("Should handle sale timing restrictions", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { investmentManager, investor1, paymentToken } = fixture;
            const { offering, config } = await createCompleteOffering(fixture);

            const investmentAmount = ethers.parseUnits("500", 18);
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);

            // Before start
            await expect(investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            )).to.be.revertedWith("Sale not started");

            // After end
            await time.increaseTo(config.endDate + 10);

            await expect(investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            )).to.be.revertedWith("Sale ended");
        });

        it("Should handle paused contract state", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { investmentManager, investor1, paymentToken, admin } = fixture;
            const { offering, config } = await createCompleteOffering(fixture);

            await time.increaseTo(config.startDate + 10);

            // Pause offering
            await offering.connect(admin).pause();

            const investmentAmount = ethers.parseUnits("500", 18);
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);

            await expect(investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            )).to.be.revertedWithCustomError(offering, "EnforcedPause");
        });
    });

    describe("Performance and Gas Optimization", function () {
        it("Should handle large number of investors efficiently", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { investmentManager, paymentToken } = fixture;
            const { offering, wrappedToken, config } = await createCompleteOffering(fixture, { apyEnabled: true });

            await time.increaseTo(config.startDate + 10);

            // Create multiple investors
            const investors = [];
            const investmentAmount = ethers.parseUnits("200", 18);

            for (let i = 0; i < 5; i++) {
                const investor = ethers.Wallet.createRandom().connect(ethers.provider);
                await fixture.admin.sendTransaction({ to: investor.address, value: ethers.parseEther("1") });
                await paymentToken.mint(investor.address, investmentAmount);
                await paymentToken.connect(investor).approve(await offering.getAddress(), investmentAmount);
                
                await investmentManager.connect(investor).routeInvestment(
                    await offering.getAddress(),
                    await paymentToken.getAddress(),
                    investmentAmount
                );
                
                investors.push(investor);
            }

            expect(await offering.totalRaised()).to.equal(investmentAmount * 5n);
            expect(await wrappedToken.totalSupply()).to.equal(ethers.parseUnits("2000", 18)); // $200 * 5 / $0.5 = 2000 tokens
        });

        it("Should handle multiple payout periods efficiently", async function () {
            const fixture = await loadFixture(deployCompleteEcosystemFixture);
            const { investmentManager, investor1, paymentToken, payoutToken, payoutAdmin } = fixture;
            const { offering, wrappedToken, config } = await createCompleteOffering(fixture, { apyEnabled: true });

            await time.increaseTo(config.startDate + 10);

            // Make investment
            const investmentAmount = ethers.parseUnits("1000", 18);
            await paymentToken.connect(investor1).approve(await offering.getAddress(), investmentAmount);
            await investmentManager.connect(investor1).routeInvestment(
                await offering.getAddress(),
                await paymentToken.getAddress(),
                investmentAmount
            );

            await wrappedToken.connect(await offering.getAddress()).setFirstPayoutDate();

            // Distribute multiple payouts
            const firstPayoutDate = await wrappedToken.firstPayoutDate();
            await time.increaseTo(firstPayoutDate + 10);

            for (let i = 0; i < 3; i++) {
                const payoutAmount = ethers.parseUnits("50", 18);
                await payoutToken.connect(payoutAdmin).approve(await wrappedToken.getAddress(), payoutAmount);
                await wrappedToken.connect(payoutAdmin).distributePayoutForPeriod(payoutAmount);
                
                if (i < 2) { // Don't advance time after last payout
                    await time.increase(config.payoutPeriodDuration + 10);
                }
            }

            // Claim all available payouts at once
            await expect(wrappedToken.connect(investor1).claimAvailablePayouts())
                .to.emit(wrappedToken, "PayoutClaimed");

            expect(await payoutToken.balanceOf(investor1.address)).to.equal(ethers.parseUnits("150", 18));
            expect(await wrappedToken.currentPayoutPeriod()).to.equal(3);
        });
    });
});