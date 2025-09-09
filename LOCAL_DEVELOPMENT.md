# 🚀 Local Development Setup Guide

This guide will help you set up a complete local development environment with Hardhat and The Graph for testing the offering and payout system.

## 📋 Prerequisites

- Node.js (v16 or higher)
- Docker and Docker Compose
- Git

## 🏗️ Setup Steps

### 1. Start Hardhat Local Network

First, start your local Hardhat blockchain:

```bash
# Terminal 1 - Keep this running
npx hardhat node
```

This will:
- Start a local blockchain at `http://127.0.0.1:8545`
- Create 20 test accounts with 10,000 ETH each
- Show account addresses and private keys

### 2. Start Local Graph Node Infrastructure

Start the Graph Node, IPFS, and PostgreSQL using Docker:

```bash
# Terminal 2 - Keep this running
docker-compose up -d
```

This will start:
- **Graph Node**: `http://localhost:8000` (GraphQL endpoint)
- **IPFS**: `http://localhost:5001` (API), `http://localhost:8080` (Gateway)
- **PostgreSQL**: `localhost:5432` (Database)

Check if services are running:
```bash
docker-compose ps
```

### 3. Deploy Smart Contracts

Deploy all contracts to your local Hardhat network:

```bash
# Terminal 3
npx hardhat ignition deploy ignition/modules/FullDeploymentModule.js --network localhost
```

Or use the automated setup script:
```bash
node scripts/deploy-and-setup-subgraph.js
```

### 4. Setup Subgraph

Navigate to the subgraph directory:
```bash
cd subgraph
```

Generate TypeScript types:
```bash
npm run codegen
```

Build the subgraph:
```bash
npm run build
```

Create the subgraph on your local Graph Node:
```bash
npm run create-local-hardhat
```

Deploy the subgraph:
```bash
npm run deploy-local-hardhat
```

## 🧪 Testing the Complete Flow

### Run Comprehensive Simulations

Test the entire offering and payout system:

```bash
# Terminal 4 - Run simulations
npx hardhat run scripts/simulation.js --network localhost
npx hardhat run scripts/payout-flow-simulation.js --network localhost
```

### Query the Subgraph

Access the GraphQL playground at: `http://localhost:8000/subgraphs/name/offering-payout-local`

#### Example Queries

**Get All Offerings:**
```graphql
{
  offerings {
    id
    totalRaised
    totalInvestors
    apyEnabled
    wrappedTokenAddress
    investments {
      investor
      paidAmount
      tokensReceived
    }
  }
}
```

**Get Wrapped Token Payout Data:**
```graphql
{
  wrappedTokens {
    name
    symbol
    currentPayoutPeriod
    payoutPeriodDuration
    firstPayoutDate
    totalPayoutFunds
    payoutPeriods {
      periodNumber
      fundsDistributed
      nextPayoutTime
      canDistribute
    }
    investors {
      userAddress
      wrappedBalance
      totalPayoutsClaimed
      lastClaimedPeriod
    }
  }
}
```

**Get User Investment Summary:**
```graphql
{
  totalInvestments(where: { userAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" }) {
    offeringAddress
    totalInvestment
    claimableTokens
    hasWrappedTokens
    wrappedTokenBalance
  }
}
```

**Get Payout Claims History:**
```graphql
{
  payoutClaims(orderBy: claimedAt, orderDirection: desc) {
    user
    amount
    claimedAt
    wrappedToken {
      name
      symbol
    }
    payoutPeriod {
      periodNumber
      fundsDistributed
    }
  }
}
```

**Get Global Statistics:**
```graphql
{
  globalStats(id: "global") {
    totalOfferings
    totalWrappedTokens
    totalInvestments
    totalInvestmentVolume
    totalPayoutFunds
    totalPayoutsClaimed
    totalEmergencyUnlocks
    totalFinalClaims
  }
}
```

## 🔧 Development Workflow

### 1. Make Contract Changes
```bash
# Edit contracts in contracts/
# Recompile
npx hardhat compile
```

### 2. Redeploy Contracts
```bash
# Clean previous deployment
npx hardhat clean
# Deploy fresh contracts
npx hardhat ignition deploy ignition/modules/FullDeploymentModule.js --network localhost --reset
```

### 3. Update Subgraph
```bash
cd subgraph
# Update contract addresses in subgraph.local.yaml if needed
# Rebuild and redeploy
npm run codegen
npm run build
npm run deploy-local-hardhat
```

### 4. Test Changes
```bash
# Run simulations to generate events
npx hardhat run scripts/simulation.js --network localhost
npx hardhat run scripts/payout-flow-simulation.js --network localhost

# Query subgraph to verify data
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"query": "{ offerings { id totalRaised } }"}' \
  http://localhost:8000/subgraphs/name/offering-payout-local
```

## 🐛 Troubleshooting

### Graph Node Issues
```bash
# Check Graph Node logs
docker-compose logs graph-node

# Restart Graph Node
docker-compose restart graph-node
```

### Subgraph Issues
```bash
# Check indexing status
curl http://localhost:8030/graphql \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"query": "{ indexingStatuses { subgraph health fatalError { message } } }"}'

# Remove and redeploy subgraph
npm run remove-local-hardhat
npm run create-local-hardhat
npm run deploy-local-hardhat
```

### Contract Address Mismatches
If contract addresses don't match in `subgraph.local.yaml`:

1. Check deployed addresses:
```bash
cat ignition/deployments/chain-31337/deployed_addresses.json
```

2. Update `subgraph.local.yaml` with correct addresses
3. Redeploy subgraph

## 📊 Monitoring

### Graph Node Status
- **GraphQL Endpoint**: `http://localhost:8000`
- **Admin Endpoint**: `http://localhost:8020`
- **Indexing Status**: `http://localhost:8030`
- **Metrics**: `http://localhost:8040`

### IPFS Status
- **API**: `http://localhost:5001`
- **Gateway**: `http://localhost:8080`

### Database
- **PostgreSQL**: `localhost:5432`
- **User**: `graph-node`
- **Password**: `let-me-in`
- **Database**: `graph-node`

## 🎯 Testing Scenarios

### Scenario 1: Basic Investment Flow
```bash
npx hardhat run scripts/simulation.js --network localhost
```

### Scenario 2: Payout Period Testing
```bash
npx hardhat run scripts/payout-flow-simulation.js --network localhost
```

### Scenario 3: Custom Test Script
Create your own test script in `scripts/` and run:
```bash
npx hardhat run scripts/your-test.js --network localhost
```

## 🔄 Reset Everything

To start completely fresh:

```bash
# Stop all services
docker-compose down -v

# Clean Hardhat
npx hardhat clean

# Restart everything
docker-compose up -d
npx hardhat node # In separate terminal
```

## 📈 Production Deployment

When ready for production:

1. Update `subgraph.yaml` with mainnet addresses
2. Deploy to The Graph Studio or hosted service
3. Update frontend to use production subgraph endpoint

This setup gives you a complete local development environment that mirrors production behavior!