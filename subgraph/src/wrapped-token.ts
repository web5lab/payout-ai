import {
  PayoutDistributed as PayoutDistributedEvent,
  PayoutClaimed as PayoutClaimedEvent,
  FinalTokensClaimed as FinalTokensClaimedEvent,
  EmergencyUnlockEnabled as EmergencyUnlockEnabledEvent,
  EmergencyUnlockUsed as EmergencyUnlockUsedEvent,
  InvestmentRegistered as InvestmentRegisteredEvent,
  Transfer as TransferEvent
} from "../generated/templates/WRAPEDTOKEN/WRAPEDTOKEN"
import { 
  User,
  WrappedToken,
  UserWrappedTokenHolding,
  UserPayout,
  UserEmergencyUnlock,
  UserClaim,
  PayoutDistribution,
  PayoutPeriod
} from "../generated/schema"
import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts"
import { 
  getOrCreateUser, 
  updateUserActivity, 
  updateGlobalStats,
  calculateSharePercentage,
  createUserNotification,
  checkAndCreatePayoutNotifications,
  checkAndCreateMaturityNotifications
} from "./user-manager"

export function handleInvestmentRegistered(event: InvestmentRegisteredEvent): void {
  let user = getOrCreateUser(event.params.user, event.block.timestamp)
  let wrappedToken = WrappedToken.load(event.address)
  
  if (!wrappedToken) {
    // Create wrapped token entity if it doesn't exist
    wrappedToken = createWrappedTokenEntity(event.address, event.block.timestamp)
  }
  
  // Create or update user wrapped token holding
  let holdingId = event.params.user.toHexString() + "-" + event.address.toHexString()
  let holding = UserWrappedTokenHolding.load(Bytes.fromUTF8(holdingId))
  
  if (!holding) {
    holding = new UserWrappedTokenHolding(Bytes.fromUTF8(holdingId))
    holding.user = event.params.user
    holding.userAddress = event.params.user
    holding.wrappedToken = event.address
    holding.wrappedTokenAddress = event.address
    holding.currentBalance = BigInt.fromI32(0)
    holding.originalInvestment = BigInt.fromI32(0)
    holding.usdValueInvested = BigInt.fromI32(0)
    holding.totalPayoutsReceived = BigInt.fromI32(0)
    holding.totalPayoutsClaimed = BigInt.fromI32(0)
    holding.currentClaimablePayouts = BigInt.fromI32(0)
    holding.lastClaimedPeriod = BigInt.fromI32(0)
    holding.isActive = true
    holding.hasClaimedFinal = false
    holding.hasEmergencyUnlocked = false
    holding.firstInvestmentAt = event.block.timestamp
    
    // Update wrapped token holder count
    wrappedToken.totalHolders = wrappedToken.totalHolders.plus(BigInt.fromI32(1))
    wrappedToken.activeHolders = wrappedToken.activeHolders.plus(BigInt.fromI32(1))
  }
  
  // Update holding with new investment
  holding.currentBalance = holding.currentBalance.plus(event.params.tokenAmount)
  holding.originalInvestment = holding.originalInvestment.plus(event.params.tokenAmount)
  holding.usdValueInvested = holding.usdValueInvested.plus(event.params.usdValue)
  holding.lastActivityAt = event.block.timestamp
  holding.save()
  
  // Update wrapped token stats
  wrappedToken.totalSupply = wrappedToken.totalSupply.plus(event.params.tokenAmount)
  wrappedToken.totalUSDTInvested = wrappedToken.totalUSDTInvested.plus(event.params.usdValue)
  wrappedToken.save()
  
  // Update user activity
  updateUserActivity(
    event.params.user,
    "wrapped_investment",
    event.params.tokenAmount,
    event.address,
    event.block.timestamp,
    event.block.number,
    event.transaction.hash,
    "Registered investment in wrapped token",
    null,
    event.address
  )
  
  // Check maturity notifications
  checkAndCreateMaturityNotifications(
    event.params.user,
    event.address,
    wrappedToken.maturityDate,
    event.block.timestamp
  )
  
  // Create investment success notification
  createUserNotification(
    event.params.user,
    "wrapped_investment",
    "Wrapped Token Investment Registered",
    "Your investment has been registered in the wrapped token system. You'll receive periodic payouts!",
    "medium",
    event.block.timestamp,
    null,
    event.address,
    event.params.tokenAmount
  )
}

export function handlePayoutDistributed(event: PayoutDistributedEvent): void {
  let wrappedToken = WrappedToken.load(event.address)
  if (!wrappedToken) return

  // Create payout distribution record
  let distributionId = event.address.toHexString() + "-" + event.params.period.toString() + "-distribution"
  let distribution = new PayoutDistribution(Bytes.fromUTF8(distributionId))
  
  distribution.wrappedToken = event.address
  distribution.wrappedTokenAddress = event.address
  distribution.period = event.params.period
  distribution.amount = event.params.amount
  distribution.totalUSDTAtDistribution = event.params.totalUSDTAtDistribution
  distribution.distributedBy = event.transaction.from
  distribution.blockNumber = event.block.number
  distribution.blockTimestamp = event.block.timestamp
  distribution.transactionHash = event.transaction.hash
  
  // Calculate eligible holders and balance
  distribution.eligibleHolders = wrappedToken.activeHolders
  distribution.totalEligibleBalance = wrappedToken.totalSupply
  
  distribution.save()

  // Create payout period record
  let periodId = event.address.toHexString() + "-" + event.params.period.toString()
  let payoutPeriod = new PayoutPeriod(Bytes.fromUTF8(periodId))
  
  payoutPeriod.wrappedToken = event.address
  payoutPeriod.wrappedTokenAddress = event.address
  payoutPeriod.periodNumber = event.params.period
  payoutPeriod.distributedAmount = event.params.amount
  payoutPeriod.totalUSDTAtDistribution = event.params.totalUSDTAtDistribution
  payoutPeriod.distributedAt = event.block.timestamp
  payoutPeriod.distributedBy = event.transaction.from
  payoutPeriod.totalClaims = BigInt.fromI32(0)
  payoutPeriod.totalClaimedAmount = BigInt.fromI32(0)
  payoutPeriod.unclaimedAmount = event.params.amount
  payoutPeriod.claimRate = BigInt.fromI32(0)
  payoutPeriod.eligibleUsers = wrappedToken.activeHolders
  payoutPeriod.blockNumber = event.block.number
  payoutPeriod.transactionHash = event.transaction.hash
  
  payoutPeriod.save()

  // Update wrapped token stats
  wrappedToken.currentPayoutPeriod = event.params.period
  wrappedToken.lastPayoutDistributionTime = event.block.timestamp
  wrappedToken.totalPayoutFundsDistributed = wrappedToken.totalPayoutFundsDistributed.plus(event.params.amount)
  wrappedToken.currentPayoutFunds = wrappedToken.currentPayoutFunds.plus(event.params.amount)
  wrappedToken.save()

  // Create upcoming payout records for all holders
  createUpcomingPayoutsForHolders(event.address, event.params.period, event.params.amount, event.block.timestamp)
  
  // Notify all holders about available payout
  notifyHoldersAboutPayout(event.address, event.params.amount, event.block.timestamp)
  
  // Update global statistics
  updateGlobalStats("payout_distribution", event.params.amount, event.block.timestamp)
}

export function handlePayoutClaimed(event: PayoutClaimedEvent): void {
  let user = getOrCreateUser(event.params.user, event.block.timestamp)
  let wrappedToken = WrappedToken.load(event.address)
  if (!wrappedToken) return

  // Create user payout record
  let payoutId = event.transaction.hash.concatI32(event.logIndex.toI32())
  let userPayout = new UserPayout(payoutId)
  
  userPayout.user = event.params.user
  userPayout.userAddress = event.params.user
  userPayout.wrappedToken = event.address
  userPayout.wrappedTokenAddress = event.address
  userPayout.amount = event.params.amount
  userPayout.payoutToken = wrappedToken.payoutToken
  userPayout.payoutTokenSymbol = wrappedToken.payoutTokenSymbol || ""
  userPayout.payoutPeriod = event.params.period
  userPayout.isPartialClaim = false // Assuming full claim for now
  userPayout.remainingClaimable = BigInt.fromI32(0)
  userPayout.blockNumber = event.block.number
  userPayout.blockTimestamp = event.block.timestamp
  userPayout.transactionHash = event.transaction.hash
  
  // Link to payout distribution and period
  let distributionId = event.address.toHexString() + "-" + event.params.period.toString() + "-distribution"
  let payoutDistribution = PayoutDistribution.load(Bytes.fromUTF8(distributionId))
  if (payoutDistribution) {
    userPayout.payoutDistribution = payoutDistribution.id
  }
  
  let periodId = event.address.toHexString() + "-" + event.params.period.toString()
  let payoutPeriod = PayoutPeriod.load(Bytes.fromUTF8(periodId))
  if (payoutPeriod) {
    userPayout.payoutPeriod = payoutPeriod.id
  }
  
  // Get user's wrapped token balance for share calculation
  let holdingId = event.params.user.toHexString() + "-" + event.address.toHexString()
  let holding = UserWrappedTokenHolding.load(Bytes.fromUTF8(holdingId))
  
  if (holding) {
    userPayout.userWrappedBalance = holding.currentBalance
    userPayout.sharePercentage = calculateSharePercentage(holding.currentBalance, wrappedToken.totalSupply)
    
    // Update holding stats
    holding.totalPayoutsClaimed = holding.totalPayoutsClaimed.plus(event.params.amount)
    holding.lastClaimedPeriod = event.params.period
    holding.lastActivityAt = event.block.timestamp
    holding.save()
  } else {
    userPayout.userWrappedBalance = BigInt.fromI32(0)
    userPayout.sharePercentage = BigInt.fromI32(0)
  }
  
  userPayout.totalWrappedSupply = wrappedToken.totalSupply
  userPayout.save()

  // Update payout period stats
  let periodId = event.address.toHexString() + "-" + event.params.period.toString()
  let payoutPeriod = PayoutPeriod.load(Bytes.fromUTF8(periodId))
  if (payoutPeriod) {
    payoutPeriod.totalClaims = payoutPeriod.totalClaims.plus(BigInt.fromI32(1))
    payoutPeriod.totalClaimedAmount = payoutPeriod.totalClaimedAmount.plus(event.params.amount)
    payoutPeriod.unclaimedAmount = payoutPeriod.unclaimedAmount.minus(event.params.amount)
    
    if (payoutPeriod.distributedAmount.gt(BigInt.fromI32(0))) {
      payoutPeriod.claimRate = payoutPeriod.totalClaimedAmount
        .times(BigInt.fromI32(10000))
        .div(payoutPeriod.distributedAmount)
    }
    
    payoutPeriod.save()
  }

  // Update wrapped token stats
  wrappedToken.totalPayoutsClaimed = wrappedToken.totalPayoutsClaimed.plus(event.params.amount)
  wrappedToken.currentPayoutFunds = wrappedToken.currentPayoutFunds.minus(event.params.amount)
  wrappedToken.save()

  // Update user activity
  updateUserActivity(
    event.params.user,
    "payout",
    event.params.amount,
    wrappedToken.payoutToken,
    event.block.timestamp,
    event.block.number,
    event.transaction.hash,
    "Claimed payout from wrapped token",
    null,
    event.address
  )

  // Update global statistics
  updateGlobalStats("payout", event.params.amount, event.block.timestamp)
  
  // Create payout success notification
  createUserNotification(
    event.params.user,
    "payout_claimed",
    "Payout Claimed Successfully!",
    "You have successfully claimed " + event.params.amount.toString() + " payout tokens.",
    "medium",
    event.block.timestamp,
    null,
    event.address,
    event.params.amount
  )
}

export function handleFinalTokensClaimed(event: FinalTokensClaimedEvent): void {
  let user = getOrCreateUser(event.params.user, event.block.timestamp)
  let wrappedToken = WrappedToken.load(event.address)
  if (!wrappedToken) return

  // Create user claim record
  let claimId = event.transaction.hash.concatI32(event.logIndex.toI32())
  let userClaim = new UserClaim(claimId)
  
  userClaim.user = event.params.user
  userClaim.userAddress = event.params.user
  userClaim.offeringAddress = wrappedToken.offeringAddress
  userClaim.claimType = "final_tokens"
  userClaim.amount = event.params.amount
  userClaim.tokenAddress = wrappedToken.peggedToken
  userClaim.tokenSymbol = getTokenSymbol(wrappedToken.peggedToken)
  userClaim.isEmergencyUnlock = false
  userClaim.penaltyAmount = BigInt.fromI32(0)
  userClaim.blockNumber = event.block.number
  userClaim.blockTimestamp = event.block.timestamp
  userClaim.transactionHash = event.transaction.hash
  
  userClaim.save()

  // Update user wrapped token holding
  let holdingId = event.params.user.toHexString() + "-" + event.address.toHexString()
  let holding = UserWrappedTokenHolding.load(Bytes.fromUTF8(holdingId))
  
  if (holding) {
    holding.isActive = false
    holding.hasClaimedFinal = true
    holding.currentBalance = BigInt.fromI32(0)
    holding.lastActivityAt = event.block.timestamp
    holding.save()
    
    // Update user's active wrapped tokens count
    user.activeWrappedTokens = user.activeWrappedTokens.minus(BigInt.fromI32(1))
    user.save()
  }

  // Update wrapped token stats
  wrappedToken.activeHolders = wrappedToken.activeHolders.minus(BigInt.fromI32(1))
  wrappedToken.totalSupply = wrappedToken.totalSupply.minus(event.params.amount)
  wrappedToken.save()

  // Update user activity
  updateUserActivity(
    event.params.user,
    "final_claim",
    event.params.amount,
    wrappedToken.peggedToken,
    event.block.timestamp,
    event.block.number,
    event.transaction.hash,
    "Claimed final tokens at maturity",
    null,
    event.address
  )
  
  // Create final claim notification
  createUserNotification(
    event.params.user,
    "final_tokens_claimed",
    "Final Tokens Claimed!",
    "You have successfully claimed your final tokens at maturity. Investment cycle complete!",
    "high",
    event.block.timestamp,
    null,
    event.address,
    event.params.amount
  )
}

export function handleEmergencyUnlockEnabled(event: EmergencyUnlockEnabledEvent): void {
  let wrappedToken = WrappedToken.load(event.address)
  if (!wrappedToken) return

  wrappedToken.emergencyUnlockEnabled = true
  wrappedToken.emergencyUnlockPenalty = event.params.penalty
  wrappedToken.save()

  // Notify all holders about emergency unlock availability
  notifyHoldersAboutEmergencyUnlock(event.address, event.params.penalty, event.block.timestamp)
}

export function handleEmergencyUnlockUsed(event: EmergencyUnlockUsedEvent): void {
  let user = getOrCreateUser(event.params.user, event.block.timestamp)
  let wrappedToken = WrappedToken.load(event.address)
  if (!wrappedToken) return

  // Create user emergency unlock record
  let unlockId = event.transaction.hash.concatI32(event.logIndex.toI32())
  let emergencyUnlock = new UserEmergencyUnlock(unlockId)
  
  emergencyUnlock.user = event.params.user
  emergencyUnlock.userAddress = event.params.user
  emergencyUnlock.wrappedToken = event.address
  emergencyUnlock.wrappedTokenAddress = event.address
  emergencyUnlock.originalAmount = event.params.amount.plus(event.params.penalty)
  emergencyUnlock.penaltyAmount = event.params.penalty
  emergencyUnlock.receivedAmount = event.params.amount
  emergencyUnlock.blockNumber = event.block.number
  emergencyUnlock.blockTimestamp = event.block.timestamp
  emergencyUnlock.transactionHash = event.transaction.hash
  
  // Calculate penalty percentage
  let totalAmount = event.params.amount.plus(event.params.penalty)
  emergencyUnlock.penaltyPercentage = totalAmount.gt(BigInt.fromI32(0)) 
    ? event.params.penalty.times(BigInt.fromI32(10000)).div(totalAmount)
    : BigInt.fromI32(0)
  
  // Get prior payout activity
  let holdingId = event.params.user.toHexString() + "-" + event.address.toHexString()
  let holding = UserWrappedTokenHolding.load(Bytes.fromUTF8(holdingId))
  if (holding) {
    emergencyUnlock.totalPayoutsClaimedBefore = holding.totalPayoutsClaimed
    
    // Update holding status
    holding.isActive = false
    holding.hasEmergencyUnlocked = true
    holding.currentBalance = BigInt.fromI32(0)
    holding.lastActivityAt = event.block.timestamp
    holding.save()
    
    // Update user's active wrapped tokens count
    user.activeWrappedTokens = user.activeWrappedTokens.minus(BigInt.fromI32(1))
    user.save()
  } else {
    emergencyUnlock.totalPayoutsClaimedBefore = BigInt.fromI32(0)
  }
  
  emergencyUnlock.save()

  // Create user claim record for emergency unlock
  let claimId = event.transaction.hash.concatI32(event.logIndex.toI32() + 2000)
  let userClaim = new UserClaim(claimId)
  
  userClaim.user = event.params.user
  userClaim.userAddress = event.params.user
  userClaim.offeringAddress = wrappedToken.offeringAddress
  userClaim.claimType = "emergency_unlock"
  userClaim.amount = event.params.amount
  userClaim.tokenAddress = wrappedToken.peggedToken
  userClaim.tokenSymbol = getTokenSymbol(wrappedToken.peggedToken)
  userClaim.isEmergencyUnlock = true
  userClaim.penaltyAmount = event.params.penalty
  userClaim.blockNumber = event.block.number
  userClaim.blockTimestamp = event.block.timestamp
  userClaim.transactionHash = event.transaction.hash
  
  userClaim.save()

  // Update wrapped token stats
  wrappedToken.totalEmergencyUnlocks = wrappedToken.totalEmergencyUnlocks.plus(BigInt.fromI32(1))
  wrappedToken.activeHolders = wrappedToken.activeHolders.minus(BigInt.fromI32(1))
  wrappedToken.totalSupply = wrappedToken.totalSupply.minus(emergencyUnlock.originalAmount)
  wrappedToken.save()

  // Update user activity
  updateUserActivity(
    event.params.user,
    "emergency",
    event.params.penalty, // Track penalty as the "amount" for emergency activity
    wrappedToken.peggedToken,
    event.block.timestamp,
    event.block.number,
    event.transaction.hash,
    "Emergency unlock with penalty",
    null,
    event.address
  )

  // Update global statistics
  updateGlobalStats("emergency", event.params.penalty, event.block.timestamp)
  
  // Create emergency unlock notification
  createUserNotification(
    event.params.user,
    "emergency_unlock_completed",
    "Emergency Unlock Completed",
    "Emergency unlock processed. Received: " + event.params.amount.toString() + ", Penalty: " + event.params.penalty.toString(),
    "high",
    event.block.timestamp,
    null,
    event.address,
    event.params.amount
  )
}

export function handleTransfer(event: TransferEvent): void {
  let wrappedToken = WrappedToken.load(event.address)
  if (!wrappedToken) return

  // Handle minting (from zero address)
  if (event.params.from.equals(Address.zero())) {
    // This is handled in handleInvestmentRegistered
    return
  }
  
  // Handle burning (to zero address)
  if (event.params.to.equals(Address.zero())) {
    // Update user holding
    let holdingId = event.params.from.toHexString() + "-" + event.address.toHexString()
    let holding = UserWrappedTokenHolding.load(Bytes.fromUTF8(holdingId))
    
    if (holding) {
      holding.currentBalance = holding.currentBalance.minus(event.params.value)
      holding.lastActivityAt = event.block.timestamp
      holding.save()
    }
    
    // Update wrapped token total supply
    wrappedToken.totalSupply = wrappedToken.totalSupply.minus(event.params.value)
    wrappedToken.save()
    
    return
  }
  
  // Regular transfers are blocked in the contract, but we track them anyway
  // This would handle any potential transfers if they were allowed
}

function createWrappedTokenEntity(address: Address, timestamp: BigInt): WrappedToken {
  let wrappedToken = new WrappedToken(address)
  
  // Initialize with default values
  wrappedToken.name = ""
  wrappedToken.symbol = ""
  wrappedToken.offeringAddress = Bytes.empty()
  wrappedToken.peggedToken = Bytes.empty()
  wrappedToken.payoutToken = Bytes.empty()
  wrappedToken.payoutTokenSymbol = ""
  wrappedToken.maturityDate = BigInt.fromI32(0)
  wrappedToken.payoutAPR = BigInt.fromI32(0)
  wrappedToken.payoutPeriodDuration = BigInt.fromI32(0)
  wrappedToken.firstPayoutDate = BigInt.fromI32(0)
  wrappedToken.currentPayoutPeriod = BigInt.fromI32(0)
  wrappedToken.lastPayoutDistributionTime = BigInt.fromI32(0)
  wrappedToken.totalSupply = BigInt.fromI32(0)
  wrappedToken.totalEscrowed = BigInt.fromI32(0)
  wrappedToken.totalUSDTInvested = BigInt.fromI32(0)
  wrappedToken.totalPayoutFundsDistributed = BigInt.fromI32(0)
  wrappedToken.totalPayoutsClaimed = BigInt.fromI32(0)
  wrappedToken.currentPayoutFunds = BigInt.fromI32(0)
  wrappedToken.emergencyUnlockEnabled = false
  wrappedToken.emergencyUnlockPenalty = BigInt.fromI32(0)
  wrappedToken.totalEmergencyUnlocks = BigInt.fromI32(0)
  wrappedToken.totalHolders = BigInt.fromI32(0)
  wrappedToken.activeHolders = BigInt.fromI32(0)
  wrappedToken.createdAt = timestamp
  wrappedToken.createdBlock = BigInt.fromI32(0)
  
  wrappedToken.save()
  return wrappedToken
}

function createUpcomingPayoutsForHolders(
  wrappedTokenAddress: Address, 
  period: BigInt, 
  amount: BigInt, 
  timestamp: BigInt
): void {
  // This would require iterating through all holders
  // For now, we'll create upcoming payouts when users interact with the system
  // In a real implementation, you might want to use a different approach
}

function notifyHoldersAboutPayout(
  wrappedTokenAddress: Address, 
  amount: BigInt, 
  timestamp: BigInt
): void {
  // This would notify all holders about available payout
  // Implementation would depend on how you want to handle bulk notifications
}

function notifyHoldersAboutEmergencyUnlock(
  wrappedTokenAddress: Address, 
  penalty: BigInt, 
  timestamp: BigInt
): void {
  // This would notify all holders about emergency unlock availability
  // Implementation would depend on your notification strategy
}

function getTokenSymbol(tokenAddress: Bytes): string {
  if (tokenAddress.equals(Address.zero())) {
    return "ETH"
  }
  
  // Try to get symbol from contract
  return "TOKEN"
}