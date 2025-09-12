# Complete System Flow Analysis

## System Architecture Overview

```
┌─────────────────┐    ┌───────────────────┐     ┌─────────────────┐
│  OfferingFactory│────│WrappedTokenFactory│──── │   Offering      │
│                 │    │                   │     │                 │
└─────────────────┘    └───────────────────┘     └─────────────────┘
         │                                               │
         │                                               │
         ▼                                               ▼
┌─────────────────┐                              ┌─────────────────┐
│InvestmentManager│◄─────────────────────────────│   WrapedToken   │
│                 │                              │                 │
└─────────────────┘                              └─────────────────┘
         │                                               │
         │                                               │
         ▼                                               ▼
┌─────────────────┐                              ┌─────────────────┐
│     Escrow      │                              │   Payout System │
│                 │                              │                 │
└─────────────────┘                              └─────────────────┘
```

## Flow 1: Offering Creation & Deployment

### Standard Offering Creation (Without APY)
```
Admin
  │
  ├─► OfferingFactory.createOfferingWithPaymentTokens()
  │     │
  │     ├─► new Offering()
  │     ├─► initialize(config)
  │     ├─► setWhitelistedPaymentToken()
  │     ├─► setTokenOracle()
  │     └─► Escrow.registerOffering()
  │
  └─► Returns: offeringAddress
```

### APY-Enabled Offering Creation
```
Admin
  │
  ├─► OfferingFactory.createOfferingWithPaymentTokens(apyEnabled=true)
  │     │
  │     ├─► WrappedTokenFactory.createWrappedToken(config)
  │     │     │
  │     │     └─► new WRAPEDTOKEN(config) ──► wrappedTokenAddress
  │     │
  │     ├─► new Offering()
  │     ├─► initialize(config + wrappedTokenAddress)
  │     ├─► setWhitelistedPaymentToken()
  │     ├─► setTokenOracle()
  │     └─► Escrow.registerOffering()
  │
  └─► Returns: offeringAddress
```

## Flow 2: Investment Process

### Standard Investment Flow (Without APY)
```
Investor
  │
  ├─► InvestmentManager.routeInvestment(offering, token, amount)
  │     │
  │     └─► Offering.invest(token, investor, amount)
  │           │
  │           ├─► Oracle.read() ──► (price, timestamp)
  │           ├─► validateInvestment()
  │           ├─► Escrow.depositToken() or depositNative()
  │           ├─► updatePendingTokens()
  │           └─► emit Invested event
  │
  └─► emit InvestmentRouted event
```

### APY Investment Flow
```
Investor
  │
  ├─► InvestmentManager.routeInvestment(offering, token, amount)
  │     │
  │     └─► Offering.invest(token, investor, amount)
  │           │
  │           ├─► Oracle.read() ──► (price, timestamp)
  │           ├─► validateInvestment()
  │           ├─► Escrow.depositToken() or depositNative()
  │           ├─► updatePendingTokens() [Tokens held for later claim]
  │           └─► emit Invested event
  │
  └─► emit InvestmentRouted event
```

### KYB-Validated Investment Flow
```
Backend ──► generateKYBSignature(wallet, nonce, expiry) ──► signature
  │
  ▼
Investor
  │
  ├─► InvestmentManager.routeInvestmentWithKYB(offering, token, amount, nonce, expiry, signature)
  │     │
  │     ├─► verifyKYBSignature()
  │     ├─► markSignatureUsed()
  │     └─► Offering.invest(token, investor, amount)
  │           │
  │           └─► [Same as standard investment flow]
  │
  └─► emit KYBValidatedInvestment event
```

## Flow 3: Token Claiming Process

### Standard Token Claim (Without APY)
```
[After offering finalized]

Investor
  │
  ├─► InvestmentManager.claimInvestmentTokens(offering)
  │     │
  │     └─► Offering.claimTokens(investor)
  │           │
  │           ├─► validateClaim()
  │           └─► SaleToken.transfer(investor, amount)
  │
  └─► emit TokensClaimed event
```

### APY Token Claim (Wrapped Token Creation)
```
[After offering finalized]

Investor
  │
  ├─► InvestmentManager.claimInvestmentTokens(offering)
  │     │
  │     └─► Offering.claimTokens(investor)
  │           │
  │           ├─► validateClaim()
  │           ├─► SaleToken.approve(wrappedToken, amount)
  │           └─► WrapedToken.registerInvestment(investor, amount, usdValue)
  │                 │
  │                 ├─► SaleToken.transferFrom(offering, wrappedToken, amount)
  │                 └─► _mint(investor, amount)
  │
  └─► emit TokensClaimed event
```

## Flow 4: Payout Distribution System

### Payout Setup and Distribution
```
PayoutAdmin
  │
  ├─► WrapedToken.calculateRequiredPayoutTokens()
  │     │
  │     └─► Returns: (requiredAmount, periodAPR)
  │
  ├─► PayoutToken.approve(wrappedToken, payoutAmount)
  │
  └─► WrapedToken.distributePayoutForPeriod(payoutAmount)
        │
        ├─► PayoutToken.transferFrom(admin, wrappedToken, amount)
        ├─► incrementPayoutPeriod()
        ├─► snapshotTotalUSDT()
        └─► emit PayoutDistributed event
```

### Payout Claiming Process
```
Investor
  │
  ├─► WrapedToken.getUserPayoutInfo(investor)
  │     │
  │     └─► Returns: (totalClaimable, totalClaimed, ...)
  │
  └─► WrapedToken.claimAvailablePayouts()
        │
        ├─► calculateClaimableFromAllPeriods()
        ├─► updateUserClaimedPeriod()
        ├─► PayoutToken.transfer(investor, totalClaimable)
        └─► emit PayoutClaimed event
```

### Multiple Payout Rounds Flow
```
Period 1:
PayoutAdmin ──► distributePayoutForPeriod(amount1)
Investor1   ──► claimAvailablePayouts()
Investor2   ──► claimAvailablePayouts()

Period 2 (30 days later):
PayoutAdmin ──► distributePayoutForPeriod(amount2)
Investor1   ──► claimAvailablePayouts()
[Investor2 doesn't claim yet]

Period 3 (60 days later):
PayoutAdmin ──► distributePayoutForPeriod(amount3)
Investor2   ──► claimAvailablePayouts() [Claims periods 2 & 3 together]
```

## Flow 5: Offering Finalization

### Successful Offering Finalization
```
[After endDate or soft cap reached]

TreasuryOwner
  │
  └─► Escrow.finalizeOffering(offering)
        │
        ├─► Offering.finalizeOffering()
        │     │
        │     ├─► setFinalized(true)
        │     └─► [If APY Enabled] WrapedToken.setFirstPayoutDate()
        │                           │
        │                           └─► firstPayoutDate = now + payoutPeriodDuration
        │
        ├─► PaymentToken.transfer(tokenOwner, totalRaised)
        └─► emit OfferingFinalized event
```

### Early Finalization (Soft Cap Reached)
```
[totalRaised >= softCap]

TokenOwner
  │
  └─► Offering.finalizeOfferingSoftCap()
        │
        ├─► validateSoftCapReached()
        ├─► setFinalized(true)
        ├─► setSaleClosed(true)
        ├─► [If APY Enabled] WrapedToken.setFirstPayoutDate()
        └─► emit OfferingFinalized event
```

## Flow 6: Cancellation and Refund Process

### Offering Cancellation Flow
```
TokenOwner
  │
  └─► Offering.cancelOffering()
        │
        ├─► validateCanCancel()
        ├─► setOfferingCancelled(true)
        ├─► setSaleClosed(true)
        └─► Escrow.enableRefundsByOffering()
              │
              ├─► InvestmentManager.notifyRefundsEnabled(offering)
              └─► emit RefundsEnabled event
```

### Refund Claiming Process
```
[After refunds enabled]

Investor
  │
  └─► InvestmentManager.claimRefund(offering, token)
        │
        └─► Escrow.refund(offering, investor)
              │
              ├─► validateRefundEligibility()
              ├─► clearDeposit(investor)
              ├─► PaymentToken.transfer(investor, depositAmount)
              ├─► emit Refunded event
              └─► InvestmentManager emits RefundClaimed event
```

### Admin Emergency Refund
```
TreasuryOwner
  │
  └─► Escrow.enableRefundsByOwner(offering)
        │
        ├─► InvestmentManager.notifyRefundsEnabled(offering)
        └─► emit RefundsEnabled event

[Investor can now claim refund using same process as above]
```

## Flow 7: Emergency Unlock System

### Emergency Unlock Setup
```
Admin
  │
  └─► WrapedToken.enableEmergencyUnlock(penaltyPercentage)
        │
        ├─► setEmergencyUnlockEnabled(true)
        ├─► setEmergencyUnlockPenalty(penalty)
        └─► emit EmergencyUnlockEnabled event
```

### Emergency Unlock Usage
```
Investor
  │
  └─► WrapedToken.emergencyUnlock()
        │
        ├─► validateEmergencyUnlock()
        ├─► calculatePenalty()
        ├─► updateInvestorState()
        ├─► _burn(investor, wrappedBalance)
        ├─► SaleToken.transfer(investor, amountAfterPenalty)
        └─► emit EmergencyUnlockUsed event
```

### Emergency Unlock with Payout History
```
[Investor has claimed some payouts]

Investor ──► WrapedToken.claimAvailablePayouts()
           │
           └─► PayoutToken.transfer(investor, payoutAmount)

[Later, investor uses emergency unlock]

Investor ──► WrapedToken.emergencyUnlock()
           │
           ├─► validateEmergencyUnlock()
           ├─► [Payout history preserved]
           ├─► SaleToken.transfer(investor, tokensAfterPenalty)
           └─► emit EmergencyUnlockUsed event
```

## Flow 8: Token Maturity and Final Claims

### Final Token Redemption
```
[After maturityDate]

Investor
  │
  └─► WrapedToken.claimFinalTokens()
        │
        ├─► validateMaturity()
        ├─► validateNotClaimed()
        ├─► updateInvestorState()
        ├─► _burn(investor, wrappedBalance)
        ├─► SaleToken.transfer(investor, depositedAmount)
        └─► emit FinalTokensClaimed event
```

### Complete APY Lifecycle
```
Investment Phase:
Investor ──► [Wrapped tokens minted]

Payout Phase (Multiple periods):
┌─ Every payout period ─┐
│ WrapedToken ──► PayoutToken [Payouts distributed] │
│ Investor ──► WrapedToken.claimAvailablePayouts()  │
└─────────────────────────┘

Maturity Phase:
Investor ──► WrapedToken.claimFinalTokens()
           │
           └─► SaleToken.transfer(investor, originalTokens)

[Total received: Original tokens + All payouts]
```

## Flow 9: Multi-Investor Scenarios

### Proportional Payout Distribution
```
Initial Investment:
Investor1: $600 (60%)
Investor2: $300 (30%) 
Investor3: $100 (10%)

PayoutAdmin ──► distributePayoutForPeriod($1000)

Investor1 ──► claimAvailablePayouts() ──► Receives $600 (60% of $1000)
Investor2 ──► claimAvailablePayouts() ──► Receives $300 (30% of $1000)
Investor3 ──► claimAvailablePayouts() ──► Receives $100 (10% of $1000)
```

### Dynamic Rebalancing After Emergency Unlock
```
Initial State:
Investor1: 50%
Investor2: 50%

PayoutAdmin ──► distributePayoutForPeriod($1000)
Investor1 ──► claimAvailablePayouts() ──► Gets $500
Investor2 ──► claimAvailablePayouts() ──► Gets $500

[Investor1 uses emergency unlock]
Investor1 ──► emergencyUnlock()

New State:
Investor2: 100% (only remaining investor)

PayoutAdmin ──► distributePayoutForPeriod($800)
Investor2 ──► claimAvailablePayouts() ──► Gets full $800
```

## Flow 10: Cross-Contract Communication

### Investment Manager ↔ Offering Communication
```
InvestmentManager ──► Offering.invest()
                │
                └─► Escrow.depositToken()
                │
                └─► Returns: tokensReceived

InvestmentManager ──► Offering.claimTokens()
                │
                └─► Returns: claimedAmount
```

### Offering ↔ WrappedToken Communication
```
Offering ──► WrapedToken.registerInvestment()
         │
         ├─► SaleToken.transferFrom()
         └─► _mint()

Offering ──► WrapedToken.setFirstPayoutDate()
         │
         └─► firstPayoutDate = calculated
```

### Escrow ↔ InvestmentManager Communication
```
Escrow ──► InvestmentManager.notifyRefundsEnabled()
       │
       └─► setRefundsEnabled(true)

InvestmentManager ──► Escrow.refund()
                  │
                  └─► processRefund()
```

## Flow 11: State Transitions

### Offering State Machine
```
[*] ──► Created
         │
         ├─► Active (startDate reached)
         │    │
         │    ├─► AcceptingInvestments
         │    ├─► SoftCapReached (totalRaised >= softCap)
         │    └─► CapReached (totalRaised >= fundraisingCap)
         │
         ├─► Closed (endDate reached OR cap reached)
         │    │
         │    └─► Finalized (finalizeOffering())
         │
         └─► Cancelled (cancelOffering())
              │
              └─► RefundsEnabled (enableRefunds())
```

### WrappedToken State Machine
```
[*] ──► Created
         │
         ├─► AcceptingInvestments (offering active)
         │    │
         │    └─► EmergencyUnlocked (emergencyUnlock())
         │
         ├─► PayoutPhase (offering finalized)
         │    │
         │    ├─► AwaitingPayout
         │    ├─► PayoutAvailable (distributePayoutForPeriod())
         │    ├─► PayoutClaimed (claimAvailablePayouts())
         │    └─► EmergencyUnlocked (emergencyUnlock())
         │
         └─► Matured (maturityDate reached)
              │
              └─► Claimed (claimFinalTokens())
```

## Flow 12: Error Handling and Edge Cases

### Investment Validation Flow
```
Investment Request
         │
         ├─► Sale Active? ──► No ──► Revert: Sale not started/ended
         │                │
         │                └─► Yes
         │
         ├─► Token Whitelisted? ──► No ──► Revert: Token not whitelisted
         │                      │
         │                      └─► Yes
         │
         ├─► Amount >= Min? ──► No ──► Revert: Below min investment
         │                  │
         │                  └─► Yes
         │
         ├─► Amount <= Max? ──► No ──► Revert: Exceeds max investment
         │                  │
         │                  └─► Yes
         │
         ├─► Total <= Cap? ──► No ──► Revert: Exceeds cap
         │                 │
         │                 └─► Yes
         │
         └─► Process Investment
```

### Payout Claim Validation Flow
```
Payout Claim Request
         │
         ├─► User Has Deposit? ──► No ──► Revert: NoDeposit
         │                     │
         │                     └─► Yes
         │
         ├─► Emergency Unlocked? ──► Yes ──► Revert: NoDeposit
         │                       │
         │                       └─► No
         │
         ├─► Final Tokens Claimed? ──► Yes ──► Revert: AlreadyClaimed
         │                         │
         │                         └─► No
         │
         ├─► Payouts Available? ──► No ──► Revert: NoPayout
         │                      │
         │                      └─► Yes
         │
         └─► Process Payout Claim
```

### Emergency Unlock Validation Flow
```
Emergency Unlock Request
         │
         ├─► Emergency Enabled? ──► No ──► Revert: UnlockDisabled
         │                      │
         │                      └─► Yes
         │
         ├─► User Has Deposit? ──► No ──► Revert: NoDeposit
         │                     │
         │                     └─► Yes
         │
         ├─► Already Unlocked? ──► Yes ──► Revert: AlreadyClaimed
         │                     │
         │                     └─► No
         │
         ├─► Final Tokens Claimed? ──► Yes ──► Revert: AlreadyClaimed
         │                         │
         │                         └─► No
         │
         └─► Process Emergency Unlock
```

## Flow 13: Gas Optimization Patterns

### Batch Operations Flow
```
Instead of multiple single operations:
User ──► claimPayoutForPeriod(period1)
User ──► claimPayoutForPeriod(period2)
User ──► claimPayoutForPeriod(period3)

Use batch operation:
User ──► claimPayoutsInRange(period1, period3)
       │
       └─► Loop through periods efficiently
```

### Storage Optimization Flow
```
Storage Read ──► Cached? ──► Yes ──► Use Cached Value
             │           │
             │           └─► No ──► Read from Storage
             │                   │
             │                   ├─► Cache Value
             │                   └─► Use Value
             │
             └─► Continue Execution
```

## Flow 14: Security Patterns

### Reentrancy Protection Flow
```
Attacker ──► maliciousFunction()
          │
          └─► Contract.nonReentrant modifier check
                │
                ├─► set reentrancy guard
                ├─► ExternalContract.external call
                │     │
                │     └─► Contract.reentrant call attempt
                │           │
                │           └─► nonReentrant modifier check
                │                 │
                │                 └─► Revert: ReentrancyGuardReentrantCall
                │
                └─► Complete execution
```

### Access Control Flow
```
Function Call ──► Has Required Role? ──► No ──► Revert: AccessControlUnauthorizedAccount
              │                      │
              │                      └─► Yes ──► Execute Function
              │                                │
              │                                ├─► Role-Specific Logic
              │                                └─► Complete Execution
```

### Oracle Security Flow
```
Contract ──► Oracle.read()
         │
         └─► Returns: (price, timestamp)
               │
               ├─► validate price > 0
               ├─► validate timestamp freshness
               │
               ├─► Invalid? ──► Revert: Invalid/Stale price
               │
               └─► Valid? ──► Use price for calculations
```

## Flow 15: Monitoring and Events

### Event Emission Flow
```
State Change ──► Emit Relevant Event
             │
             ├─► Multiple Contracts Involved? ──► Yes ──► Emit Events in Each Contract
             │                               │
             │                               └─► No ──► Single Event Emission
             │
             └─► Subgraph Indexing
                   │
                   ├─► Frontend Updates
                   ├─► Analytics Dashboard
                   └─► Monitoring Alerts
```

### Critical Event Categories
```
Events
├── Investment
│   ├── InvestmentRouted
│   ├── KYBValidatedInvestment
│   └── Invested
├── Payout
│   ├── PayoutDistributed
│   ├── PayoutClaimed
│   └── FinalTokensClaimed
├── Emergency
│   ├── EmergencyUnlockEnabled
│   ├── EmergencyUnlockUsed
│   ├── RefundsEnabled
│   └── RefundClaimed
└── Lifecycle
    ├── OfferingDeployed
    ├── OfferingFinalized
    ├── OfferingCancelled
    └── SaleClosed
```

## Flow 16: Complete User Journey Examples

### Standard Investment Journey (No APY)
```
Step 1: Admin Setup
Admin ──► OfferingFactory.createOfferingWithPaymentTokens()
       │
       └─► Offering deployed with payment tokens configured

Step 2: Investment Phase
Investor ──► InvestmentManager.routeInvestment()
         │
         ├─► Funds sent to Escrow
         └─► Pending tokens recorded

Step 3: Finalization
TreasuryOwner ──► Escrow.finalizeOffering()
              │
              └─► Funds transferred to token owner

Step 4: Token Claim
Investor ──► InvestmentManager.claimInvestmentTokens()
         │
         └─► Sale tokens transferred directly to investor

[Journey Complete: Investor has sale tokens]
```

### APY Investment Journey (Full Lifecycle)
```
Step 1: Admin Setup
Admin ──► OfferingFactory.createOfferingWithPaymentTokens(apyEnabled=true)
       │
       ├─► Offering deployed
       ├─► WrappedToken deployed
       └─► Payout admin role granted

Step 2: Investment Phase
Investor ──► InvestmentManager.routeInvestment()
         │
         ├─► Funds sent to Escrow
         └─► Pending tokens recorded

Step 3: Finalization & Token Claim
TreasuryOwner ──► Escrow.finalizeOffering()
              │
              └─► First payout date set

Investor ──► InvestmentManager.claimInvestmentTokens()
         │
         ├─► Sale tokens locked in WrappedToken
         └─► Wrapped tokens minted to investor

Step 4: Payout Phase (Repeating)
PayoutAdmin ──► WrapedToken.distributePayoutForPeriod()
            │
            └─► Payout tokens available for claim

Investor ──► WrapedToken.claimAvailablePayouts()
         │
         └─► Payout tokens transferred to investor

[Repeat Step 4 for multiple payout periods]

Step 5: Maturity & Final Claim
[After maturity date]
Investor ──► WrapedToken.claimFinalTokens()
         │
         ├─► Wrapped tokens burned
         └─► Original sale tokens transferred to investor

[Journey Complete: Investor has original tokens + all payouts]
```

### Emergency Scenarios Journey
```
Scenario A: Offering Cancellation
TokenOwner ──► Offering.cancelOffering()
           │
           └─► Refunds enabled automatically

Investor ──► InvestmentManager.claimRefund()
         │
         └─► Original investment returned

Scenario B: Emergency Unlock (APY)
Admin ──► WrapedToken.enableEmergencyUnlock(penalty)
      │
      └─► Emergency unlock available

Investor ──► WrapedToken.emergencyUnlock()
         │
         ├─► Wrapped tokens burned
         └─► Sale tokens transferred (minus penalty)

[Early exit with penalty applied]
```

## Flow 17: Integration Points

### Frontend Integration Flow
```
Frontend Application
├── Web3 Provider Connection
├── Contract Instances
│   ├── OfferingFactory
│   ├── InvestmentManager
│   ├── Offering(s)
│   └── WrappedToken(s)
├── Event Listeners
│   ├── Investment Events
│   ├── Payout Events
│   └── State Change Events
└── User Interface
    ├── Investment Forms
    ├── Payout Dashboards
    └── Portfolio Views
```

### Backend Integration Flow
```
Backend Services
├── KYB Validation Service
│   ├── Signature Generation
│   └── Wallet Verification
├── Oracle Price Feeds
│   ├── API3 Integration
│   └── Price Validation
├── Event Monitoring
│   ├── Blockchain Event Listening
│   └── Database Updates
└── Analytics Service
    ├── Investment Tracking
    └── Payout Calculations
```

### Subgraph Integration Flow
```
Blockchain Events
         │
         ▼
Subgraph Indexing
├── Entity Definitions
│   ├── Offerings
│   ├── Investments
│   ├── Payouts
│   └── Users
├── Event Handlers
│   ├── Investment Handlers
│   ├── Payout Handlers
│   └── State Handlers
└── GraphQL API
    ├── Query Interface
    └── Real-time Updates
```

This comprehensive ASCII art flow documentation provides a complete visual reference for understanding every aspect of your DeFi offering platform, from basic operations to complex multi-contract interactions and edge cases.