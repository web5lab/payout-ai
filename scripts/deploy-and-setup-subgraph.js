// scripts/deploy-and-setup-subgraph.js

const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
  console.log("🚀 Deploying contracts and setting up subgraph...");
  
  // Deploy contracts using Hardhat Ignition
  console.log("📦 Deploying contracts...");
  const { spawn } = require('child_process');
  
  const deployProcess = spawn('npx', ['hardhat', 'ignition', 'deploy', 'ignition/modules/FullDeploymentModule.js', '--network', 'localhost'], {
    stdio: 'inherit'
  });
  
  await new Promise((resolve, reject) => {
    deployProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Deployment failed with code ${code}`));
      }
    });
  });
  
  console.log("✅ Contracts deployed successfully!");
  
  // Read deployment addresses from Hardhat Ignition
  const deploymentPath = path.join(__dirname, '../ignition/deployments/chain-31337/deployed_addresses.json');
  
  if (fs.existsSync(deploymentPath)) {
    const deployedAddresses = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    
    console.log("📋 Deployed Contract Addresses:");
    console.log(JSON.stringify(deployedAddresses, null, 2));
    
    // Update subgraph.local.yaml with actual addresses
    const subgraphPath = path.join(__dirname, '../subgraph/subgraph.local.yaml');
    let subgraphContent = fs.readFileSync(subgraphPath, 'utf8');
    
    // Replace placeholder addresses with actual deployed addresses
    if (deployedAddresses['FullDeploymentModule#InvestmentManager']) {
      subgraphContent = subgraphContent.replace(
        '0x5FbDB2315678afecb367f032d93F642f64180aa3',
        deployedAddresses['FullDeploymentModule#InvestmentManager']
      );
    }
    
    if (deployedAddresses['FullDeploymentModule#OfferingFactory']) {
      subgraphContent = subgraphContent.replace(
        '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
        deployedAddresses['FullDeploymentModule#OfferingFactory']
      );
    }
    
    if (deployedAddresses['FullDeploymentModule#WrappedTokenFactory']) {
      subgraphContent = subgraphContent.replace(
        '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
        deployedAddresses['FullDeploymentModule#WrappedTokenFactory']
      );
    }
    
    fs.writeFileSync(subgraphPath, subgraphContent);
    console.log("✅ Updated subgraph.local.yaml with deployed addresses");
    
    console.log("\n🎯 Next Steps:");
    console.log("1. Start Graph Node: docker-compose up -d");
    console.log("2. Create subgraph: cd subgraph && npm run create-local-hardhat");
    console.log("3. Deploy subgraph: npm run deploy-local-hardhat");
    console.log("4. Query at: http://localhost:8000/subgraphs/name/offering-payout-local");
    
  } else {
    console.log("❌ Could not find deployment addresses file");
    console.log("📍 Manual addresses needed for subgraph.local.yaml");
  }
}

main().catch((error) => {
  console.error("💥 Setup failed:", error);
  process.exitCode = 1;
});