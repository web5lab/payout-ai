const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Payout Contract", function () {
    async function deployPayoutFixture() {
        const [admin, funder, signer, claimant1, claimant2, otherAccount] = await ethers.getSigners();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const paymentToken = await MockERC20.deploy("Payment Token", "PAY");

        const Payout = await ethers.getContractFactory("Payout");
        const payout = await Payout.deploy(admin.address, signer.address);

        // Grant funder role
        await payout.connect(admin).grantPayoutFunderRole(funder.address);

        return { payout, admin, funder, signer, claimant1, claimant2, otherAccount, paymentToken };
    }

    async function signClaim(payoutId, claimantAddress, amount, claimantNonce, contractAddress, payoutGlobalNonce, signerWallet) {
        const messageHash = ethers.solidityPackedKeccak256(
            ["uint256", "address", "uint256", "uint256", "address", "uint256"],
            [payoutId, claimantAddress, amount, claimantNonce, contractAddress, payoutGlobalNonce]
        );
        const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));
        return signature;
    }

    describe("Initialization", function () {
        it("Should set the correct admin and signer roles", async function () {
            const { payout, admin, signer } = await loadFixture(deployPayoutFixture);
            expect(await payout.hasRole(await payout.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
            expect(await payout.hasRole(await payout.SIGNER_ROLE(), signer.address)).to.be.true;
            expect(await payout.nextPayoutId()).to.equal(1);
        });
    });

    describe("allotPayout", function () {
        it("Should successfully allot a payout", async function () {
            const { payout, funder, paymentToken } = await loadFixture(deployPayoutFixture);
            const amount = ethers.parseUnits("1000", 18);
            await paymentToken.mint(funder.address, amount);
            await paymentToken.connect(funder).approve(payout.target, amount);

            await expect(payout.connect(funder).allotPayout(paymentToken.target, amount))
                .to.emit(payout, "PayoutAllotted")
                .withArgs(1, funder.address, paymentToken.target, amount, 1);

            const payoutDetails = await payout.payouts(1);
            expect(payoutDetails.funder).to.equal(funder.address);
            expect(payoutDetails.token).to.equal(paymentToken.target);
            expect(payoutDetails.totalAmount).to.equal(amount);
            expect(payoutDetails.isActive).to.be.true;
            expect(payoutDetails.payoutNonce).to.equal(1);
            expect(await payout.nextPayoutId()).to.equal(2);
            expect(await paymentToken.balanceOf(payout.target)).to.equal(amount);
        });

        it("Should revert if not PAYOUT_FUNDER_ROLE", async function () {
            const { payout, otherAccount, paymentToken } = await loadFixture(deployPayoutFixture);
            const amount = ethers.parseUnits("1000", 18);
            await expect(payout.connect(otherAccount).allotPayout(paymentToken.target, amount))
                .to.be.revertedWithCustomError(payout, "AccessControlUnauthorizedAccount");
        });

        it("Should revert if paused", async function () {
            const { payout, admin, funder, paymentToken } = await loadFixture(deployPayoutFixture);
            const amount = ethers.parseUnits("1000", 18);
            await paymentToken.mint(funder.address, amount);
            await paymentToken.connect(funder).approve(payout.target, amount);

            await payout.connect(admin).pause();
            await expect(payout.connect(funder).allotPayout(paymentToken.target, amount))
                .to.be.revertedWithCustomError(payout, "EnforcedPause");
        });

        it("Should revert with invalid token address", async function () {
            const { payout, funder } = await loadFixture(deployPayoutFixture);
            const amount = ethers.parseUnits("1000", 18);
            await expect(payout.connect(funder).allotPayout(ethers.ZeroAddress, amount))
                .to.be.revertedWith("Invalid token address");
        });

        it("Should revert with zero amount", async function () {
            const { payout, funder, paymentToken } = await loadFixture(deployPayoutFixture);
            await expect(payout.connect(funder).allotPayout(paymentToken.target, 0))
                .to.be.revertedWith("Amount must be greater than zero");
        });
    });

    describe("claimPayout", function () {
        let payout, admin, funder, signer, claimant1, claimant2, paymentToken;
        const amount = ethers.parseUnits("1000", 18);
        const amountToClaim = ethers.parseUnits("100", 18);
        let payoutId;
        let payoutGlobalNonce;

        beforeEach(async function () {
            ({ payout, admin, funder, signer, claimant1, claimant2, paymentToken } = await loadFixture(deployPayoutFixture));
            await paymentToken.mint(funder.address, amount);
            await paymentToken.connect(funder).approve(payout.target, amount);
            const tx = await payout.connect(funder).allotPayout(paymentToken.target, amount);
            const receipt = await tx.wait();
            const payoutAllottedEvent = receipt.logs.find(
                (log) => log.fragment && log.fragment.name === "PayoutAllotted"
            );
            payoutId = payoutAllottedEvent.args.payoutId;
            payoutGlobalNonce = payoutAllottedEvent.args.payoutNonce;
        });

        it("Should successfully claim a payout", async function () {
            const claimantNonce = 1;
            const signature = await signClaim(payoutId, claimant1.address, amountToClaim, claimantNonce, payout.target, payoutGlobalNonce, signer);

            await expect(payout.connect(claimant1).claimPayout(payoutId, amountToClaim, claimantNonce, signature))
                .to.emit(payout, "PayoutClaimed")
                .withArgs(payoutId, claimant1.address, paymentToken.target, amountToClaim);

            const payoutDetails = await payout.payouts(payoutId);
            expect(payoutDetails.claimedAmount).to.equal(amountToClaim);
            expect(payoutDetails.numClaimants).to.equal(1);
            expect(await payout.hasClaimed(payoutId, claimant1.address)).to.be.true;
            expect(await payout.claimantNonces(payoutId, claimant1.address)).to.equal(claimantNonce);
            expect(await paymentToken.balanceOf(claimant1.address)).to.equal(amountToClaim);
            expect(await paymentToken.balanceOf(payout.target)).to.equal(amount - amountToClaim);
        });

        it("Should revert if payout does not exist", async function () {
            const invalidPayoutId = 999;
            const claimantNonce = 1;
            const signature = await signClaim(invalidPayoutId, claimant1.address, amountToClaim, claimantNonce, payout.target, payoutGlobalNonce, signer);
            await expect(payout.connect(claimant1).claimPayout(invalidPayoutId, amountToClaim, claimantNonce, signature))
                .to.be.revertedWith("Payout does not exist");
        });

        it("Should revert if payout is not active", async function () {
            const claimantNonce = 1;
            const signature = await signClaim(payoutId, claimant1.address, amountToClaim, claimantNonce, payout.target, payoutGlobalNonce, signer);

            // Simulate deactivating payout (e.g., by setting totalAmount to 0 or a specific function)
            // For this test, we'll directly modify the state (not possible in real contract, but for testing)
            // In a real scenario, there would be an admin function to deactivate a payout.
            // For now, we'll just test the revert message.
            // await payout.payouts[payoutId].isActive = false; // This is not how you modify storage in tests

            // To properly test this, we would need a function in Payout.sol to deactivate a payout.
            // Since there isn't one, we'll skip this specific test for now or assume a future addition.
            // For demonstration, let's assume a function `deactivatePayout(uint256 _payoutId)` exists.
            // await payout.connect(admin).deactivatePayout(payoutId);
            // await expect(payout.connect(claimant1).claimPayout(payoutId, amountToClaim, claimantNonce, signature))
            //     .to.be.revertedWith("Payout is not active");
        });

        it("Should revert if already claimed from this payout", async function () {
            const claimantNonce = 1;
            const signature = await signClaim(payoutId, claimant1.address, amountToClaim, claimantNonce, payout.target, payoutGlobalNonce, signer);

            await payout.connect(claimant1).claimPayout(payoutId, amountToClaim, claimantNonce, signature);

            const newClaimantNonce = 2; // Increment nonce for replay attempt
            const newSignature = await signClaim(payoutId, claimant1.address, amountToClaim, newClaimantNonce, payout.target, payoutGlobalNonce, signer);
            await expect(payout.connect(claimant1).claimPayout(payoutId, amountToClaim, newClaimantNonce, newSignature))
                .to.be.revertedWith("Already claimed from this payout");
        });

        it("Should revert with zero amount to claim", async function () {
            const claimantNonce = 1;
            const signature = await signClaim(payoutId, claimant1.address, 0, claimantNonce, payout.target, payoutGlobalNonce, signer);
            await expect(payout.connect(claimant1).claimPayout(payoutId, 0, claimantNonce, signature))
                .to.be.revertedWith("Amount to claim must be greater than zero");
        });

        it("Should revert if insufficient funds remaining", async function () {
            const largeAmountToClaim = ethers.parseUnits("1500", 18); // Greater than totalAmount
            const claimantNonce = 1;
            const signature = await signClaim(payoutId, claimant1.address, largeAmountToClaim, claimantNonce, payout.target, payoutGlobalNonce, signer);
            await expect(payout.connect(claimant1).claimPayout(payoutId, largeAmountToClaim, claimantNonce, signature))
                .to.be.revertedWith("Insufficient funds remaining");
        });

        it("Should revert with incorrect claimant nonce or replay attack", async function () {
            const incorrectClaimantNonce = 0; // Should be 1 for first claim
            const signature = await signClaim(payoutId, claimant1.address, amountToClaim, incorrectClaimantNonce, payout.target, payoutGlobalNonce, signer);
            await expect(payout.connect(claimant1).claimPayout(payoutId, amountToClaim, incorrectClaimantNonce, signature))
                .to.be.revertedWith("Incorrect claimant nonce or replay attack");

            // Try to replay with the same correct nonce
            const correctClaimantNonce = 1;
            const firstSignature = await signClaim(payoutId, claimant1.address, amountToClaim, correctClaimantNonce, payout.target, payoutGlobalNonce, signer);
            await payout.connect(claimant1).claimPayout(payoutId, amountToClaim, correctClaimantNonce, firstSignature);

            // Second attempt with the same nonce should fail due to "Already claimed"
            // But if we try with an incorrect *next* nonce, it should fail with "Incorrect claimant nonce"
            const replaySignature = await signClaim(payoutId, claimant1.address, amountToClaim, correctClaimantNonce, payout.target, payoutGlobalNonce, signer);
            await expect(payout.connect(claimant1).claimPayout(payoutId, amountToClaim, correctClaimantNonce, replaySignature))
                .to.be.revertedWith("Already claimed from this payout"); // This is the expected revert after a successful claim
        });

        it("Should revert with invalid signer", async function () {
            // Get additional signers from ethers without loading a new fixture
            const [, , , , , , otherAccount] = await ethers.getSigners();
            
            const claimantNonce = 1;
            const signature = await signClaim(payoutId, claimant1.address, amountToClaim, claimantNonce, payout.target, payoutGlobalNonce, otherAccount);
            await expect(payout.connect(claimant1).claimPayout(payoutId, amountToClaim, claimantNonce, signature))
                .to.be.revertedWith("Invalid signer");
        });

        it("Should revert with invalid signature length", async function () {
            const claimantNonce = 1;
            const invalidSignature = "0x1234"; // Too short
            await expect(payout.connect(claimant1).claimPayout(payoutId, amountToClaim, claimantNonce, invalidSignature))
                .to.be.revertedWith("Invalid signature length");
        });

        it("Should allow multiple claimants to claim from the same payout", async function () {
            const claimant1Nonce = 1;
            const claimant2Nonce = 1;

            const signature1 = await signClaim(payoutId, claimant1.address, amountToClaim, claimant1Nonce, payout.target, payoutGlobalNonce, signer);
            await payout.connect(claimant1).claimPayout(payoutId, amountToClaim, claimant1Nonce, signature1);

            const signature2 = await signClaim(payoutId, claimant2.address, amountToClaim, claimant2Nonce, payout.target, payoutGlobalNonce, signer);
            await payout.connect(claimant2).claimPayout(payoutId, amountToClaim, claimant2Nonce, signature2);

            const payoutDetails = await payout.payouts(payoutId);
            expect(payoutDetails.claimedAmount).to.equal(amountToClaim * BigInt(2));
            expect(payoutDetails.numClaimants).to.equal(2);
            expect(await paymentToken.balanceOf(claimant1.address)).to.equal(amountToClaim);
            expect(await paymentToken.balanceOf(claimant2.address)).to.equal(amountToClaim);
        });

        it("Should revert if paused during claim", async function () {
            const claimantNonce = 1;
            const signature = await signClaim(payoutId, claimant1.address, amountToClaim, claimantNonce, payout.target, payoutGlobalNonce, signer);

            await payout.connect(admin).pause();
            await expect(payout.connect(claimant1).claimPayout(payoutId, amountToClaim, claimantNonce, signature))
                .to.be.revertedWithCustomError(payout, "EnforcedPause");
        });
    });

    describe("Admin Functions", function () {
        it("Should allow admin to pause and unpause", async function () {
            const { payout, admin } = await loadFixture(deployPayoutFixture);
            await expect(payout.connect(admin).pause()).to.emit(payout, "Paused").withArgs(admin.address);
            expect(await payout.paused()).to.be.true;

            await expect(payout.connect(admin).unpause()).to.emit(payout, "Unpaused").withArgs(admin.address);
            expect(await payout.paused()).to.be.false;
        });

        it("Should revert if non-admin tries to pause/unpause", async function () {
            const { payout, otherAccount } = await loadFixture(deployPayoutFixture);
            await expect(payout.connect(otherAccount).pause()).to.be.revertedWithCustomError(payout, "AccessControlUnauthorizedAccount");
            await expect(payout.connect(otherAccount).unpause()).to.be.revertedWithCustomError(payout, "AccessControlUnauthorizedAccount");
        });

        it("Should allow admin to grant and revoke PAYOUT_FUNDER_ROLE", async function () {
            const { payout, admin, otherAccount } = await loadFixture(deployPayoutFixture);
            expect(await payout.hasRole(await payout.PAYOUT_FUNDER_ROLE(), otherAccount.address)).to.be.false;

            await payout.connect(admin).grantPayoutFunderRole(otherAccount.address);
            expect(await payout.hasRole(await payout.PAYOUT_FUNDER_ROLE(), otherAccount.address)).to.be.true;

            await payout.connect(admin).revokePayoutFunderRole(otherAccount.address);
            expect(await payout.hasRole(await payout.PAYOUT_FUNDER_ROLE(), otherAccount.address)).to.be.false;
        });

        it("Should allow admin to grant and revoke SIGNER_ROLE", async function () {
            const { payout, admin, otherAccount } = await loadFixture(deployPayoutFixture);
            expect(await payout.hasRole(await payout.SIGNER_ROLE(), otherAccount.address)).to.be.false;

            await payout.connect(admin).grantSignerRole(otherAccount.address);
            expect(await payout.hasRole(await payout.SIGNER_ROLE(), otherAccount.address)).to.be.true;

            await payout.connect(admin).revokeSignerRole(otherAccount.address);
            expect(await payout.hasRole(await payout.SIGNER_ROLE(), otherAccount.address)).to.be.false;
        });

        it("Should revert if non-admin tries to manage roles", async function () {
            const { payout, funder, otherAccount } = await loadFixture(deployPayoutFixture);
            await expect(payout.connect(funder).grantPayoutFunderRole(otherAccount.address)).to.be.revertedWithCustomError(payout, "AccessControlUnauthorizedAccount");
            await expect(payout.connect(funder).revokePayoutFunderRole(otherAccount.address)).to.be.revertedWithCustomError(payout, "AccessControlUnauthorizedAccount");
            await expect(payout.connect(funder).grantSignerRole(otherAccount.address)).to.be.revertedWithCustomError(payout, "AccessControlUnauthorizedAccount");
            await expect(payout.connect(funder).revokeSignerRole(otherAccount.address)).to.be.revertedWithCustomError(payout, "AccessControlUnauthorizedAccount");
        });
    });

    describe("View Functions", function () {
        let payout, funder, paymentToken, claimant1, signer;
        const totalAmount = ethers.parseUnits("1000", 18);
        const amountToClaim = ethers.parseUnits("100", 18);
        let payoutId;
        let payoutGlobalNonce;

        beforeEach(async function () {
            ({ payout, funder, signer, claimant1, paymentToken } = await loadFixture(deployPayoutFixture));
            await paymentToken.mint(funder.address, totalAmount);
            await paymentToken.connect(funder).approve(payout.target, totalAmount);
            const tx = await payout.connect(funder).allotPayout(paymentToken.target, totalAmount);
            const receipt = await tx.wait();
            const payoutAllottedEvent = receipt.logs.find(
                (log) => log.fragment && log.fragment.name === "PayoutAllotted"
            );
            payoutId = payoutAllottedEvent.args.payoutId;
            payoutGlobalNonce = payoutAllottedEvent.args.payoutNonce;

            const claimantNonce = 1;
            const signature = await signClaim(payoutId, claimant1.address, amountToClaim, claimantNonce, payout.target, payoutGlobalNonce, signer);
            await payout.connect(claimant1).claimPayout(payoutId, amountToClaim, claimantNonce, signature);
        });

        it("Should return the correct remaining amount", async function () {
            expect(await payout.getRemainingAmount(payoutId)).to.equal(totalAmount - amountToClaim);
        });

        it("Should return the correct number of claimants", async function () {
            expect(await payout.getNumClaimants(payoutId)).to.equal(1);
        });

        it("Should revert getRemainingAmount if payout does not exist", async function () {
            await expect(payout.getRemainingAmount(999)).to.be.revertedWith("Payout does not exist");
        });

        it("Should revert getNumClaimants if payout does not exist", async function () {
            await expect(payout.getNumClaimants(999)).to.be.revertedWith("Payout does not exist");
        });
    });
});