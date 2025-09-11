const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("WrappedTokenFactory (Unit)", function () {
    async function deployWrappedTokenFactoryFixture() {
        const [owner, creator1, creator2, admin1, admin2, offeringContract1, offeringContract2] = await ethers.getSigners();
        
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const peggedToken1 = await MockERC20.deploy("Pegged Token 1", "PEGGED1");
        const peggedToken2 = await MockERC20.deploy("Pegged Token 2", "PEGGED2");
        const payoutToken1 = await MockERC20.deploy("Payout Token 1", "PAYOUT1");
        const payoutToken2 = await MockERC20.deploy("Payout Token 2", "PAYOUT2");
        
        const WrappedTokenFactory = await ethers.getContractFactory("WrappedTokenFactory");
        const factory = await WrappedTokenFactory.deploy();
        
        const latestTime = await time.latest();
        const maturityDate1 = latestTime + (30 * 24 * 60 * 60); // 30 days
        const maturityDate2 = latestTime + (60 * 24 * 60 * 60); // 60 days
        const payoutPeriodDuration = 30 * 24 * 60 * 60; // 30 days
        const firstPayoutDate1 = latestTime + (7 * 24 * 60 * 60); // 7 days
        const firstPayoutDate2 = latestTime + (14 * 24 * 60 * 60); // 14 days
        
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
            payoutPeriodDuration,
            firstPayoutDate1,
            firstPayoutDate2
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
        it("Should create a wrapped token with correct configuration", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1, 
                maturityDate1 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config = {
                name: "Test Wrapped Token",
                symbol: "TWT",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 500, // 5%
                offeringContract: offeringContract1.address,
                admin: admin1.address,
                payoutPeriodDuration: payoutPeriodDuration,
                firstPayoutDate: firstPayoutDate1
            };

            await expect(factory.connect(creator1).createWrappedToken(config))
                .to.emit(factory, "WrappedTokenDeployed");

            const wrappedTokenAddress = await factory.getWrappedTokenAddress(0);
            expect(wrappedTokenAddress).to.not.equal(ethers.ZeroAddress);

            // Verify the wrapped token was configured correctly
            const wrappedToken = await ethers.getContractAt("WRAPEDTOKEN", wrappedTokenAddress);
            expect(await wrappedToken.name()).to.equal("Test Wrapped Token");
            expect(await wrappedToken.symbol()).to.equal("TWT");
            expect(await wrappedToken.peggedToken()).to.equal(await peggedToken1.getAddress());
            expect(await wrappedToken.payoutToken()).to.equal(await payoutToken1.getAddress());
            expect(await wrappedToken.maturityDate()).to.equal(maturityDate1);
            expect(await wrappedToken.payoutRate()).to.equal(500);
            expect(await wrappedToken.payoutPeriodDuration()).to.equal(payoutPeriodDuration);
            expect(await wrappedToken.firstPayoutDate()).to.equal(firstPayoutDate1);
            expect(await wrappedToken.offeringContract()).to.equal(offeringContract1.address);
        });

        it("Should emit WrappedTokenDeployed event with correct parameters", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1, 
                maturityDate1 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config = {
                name: "Test Wrapped Token",
                symbol: "TWT",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            const tx = await factory.connect(creator1).createWrappedToken(config);
            const receipt = await tx.wait();
            
            const event = receipt.logs.find(log => log.fragment && log.fragment.name === 'WrappedTokenDeployed');
            expect(event).to.not.be.undefined;
            expect(event.args.tokenId).to.equal(0);
            expect(event.args.creator).to.equal(creator1.address);
            expect(event.args.offeringContract).to.equal(offeringContract1.address);
        });

        it("Should grant DEFAULT_ADMIN_ROLE to the specified admin", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1, 
                maturityDate1 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config = {
                name: "Test Wrapped Token",
                symbol: "TWT",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address,
                payoutPeriodDuration: payoutPeriodDuration,
                firstPayoutDate: firstPayoutDate1
            };

            await factory.connect(creator1).createWrappedToken(config);
            const wrappedTokenAddress = await factory.getWrappedTokenAddress(0);
            const wrappedToken = await ethers.getContractAt("WRAPEDTOKEN", wrappedTokenAddress);
            
            const DEFAULT_ADMIN_ROLE = await wrappedToken.DEFAULT_ADMIN_ROLE();
            expect(await wrappedToken.hasRole(DEFAULT_ADMIN_ROLE, admin1.address)).to.be.true;
        });

        it("Should increment count after creating wrapped token", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1, 
                maturityDate1 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            expect(await factory.count()).to.equal(0);
            
            const config = {
                name: "Test Wrapped Token",
                symbol: "TWT",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            await factory.connect(creator1).createWrappedToken(config);
            expect(await factory.count()).to.equal(1);
        });

        it("Should create multiple wrapped tokens with different configurations", async function () {
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
                maturityDate2 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config1 = {
                name: "Wrapped Token 1",
                symbol: "WT1",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address,
                payoutPeriodDuration: payoutPeriodDuration,
                firstPayoutDate: firstPayoutDate1
            };

            const config2 = {
                name: "Wrapped Token 2",
                symbol: "WT2",
                peggedToken: await peggedToken2.getAddress(),
                payoutToken: await payoutToken2.getAddress(),
                maturityDate: maturityDate2,
                payoutRate: 1000,
                offeringContract: offeringContract2.address,
                admin: admin2.address,
                payoutPeriodDuration: payoutPeriodDuration,
                firstPayoutDate: firstPayoutDate2
            };

            await factory.connect(creator1).createWrappedToken(config1);
            await factory.connect(creator2).createWrappedToken(config2);

            expect(await factory.count()).to.equal(2);

            const token1Address = await factory.getWrappedTokenAddress(0);
            const token2Address = await factory.getWrappedTokenAddress(1);
            
            const token1 = await ethers.getContractAt("WRAPEDTOKEN", token1Address);
            const token2 = await ethers.getContractAt("WRAPEDTOKEN", token2Address);

            expect(await token1.name()).to.equal("Wrapped Token 1");
            expect(await token1.symbol()).to.equal("WT1");
            expect(await token1.payoutRate()).to.equal(500);

            expect(await token2.name()).to.equal("Wrapped Token 2");
            expect(await token2.symbol()).to.equal("WT2");
            expect(await token2.payoutRate()).to.equal(1000);
        });

        it("Should revert with zero address for pegged token", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                payoutToken1, 
                maturityDate1 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config = {
                name: "Test Wrapped Token",
                symbol: "TWT",
                peggedToken: ethers.ZeroAddress,
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            await expect(factory.connect(creator1).createWrappedToken(config))
                .to.be.reverted;
        });

        it("Should revert with zero address for payout token", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                maturityDate1 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config = {
                name: "Test Wrapped Token",
                symbol: "TWT",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: ethers.ZeroAddress,
                maturityDate: maturityDate1,
                payoutRate: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            await expect(factory.connect(creator1).createWrappedToken(config))
                .to.be.revertedWithCustomError(factory, "InvalidStablecoin");
        });
    });

    describe("View Functions", function () {
        it("Should return correct wrapped token address by ID", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1, 
                maturityDate1 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config = {
                name: "Test Wrapped Token",
                symbol: "TWT",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            await factory.connect(creator1).createWrappedToken(config);
            
            const tokenAddress = await factory.getWrappedTokenAddress(0);
            expect(tokenAddress).to.not.equal(ethers.ZeroAddress);
            
            // Verify it's actually a wrapped token contract
            const wrappedToken = await ethers.getContractAt("WRAPEDTOKEN", tokenAddress);
            expect(await wrappedToken.name()).to.equal("Test Wrapped Token");
        });

        it("Should return correct creator for wrapped token", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1, 
                maturityDate1 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config = {
                name: "Test Wrapped Token",
                symbol: "TWT",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            await factory.connect(creator1).createWrappedToken(config);
            const tokenAddress = await factory.getWrappedTokenAddress(0);
            
            expect(await factory.getWrappedTokenCreator(tokenAddress)).to.equal(creator1.address);
        });

        it("Should return wrapped token IDs by creator", async function () {
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
                maturityDate2 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config1 = {
                name: "Token 1",
                symbol: "T1",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            const config2 = {
                name: "Token 2",
                symbol: "T2",
                peggedToken: await peggedToken2.getAddress(),
                payoutToken: await payoutToken2.getAddress(),
                maturityDate: maturityDate2,
                payoutRate: 1000,
                offeringContract: offeringContract2.address,
                admin: admin2.address
            };

            const config3 = {
                name: "Token 3",
                symbol: "T3",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 750,
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            // Creator1 creates 2 tokens
            await factory.connect(creator1).createWrappedToken(config1);
            await factory.connect(creator1).createWrappedToken(config3);
            
            // Creator2 creates 1 token
            await factory.connect(creator2).createWrappedToken(config2);

            const creator1Tokens = await factory.getWrappedTokenIdsByCreator(creator1.address);
            const creator2Tokens = await factory.getWrappedTokenIdsByCreator(creator2.address);

            expect(creator1Tokens.length).to.equal(2);
            expect(creator1Tokens[0]).to.equal(0);
            expect(creator1Tokens[1]).to.equal(1);

            expect(creator2Tokens.length).to.equal(1);
            expect(creator2Tokens[0]).to.equal(2);
        });

        it("Should return all wrapped tokens", async function () {
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
                maturityDate2 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config1 = {
                name: "Token 1",
                symbol: "T1",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            const config2 = {
                name: "Token 2",
                symbol: "T2",
                peggedToken: await peggedToken2.getAddress(),
                payoutToken: await payoutToken2.getAddress(),
                maturityDate: maturityDate2,
                payoutRate: 1000,
                offeringContract: offeringContract2.address,
                admin: admin2.address
            };

            await factory.connect(creator1).createWrappedToken(config1);
            await factory.connect(creator2).createWrappedToken(config2);

            const allTokens = await factory.getAllWrappedTokens();
            expect(allTokens.length).to.equal(2);
            expect(allTokens[0]).to.equal(await factory.getWrappedTokenAddress(0));
            expect(allTokens[1]).to.equal(await factory.getWrappedTokenAddress(1));
        });

        it("Should return empty array for creator with no tokens", async function () {
            const { factory, creator1 } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const creatorTokens = await factory.getWrappedTokenIdsByCreator(creator1.address);
            expect(creatorTokens.length).to.equal(0);
        });

        it("Should return empty array when no tokens exist", async function () {
            const { factory } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const allTokens = await factory.getAllWrappedTokens();
            expect(allTokens.length).to.equal(0);
        });
    });

    describe("Role Management Integration", function () {
        it("Should properly set up roles for the wrapped token", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1, 
                maturityDate1 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config = {
                name: "Test Wrapped Token",
                symbol: "TWT",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            await factory.connect(creator1).createWrappedToken(config);
            const wrappedTokenAddress = await factory.getWrappedTokenAddress(0);
            const wrappedToken = await ethers.getContractAt("WRAPEDTOKEN", wrappedTokenAddress);
            
            const DEFAULT_ADMIN_ROLE = await wrappedToken.DEFAULT_ADMIN_ROLE();
            const PAYOUT_ADMIN_ROLE = await wrappedToken.PAYOUT_ADMIN_ROLE();
            
            // Admin should have DEFAULT_ADMIN_ROLE
            expect(await wrappedToken.hasRole(DEFAULT_ADMIN_ROLE, admin1.address)).to.be.true;
            
            // Admin should be able to grant PAYOUT_ADMIN_ROLE
            await wrappedToken.connect(admin1).grantRole(PAYOUT_ADMIN_ROLE, creator1.address);
            expect(await wrappedToken.hasRole(PAYOUT_ADMIN_ROLE, creator1.address)).to.be.true;
        });

        it("Should allow admin to manage emergency unlock", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1, 
                maturityDate1 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config = {
                name: "Test Wrapped Token",
                symbol: "TWT",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            await factory.connect(creator1).createWrappedToken(config);
            const wrappedTokenAddress = await factory.getWrappedTokenAddress(0);
            const wrappedToken = await ethers.getContractAt("WRAPEDTOKEN", wrappedTokenAddress);
            
            // Admin should be able to enable emergency unlock
            await expect(wrappedToken.connect(admin1).enableEmergencyUnlock(1000))
                .to.emit(wrappedToken, "EmergencyUnlockEnabled")
                .withArgs(1000);
            
            expect(await wrappedToken.emergencyUnlockEnabled()).to.be.true;
            expect(await wrappedToken.emergencyUnlockPenalty()).to.equal(1000);
        });
    });

    describe("Storage and Tracking", function () {
        it("Should correctly track creators and their tokens", async function () {
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
                maturityDate2 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            // Create tokens by different creators
            const config1 = {
                name: "Creator1 Token 1",
                symbol: "C1T1",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            const config2 = {
                name: "Creator2 Token 1",
                symbol: "C2T1",
                peggedToken: await peggedToken2.getAddress(),
                payoutToken: await payoutToken2.getAddress(),
                maturityDate: maturityDate2,
                payoutRate: 1000,
                offeringContract: offeringContract2.address,
                admin: admin2.address
            };

            const config3 = {
                name: "Creator1 Token 2",
                symbol: "C1T2",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 750,
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            await factory.connect(creator1).createWrappedToken(config1); // ID 0
            await factory.connect(creator2).createWrappedToken(config2); // ID 1
            await factory.connect(creator1).createWrappedToken(config3); // ID 2

            // Verify storage mappings
            expect(await factory.wrappedTokens(0)).to.equal(await factory.getWrappedTokenAddress(0));
            expect(await factory.wrappedTokens(1)).to.equal(await factory.getWrappedTokenAddress(1));
            expect(await factory.wrappedTokens(2)).to.equal(await factory.getWrappedTokenAddress(2));

            // Verify creator mappings
            expect(await factory.creators(await factory.getWrappedTokenAddress(0))).to.equal(creator1.address);
            expect(await factory.creators(await factory.getWrappedTokenAddress(1))).to.equal(creator2.address);
            expect(await factory.creators(await factory.getWrappedTokenAddress(2))).to.equal(creator1.address);

            // Verify byCreator mappings
            const creator1Tokens = await factory.getWrappedTokenIdsByCreator(creator1.address);
            const creator2Tokens = await factory.getWrappedTokenIdsByCreator(creator2.address);

            expect(creator1Tokens).to.deep.equal([0, 2]);
            expect(creator2Tokens).to.deep.equal([1]);
        });

        it("Should handle large number of tokens correctly", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1, 
                maturityDate1 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const numTokens = 10;
            
            for (let i = 0; i < numTokens; i++) {
                const config = {
                    name: `Token ${i}`,
                    symbol: `T${i}`,
                    peggedToken: await peggedToken1.getAddress(),
                    payoutToken: await payoutToken1.getAddress(),
                    maturityDate: maturityDate1,
                    payoutRate: 500 + i * 100,
                    offeringContract: offeringContract1.address,
                    admin: admin1.address
                };
                
                await factory.connect(creator1).createWrappedToken(config);
            }

            expect(await factory.count()).to.equal(numTokens);
            
            const allTokens = await factory.getAllWrappedTokens();
            expect(allTokens.length).to.equal(numTokens);
            
            const creator1Tokens = await factory.getWrappedTokenIdsByCreator(creator1.address);
            expect(creator1Tokens.length).to.equal(numTokens);
            
            // Verify each token has correct configuration
            for (let i = 0; i < numTokens; i++) {
                const tokenAddress = await factory.getWrappedTokenAddress(i);
                const wrappedToken = await ethers.getContractAt("WRAPEDTOKEN", tokenAddress);
                expect(await wrappedToken.name()).to.equal(`Token ${i}`);
                expect(await wrappedToken.symbol()).to.equal(`T${i}`);
                expect(await wrappedToken.payoutRate()).to.equal(500 + i * 100);
            }
        });
    });

    describe("Integration with WrappedToken Functionality", function () {
        it("Should create functional wrapped token that can register investments", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1, 
                maturityDate1 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config = {
                name: "Functional Token",
                symbol: "FUNC",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            await factory.connect(creator1).createWrappedToken(config);
            const wrappedTokenAddress = await factory.getWrappedTokenAddress(0);
            const wrappedToken = await ethers.getContractAt("WRAPEDTOKEN", wrappedTokenAddress);
            
            // Test investment registration
            const investmentAmount = ethers.parseUnits("1000", 18);
            await peggedToken1.mint(offeringContract1.address, investmentAmount);
            await peggedToken1.connect(offeringContract1).approve(wrappedTokenAddress, investmentAmount);
            
            await wrappedToken.connect(offeringContract1).registerInvestment(
                creator1.address, 
                investmentAmount, 
                0 // Daily frequency
            );
            
            expect(await wrappedToken.balanceOf(creator1.address)).to.equal(investmentAmount);
            expect(await peggedToken1.balanceOf(wrappedTokenAddress)).to.equal(investmentAmount);
        });

        it("Should create wrapped token that supports payout functionality", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1, 
                maturityDate1 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config = {
                name: "Payout Token",
                symbol: "PAYOUT",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 1000, // 10%
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            await factory.connect(creator1).createWrappedToken(config);
            const wrappedTokenAddress = await factory.getWrappedTokenAddress(0);
            const wrappedToken = await ethers.getContractAt("WRAPEDTOKEN", wrappedTokenAddress);
            
            // Set up investment
            const investmentAmount = ethers.parseUnits("1000", 18);
            await peggedToken1.mint(offeringContract1.address, investmentAmount);
            await peggedToken1.connect(offeringContract1).approve(wrappedTokenAddress, investmentAmount);
            await wrappedToken.connect(offeringContract1).registerInvestment(
                creator1.address, 
                investmentAmount, 
                0
            );
            
            // Grant payout admin role and add payout funds
            const PAYOUT_ADMIN_ROLE = await wrappedToken.PAYOUT_ADMIN_ROLE();
            await wrappedToken.connect(admin1).grantRole(PAYOUT_ADMIN_ROLE, admin1.address);
            
            const payoutAmount = ethers.parseUnits("500", 18);
            await payoutToken1.mint(admin1.address, payoutAmount);
            await payoutToken1.connect(admin1).approve(wrappedTokenAddress, payoutAmount);
            
            await expect(wrappedToken.connect(admin1).addPayoutFunds(payoutAmount))
                .to.emit(wrappedToken, "PayoutFundsAdded")
                .withArgs(payoutAmount, payoutAmount);
            
            // User should be able to claim payout
            await expect(wrappedToken.connect(creator1).claimTotalPayout())
                .to.emit(wrappedToken, "PayoutClaimed");
            
            expect(await payoutToken1.balanceOf(creator1.address)).to.equal(payoutAmount);
        });

        it("Should create wrapped token that supports emergency unlock", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1, 
                maturityDate1 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config = {
                name: "Emergency Token",
                symbol: "EMRG",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            await factory.connect(creator1).createWrappedToken(config);
            const wrappedTokenAddress = await factory.getWrappedTokenAddress(0);
            const wrappedToken = await ethers.getContractAt("WRAPEDTOKEN", wrappedTokenAddress);
            
            // Set up investment
            const investmentAmount = ethers.parseUnits("1000", 18);
            await peggedToken1.mint(offeringContract1.address, investmentAmount);
            await peggedToken1.connect(offeringContract1).approve(wrappedTokenAddress, investmentAmount);
            await wrappedToken.connect(offeringContract1).registerInvestment(
                creator1.address, 
                investmentAmount, 
                0
            );
            
            // Enable emergency unlock
            await wrappedToken.connect(admin1).enableEmergencyUnlock(1000); // 10% penalty
            
            const expectedReturn = investmentAmount * 90n / 100n; // 90% after penalty
            
            await expect(wrappedToken.connect(creator1).emergencyUnlock())
                .to.emit(wrappedToken, "EmergencyUnlockUsed")
                .withArgs(creator1.address, expectedReturn, investmentAmount - expectedReturn);
            
            expect(await peggedToken1.balanceOf(creator1.address)).to.equal(expectedReturn);
            expect(await wrappedToken.balanceOf(creator1.address)).to.equal(0);
            
            // User record should be deleted
            const investor = await wrappedToken.investors(creator1.address);
            expect(investor.deposited).to.equal(0);
        });
    });

    describe("Edge Cases and Error Handling", function () {
        it("Should handle zero payout rate", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1, 
                maturityDate1 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config = {
                name: "Zero Payout Token",
                symbol: "ZERO",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 0, // 0% payout rate
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            await factory.connect(creator1).createWrappedToken(config);
            const wrappedTokenAddress = await factory.getWrappedTokenAddress(0);
            const wrappedToken = await ethers.getContractAt("WRAPEDTOKEN", wrappedTokenAddress);
            
            expect(await wrappedToken.payoutRate()).to.equal(0);
        });

        it("Should handle very high payout rate", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1, 
                maturityDate1 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config = {
                name: "High Payout Token",
                symbol: "HIGH",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 9999, // 99.99% payout rate
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            await factory.connect(creator1).createWrappedToken(config);
            const wrappedTokenAddress = await factory.getWrappedTokenAddress(0);
            const wrappedToken = await ethers.getContractAt("WRAPEDTOKEN", wrappedTokenAddress);
            
            expect(await wrappedToken.payoutRate()).to.equal(9999);
        });

        it("Should handle same pegged and payout token", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                maturityDate1 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const config = {
                name: "Same Token",
                symbol: "SAME",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await peggedToken1.getAddress(), // Same as pegged token
                maturityDate: maturityDate1,
                payoutRate: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            await factory.connect(creator1).createWrappedToken(config);
            const wrappedTokenAddress = await factory.getWrappedTokenAddress(0);
            const wrappedToken = await ethers.getContractAt("WRAPEDTOKEN", wrappedTokenAddress);
            
            expect(await wrappedToken.peggedToken()).to.equal(await peggedToken1.getAddress());
            expect(await wrappedToken.payoutToken()).to.equal(await peggedToken1.getAddress());
        });

        it("Should handle maturity date in the past", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            const pastDate = (await time.latest()) - 86400; // 1 day ago
            
            const config = {
                name: "Past Maturity Token",
                symbol: "PAST",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: pastDate,
                payoutRate: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            // Should still deploy successfully (validation might be in offering contract)
            await factory.connect(creator1).createWrappedToken(config);
            const wrappedTokenAddress = await factory.getWrappedTokenAddress(0);
            const wrappedToken = await ethers.getContractAt("WRAPEDTOKEN", wrappedTokenAddress);
            
            expect(await wrappedToken.maturityDate()).to.equal(pastDate);
        });
    });

    describe("Factory State Management", function () {
        it("Should maintain correct count across multiple deployments", async function () {
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
                maturityDate2 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            expect(await factory.count()).to.equal(0);
            
            // Create first token
            const config1 = {
                name: "Token 1",
                symbol: "T1",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };
            
            await factory.connect(creator1).createWrappedToken(config1);
            expect(await factory.count()).to.equal(1);
            
            // Create second token
            const config2 = {
                name: "Token 2",
                symbol: "T2",
                peggedToken: await peggedToken2.getAddress(),
                payoutToken: await payoutToken2.getAddress(),
                maturityDate: maturityDate2,
                payoutRate: 1000,
                offeringContract: offeringContract2.address,
                admin: admin2.address
            };
            
            await factory.connect(creator2).createWrappedToken(config2);
            expect(await factory.count()).to.equal(2);
        });

        it("Should maintain independent state for each wrapped token", async function () {
            const { 
                factory, 
                creator1, 
                admin1, 
                offeringContract1, 
                peggedToken1, 
                payoutToken1, 
                maturityDate1 
            } = await loadFixture(deployWrappedTokenFactoryFixture);
            
            // Create two tokens with different configurations
            const config1 = {
                name: "Token A",
                symbol: "TA",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1,
                payoutRate: 500,
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            const config2 = {
                name: "Token B",
                symbol: "TB",
                peggedToken: await peggedToken1.getAddress(),
                payoutToken: await payoutToken1.getAddress(),
                maturityDate: maturityDate1 + 86400, // Different maturity
                payoutRate: 1000, // Different payout rate
                offeringContract: offeringContract1.address,
                admin: admin1.address
            };

            await factory.connect(creator1).createWrappedToken(config1);
            await factory.connect(creator1).createWrappedToken(config2);
            
            const token1Address = await factory.getWrappedTokenAddress(0);
            const token2Address = await factory.getWrappedTokenAddress(1);
            
            const token1 = await ethers.getContractAt("WRAPEDTOKEN", token1Address);
            const token2 = await ethers.getContractAt("WRAPEDTOKEN", token2Address);
            
            // Verify independent configurations
            expect(await token1.name()).to.equal("Token A");
            expect(await token1.symbol()).to.equal("TA");
            expect(await token1.payoutRate()).to.equal(500);
            expect(await token1.maturityDate()).to.equal(maturityDate1);
            
            expect(await token2.name()).to.equal("Token B");
            expect(await token2.symbol()).to.equal("TB");
            expect(await token2.payoutRate()).to.equal(1000);
            expect(await token2.maturityDate()).to.equal(maturityDate1 + 86400);
        });
    });
});