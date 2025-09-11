# Comprehensive User-Centric Offering & Payout Subgraph

This subgraph provides complete user-centric tracking for the entire offering ecosystem, including investments, claims, payouts, emergency unlocks, and offering creation. Every action is recorded with detailed user context and analytics.

## 🎯 Key Features

### User-Centric Design
- **Complete User Profiles**: Track all user activities across the entire ecosystem
- **Investment History**: Detailed records of all investments with payment methods
- **Payout Tracking**: Comprehensive payout history and upcoming payout predictions
- **Emergency Actions**: Track emergency unlocks with penalty calculations
- **Offering Creation**: Track users who create offerings and their performance

### Real-Time Analytics
- **Daily/Monthly Stats**: Aggregated user activity statistics
- **Performance Metrics**: Offering and wrapped token performance tracking
- **Global Statistics**: System-wide metrics and trends
- **Notification System**: Smart notifications for important events

### Advanced Tracking
- **KYB Validation**: Track KYB-validated investments separately
- **Multi-Token Support**: Support for ETH, ERC20, and USDT investments
- **Proportional Payouts**: Calculate and track proportional payout distributions
- **Dynamic Rebalancing**: Track how payouts change when tokens are burned

## 📊 Main Entities

### User Entities
- `User` - Complete user profile with all statistics
- `UserInvestment` - Individual investment records
- `UserClaim` - All types of claims (tokens, payouts, refunds)
- `UserPayout` - Detailed payout claim records
- `UserWrappedTokenHolding` - Active wrapped token positions
- `UserEmergencyUnlock` - Emergency unlock history
- `UserRefund` - Refund claim records
- `UserKYBValidation` - KYB validation tracking

### Offering Entities
- `Offering` - Complete offering information and statistics
- `OfferingPerformance` - Performance metrics and analytics
- `OfferingDeployment` - Offering creation records

### Wrapped Token Entities
- `WrappedToken` - Wrapped token contract details
- `PayoutDistribution` - Payout distribution events
- `PayoutPeriod` - Payout period tracking
- `UserUpcomingPayout` - Predicted upcoming payouts

### Analytics Entities
- `GlobalStats` - System-wide statistics
- `UserDailyStats` - Daily user activity aggregation
- `UserMonthlyStats` - Monthly user activity aggregation
- `DailySystemStats` - Daily system-wide activity

### Event Tracking
- `InvestmentEvent` - All investment-related events
- `PayoutEvent` - All payout-related events
- `EmergencyEvent` - Emergency unlock events
- `RefundEvent` - Refund-related events

### Notifications
- `UserNotification` - Smart notifications for users
- `UserActivityHistory` - Complete activity timeline

## 🔍 Key Queries

### User Profile Queries
```graphql
# Get complete user profile
query GetUserProfile($userAddress: Bytes!) {
  user(id: $userAddress) {
    # All user statistics and activities
    totalInvestments
    totalInvestmentVolume
    totalPayoutsClaimed
    activeWrappedTokens
    
    # Recent activities
    investments(first: 10, orderBy: blockTimestamp, orderDirection: desc)
    claims(first: 10, orderBy: blockTimestamp, orderDirection: desc)
    wrappedTokenHoldings(where: { isActive: true })
    notifications(where: { isRead: false })
  }
}
```

### Investment Tracking
```graphql
# Get user investment history
query GetUserInvestmentHistory($userAddress: Bytes!) {
  user(id: $userAddress) {
    investments {
      offering { saleTokenSymbol }
      paymentTokenSymbol
      paidAmount
      usdValue
      tokensReceived
      isKYBValidated
      hasWrappedTokens
      blockTimestamp
    }
  }
}
```

### Payout Information
```graphql
# Get user payout info and upcoming payouts
query GetUserPayoutInfo($userAddress: Bytes!) {
  user(id: $userAddress) {
    totalPayoutsClaimed
    
    # Active holdings with claimable payouts
    wrappedTokenHoldings(where: { 
      isActive: true, 
      currentClaimablePayouts_gt: "0" 
    }) {
      wrappedToken { name, symbol }
      currentClaimablePayouts
      lastClaimedPeriod
    }
    
    # Payout history
    payouts {
      amount
      payoutPeriod
      sharePercentage
      blockTimestamp
    }
  }
}
```

### Offering Analytics
```graphql
# Get offering performance
query GetOfferingDetails($offeringAddress: Bytes!) {
  offering(id: $offeringAddress) {
    creator { address }
    totalRaised
    totalInvestors
    softCapReached
    
    # Investment breakdown
    investments {
      user { address }
      paidAmount
      isKYBValidated
      blockTimestamp
    }
    
    # Performance metrics
    performance {
      averageInvestmentSize
      timeToSoftCap
      emergencyUnlockRate
    }
  }
}
```

### Global Analytics
```graphql
# Get system-wide statistics
query GetGlobalStats {
  globalStats(id: "global") {
    totalUsers
    totalOfferings
    totalInvestmentVolume
    totalPayoutVolume
    totalEmergencyUnlocks
  }
  
  # Daily activity trends
  dailySystemStats(
    orderBy: date, 
    orderDirection: desc, 
    first: 30
  ) {
    date
    newUsers
    investmentVolume
    payoutVolume
  }
}
```

## 🚀 Usage Examples

### Frontend Integration
```typescript
// Get user dashboard data
const { data } = await client.query({
  query: GET_USER_PROFILE,
  variables: { userAddress: "0x..." }
});

// Display user's active investments
const activeInvestments = data.user.wrappedTokenHoldings
  .filter(holding => holding.isActive)
  .map(holding => ({
    tokenName: holding.wrappedToken.name,
    balance: holding.currentBalance,
    claimablePayouts: holding.currentClaimablePayouts,
    maturityDate: holding.wrappedToken.maturityDate
  }));

// Show upcoming payouts
const upcomingPayouts = data.user.wrappedTokenHoldings
  .filter(holding => holding.currentClaimablePayouts > 0)
  .map(holding => ({
    tokenName: holding.wrappedToken.name,
    amount: holding.currentClaimablePayouts,
    canClaim: true
  }));
```

### Analytics Dashboard
```typescript
// Get platform analytics
const { data } = await client.query({
  query: GET_GLOBAL_STATS
});

// Display key metrics
const metrics = {
  totalUsers: data.globalStats.totalUsers,
  totalVolume: data.globalStats.totalInvestmentVolume,
  activeOfferings: data.globalStats.activeOfferings,
  payoutsClaimed: data.globalStats.totalPayoutsClaimed
};

// Get growth trends
const { data: dailyData } = await client.query({
  query: GET_DAILY_SYSTEM_STATS,
  variables: { 
    fromDate: "2024-01-01", 
    toDate: "2024-12-31" 
  }
});
```

### Notification System
```typescript
// Get user notifications
const { data } = await client.query({
  query: GET_USER_NOTIFICATIONS,
  variables: { 
    userAddress: "0x...",
    unreadOnly: true 
  }
});

// Display actionable notifications
const actionableNotifications = data.notifications
  .filter(n => n.isActionable)
  .map(n => ({
    type: n.notificationType,
    title: n.title,
    message: n.message,
    priority: n.priority,
    relatedAmount: n.relatedAmount
  }));
```

## 🔧 Configuration

### Contract Addresses
Update the contract addresses in `subgraph.yaml`:
- InvestmentManager: `0xf25157b5657C654E6eD45A848435dB29Db8Bf7D0`
- OfferingFactory: `0x6866b02f7a78270C6BF8525AA42f7ABEd54449FF`
- WrappedTokenFactory: `0x5b857c5cAc158D135f8C94de6B546aaF91552995`

### Deployment Commands
```bash
# Generate types
npm run codegen

# Build subgraph
npm run build

# Deploy to The Graph Studio
npm run deploy

# Deploy locally
npm run deploy-local
```

## 📈 Analytics Capabilities

### User Analytics
- Investment patterns and preferences
- Payout claiming behavior
- Emergency unlock usage
- Portfolio performance tracking

### Offering Analytics
- Fundraising performance metrics
- Investor acquisition patterns
- Time-to-cap analysis
- Success rate tracking

### System Analytics
- Platform growth metrics
- Volume and activity trends
- User retention analysis
- Feature adoption rates

### Payout Analytics
- Distribution efficiency
- Claim rate analysis
- Proportional share calculations
- Emergency unlock impact

## 🎯 Benefits

1. **Complete User Visibility**: Track every user action across the entire ecosystem
2. **Real-Time Analytics**: Live dashboard data for users and administrators
3. **Predictive Insights**: Upcoming payout calculations and maturity tracking
4. **Performance Monitoring**: Detailed metrics for offerings and wrapped tokens
5. **Smart Notifications**: Automated alerts for important events
6. **Historical Analysis**: Complete audit trail of all activities
7. **Cross-Contract Tracking**: Unified view across all contract interactions

This subgraph provides the foundation for building sophisticated user dashboards, analytics platforms, and notification systems for your DeFi offering ecosystem.