// scripts/backend-signature-example.js
// Example of how to generate KYB signatures in a backend service

const { ethers } = require("ethers");

/**
 * Backend KYB Signature Generator
 * This would typically run in your backend service
 */
class KYBSignatureGenerator {
  constructor(privateKey, chainId, contractAddress) {
    this.signer = new ethers.Wallet(privateKey);
    this.chainId = chainId;
    this.contractAddress = contractAddress;
  }

  /**
   * Generate KYB validation signature for a wallet
   * @param {string} walletAddress - Address to validate
   * @param {number} validityDuration - How long signature is valid (seconds)
   * @returns {Object} Signature data
   */
  async generateKYBSignature(walletAddress, validityDuration = 3600) {
    const nonce = Date.now(); // Use timestamp as nonce
    const expiry = Math.floor(Date.now() / 1000) + validityDuration;

    // Create message hash (must match contract implementation)
    const messageHash = ethers.solidityPackedKeccak256(
      ["string", "address", "uint256", "uint256", "uint256", "address"],
      ["KYB_VALIDATION", walletAddress, nonce, expiry, this.chainId, this.contractAddress]
    );

    // Sign the message
    const signature = await this.signer.signMessage(ethers.getBytes(messageHash));

    return {
      walletAddress,
      nonce,
      expiry,
      signature,
      messageHash,
      validUntil: new Date(expiry * 1000).toISOString()
    };
  }

  /**
   * Batch generate signatures for multiple wallets
   * @param {string[]} walletAddresses - Array of wallet addresses
   * @param {number} validityDuration - Signature validity duration
   * @returns {Object[]} Array of signature data
   */
  async batchGenerateSignatures(walletAddresses, validityDuration = 3600) {
    const signatures = [];
    
    for (const wallet of walletAddresses) {
      const sigData = await this.generateKYBSignature(wallet, validityDuration);
      signatures.push(sigData);
    }
    
    return signatures;
  }

  /**
   * Verify a signature (for testing/validation)
   * @param {Object} signatureData - Signature data object
   * @returns {boolean} Whether signature is valid
   */
  async verifySignature(signatureData) {
    const { walletAddress, nonce, expiry, signature } = signatureData;
    
    // Check expiry
    if (Date.now() / 1000 > expiry) {
      return false;
    }

    // Recreate message hash
    const messageHash = ethers.solidityPackedKeccak256(
      ["string", "address", "uint256", "uint256", "uint256", "address"],
      ["KYB_VALIDATION", walletAddress, nonce, expiry, this.chainId, this.contractAddress]
    );

    // Verify signature
    const ethSignedMessageHash = ethers.hashMessage(ethers.getBytes(messageHash));
    const recoveredAddress = ethers.recoverAddress(ethSignedMessageHash, signature);
    
    return recoveredAddress === this.signer.address;
  }
}

/**
 * Example usage and testing
 */
async function demonstrateBackendUsage() {
  console.log("🔐 Backend KYB Signature Generator Demo");
  console.log("=".repeat(50));

  // Example configuration (replace with your actual values)
  const KYB_VALIDATOR_PRIVATE_KEY = "0x" + "1".repeat(64); // Example private key
  const CHAIN_ID = 31337; // Hardhat local network
  const INVESTMENT_MANAGER_ADDRESS = "0x1234567890123456789012345678901234567890"; // Example address

  // Initialize generator
  const generator = new KYBSignatureGenerator(
    KYB_VALIDATOR_PRIVATE_KEY,
    CHAIN_ID,
    INVESTMENT_MANAGER_ADDRESS
  );

  console.log(`KYB Validator Address: ${generator.signer.address}`);
  console.log(`Chain ID: ${CHAIN_ID}`);
  console.log(`Contract Address: ${INVESTMENT_MANAGER_ADDRESS}`);

  // Example wallet addresses to validate
  const walletAddresses = [
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906"
  ];

  console.log("\n📝 Generating signatures for wallets...");
  
  // Generate signatures for each wallet
  for (let i = 0; i < walletAddresses.length; i++) {
    const wallet = walletAddresses[i];
    console.log(`\n👤 Wallet ${i + 1}: ${wallet}`);
    
    const sigData = await generator.generateKYBSignature(wallet, 3600); // 1 hour validity
    
    console.log(`   📊 Nonce: ${sigData.nonce}`);
    console.log(`   ⏰ Expires: ${sigData.validUntil}`);
    console.log(`   ✍️  Signature: ${sigData.signature.substring(0, 20)}...`);
    
    // Verify the signature
    const isValid = await generator.verifySignature(sigData);
    console.log(`   ✅ Signature valid: ${isValid}`);
  }

  // Batch generation example
  console.log("\n📦 Batch generating signatures...");
  const batchSignatures = await generator.batchGenerateSignatures(walletAddresses, 7200); // 2 hours validity
  
  console.log(`✅ Generated ${batchSignatures.length} signatures in batch`);
  console.log("📊 Batch results:");
  batchSignatures.forEach((sig, index) => {
    console.log(`   ${index + 1}. ${sig.walletAddress} - Valid until: ${sig.validUntil}`);
  });

  console.log("\n🎯 Backend integration ready!");
  
  return {
    generator,
    signatures: batchSignatures
  };
}

/**
 * API endpoint example (Express.js style)
 */
function createAPIEndpoints() {
  console.log("\n🌐 Example API Endpoints:");
  console.log(`
// Express.js API endpoint example
app.post('/api/kyb/generate-signature', async (req, res) => {
  try {
    const { walletAddress, validityHours = 1 } = req.body;
    
    // Validate wallet address format
    if (!ethers.isAddress(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    // Check if wallet passed KYB verification in your system
    const isKYBVerified = await checkKYBStatus(walletAddress);
    if (!isKYBVerified) {
      return res.status(403).json({ error: 'Wallet not KYB verified' });
    }
    
    // Generate signature
    const generator = new KYBSignatureGenerator(
      process.env.KYB_VALIDATOR_PRIVATE_KEY,
      process.env.CHAIN_ID,
      process.env.INVESTMENT_MANAGER_ADDRESS
    );
    
    const signatureData = await generator.generateKYBSignature(
      walletAddress, 
      validityHours * 3600
    );
    
    res.json({
      success: true,
      data: {
        walletAddress: signatureData.walletAddress,
        nonce: signatureData.nonce,
        expiry: signatureData.expiry,
        signature: signatureData.signature,
        validUntil: signatureData.validUntil
      }
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate signature' });
  }
});

// Batch signature generation endpoint
app.post('/api/kyb/batch-generate', async (req, res) => {
  try {
    const { walletAddresses, validityHours = 1 } = req.body;
    
    const generator = new KYBSignatureGenerator(
      process.env.KYB_VALIDATOR_PRIVATE_KEY,
      process.env.CHAIN_ID,
      process.env.INVESTMENT_MANAGER_ADDRESS
    );
    
    const signatures = await generator.batchGenerateSignatures(
      walletAddresses,
      validityHours * 3600
    );
    
    res.json({
      success: true,
      count: signatures.length,
      signatures
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate batch signatures' });
  }
});
  `);
}

// Run the demonstration
if (require.main === module) {
  demonstrateBackendUsage()
    .then(() => {
      createAPIEndpoints();
      console.log("\n✨ Backend KYB signature system demonstration complete!");
    })
    .catch(console.error);
}

module.exports = {
  KYBSignatureGenerator,
  demonstrateBackendUsage
};