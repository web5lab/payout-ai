# Comprehensive Offering & Payout Subgraph

This subgraph indexes all data related to the offering ecosystem including investments, payouts, claims, and fund tracking.

## Entities Tracked

### Investment Data
- **InvestmentRouted**: Individual investment transactions
- **TotalInvestment**: Aggregated investment data per user per offering
- **TokensClaimed**: Final token claims after maturity

### Offering Information
- **Offering**: Complete offering contract details and statistics
- **OfferingDeployed**: Factory deployment events

### Wrapped Token & Payout System
- **WrappedToken**: Wrapped token contract details and statistics
- **WrappedTokenInvestor**: Individual investor records in wrapped tokens
- **PayoutRound**: Payout fund addition rounds
- **PayoutClaim**: Individual payout claims by users
- **UserPayoutSummary**: Aggregated payout data per user
- **EmergencyUnlock**: Emergency unlock events with penalties
- **FinalTokenClaim**: Final token claims at maturity

### Global Statistics
- **GlobalStats**: System-wide statistics and metrics

## Key Features

### Investment Tracking
- Complete investment history per user
- Payment token breakdown
- Investment volume analytics
- Wrapped token balance tracking

### Payout System
- Proportional payout distribution tracking
- Multiple payout rounds support
- Cumulative payout history
- Claimable vs claimed amounts

### Emergency Features
- Emergency unlock tracking with penalty calculations
- Final token claims at maturity
- User record lifecycle management

### Analytics
- Global system statistics
- Per-offering metrics
- Per-user investment summaries
- Payout distribution analytics

## Usage Examples

### Query All Investments for a User
```graphql
{
  totalInvestments(where: { userAddress: "0x..." }) {
    offeringAddress
    totalInvestment
    claimableTokens
    hasWrappedTokens
    wrappedTokenBalance
  }
}
```

### Query Payout History for a User
```graphql
{
  userPayoutSummaries(where: { userAddress: "0x..." }) {
    wrappedToken {
      name
      symbol
    }
    totalClaimedAmount
    currentClaimableAmount
    claimCount
    claims {
      amount
      claimedAt
    }
  }
}
```

### Query Offering Statistics
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

### Query Global System Stats
```graphql
{
  globalStats(id: "global") {
    totalOfferings
    totalInvestments
    totalInvestmentVolume
    totalPayoutFunds
    totalPayoutsClaimed
    totalEmergencyUnlocks
  }
}
```

## Deployment

1. Update contract addresses in `subgraph.yaml`
2. Generate types: `npm run codegen`
3. Build: `npm run build`
4. Deploy: `npm run deploy`

## Development

- **Local deployment**: `npm run deploy-local`
- **Testing**: `npm run test`
- **Code generation**: `npm run codegen`