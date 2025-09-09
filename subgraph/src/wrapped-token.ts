import {
  PayoutFundsAdded as PayoutFundsAddedEvent,
  PayoutClaimed as PayoutClaimedEvent,
  IndividualPayoutClaimed as IndividualPayoutClaimedEvent,
  FinalTokensClaimed as FinalTokensClaimedEvent,
  EmergencyUnlockEnabled as EmergencyUnlockEnabledEvent,
  EmergencyUnlockUsed as EmergencyUnlockUsedEvent,
  Transfer as TransferEvent
} from "../generated/templates/WRAPEDTOKEN/WRAPEDTOKEN"
import { 
  WrappedToken,
  WrappedTokenInvestor,
  PayoutRound,
  PayoutClaim,
  UserPayoutSummary,
  EmergencyUnlock,
  FinalTokenClaim,
  GlobalStats,
  TotalInvestment
} from "../generated/schema"
import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts"

export function handlePayoutFundsAdded(event: PayoutFundsAddedEvent): void {
  let wrappedToken = WrappedToken.load(event.address)
  if (!wrappedToken) return

  // Update wrapped token total funds
  wrappedToken.totalPayoutFunds = event.params.totalFunds
  wrappedToken.save()

  // Create payout round record
  let roundNumber = getRoundNumber(event.address, event.block.timestamp)
  let payoutRound = new PayoutRound(
    event.address.concat(Bytes.fromBigInt(roundNumber))
  )
  payoutRound.wrappedToken = event.address
  payoutRound.roundNumber = roundNumber
  payoutRound.amount = event.params.amount
  payoutRound.totalFundsAfterRound = event.params.totalFunds
  payoutRound.addedBy = event.transaction.from
  payoutRound.addedAt = event.block.timestamp
  payoutRound.addedBlock = event.block.number
  payoutRound.transactionHash = event.transaction.hash
  payoutRound.save()

  // Update global statistics
  let stats = GlobalStats.load(Bytes.fromUTF8("global"))
  if (stats) {
    stats.totalPayoutFunds = stats.totalPayoutFunds.plus(event.params.amount)
    stats.lastUpdated = event.block.timestamp
    stats.save()
  }
}

export function handlePayoutClaimed(event: PayoutClaimedEvent): void {
  let wrappedToken = WrappedToken.load(event.address)
  if (!wrappedToken) return

  // Create payout claim record
  let payoutClaim = new PayoutClaim(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  payoutClaim.wrappedToken = event.address
  payoutClaim.user = event.params.user
  payoutClaim.amount = event.params.amount
  payoutClaim.remainingBalance = event.params.remainingBalance
  payoutClaim.claimedAt = event.block.timestamp
  payoutClaim.claimedBlock = event.block.number
  payoutClaim.transactionHash = event.transaction.hash
  payoutClaim.save()

  // Update or create user payout summary
  let summaryId = event.address.toHexString() + "-" + event.params.user.toHexString()
  let summary = UserPayoutSummary.load(Bytes.fromUTF8(summaryId))
  if (!summary) {
    summary = new UserPayoutSummary(Bytes.fromUTF8(summaryId))
    summary.wrappedToken = event.address
    summary.userAddress = event.params.user
    summary.totalClaimedAmount = BigInt.fromI32(0)
    summary.totalAvailableAmount = BigInt.fromI32(0)
    summary.currentClaimableAmount = BigInt.fromI32(0)
    summary.lastClaimTimestamp = BigInt.fromI32(0)
    summary.claimCount = BigInt.fromI32(0)
  }

  summary.totalClaimedAmount = summary.totalClaimedAmount.plus(event.params.amount)
  summary.currentClaimableAmount = event.params.remainingBalance
  summary.lastClaimTimestamp = event.block.timestamp
  summary.claimCount = summary.claimCount.plus(BigInt.fromI32(1))
  summary.save()

  // Update wrapped token investor record
  let investorId = event.address.toHexString() + "-" + event.params.user.toHexString()
  let investor = WrappedTokenInvestor.load(Bytes.fromUTF8(investorId))
  if (investor) {
    investor.totalPayoutsClaimed = investor.totalPayoutsClaimed.plus(event.params.amount)
    investor.totalPayoutBalance = investor.totalPayoutBalance.plus(event.params.amount)
    investor.save()
  }

  // Update global statistics
  let stats = GlobalStats.load(Bytes.fromUTF8("global"))
  if (stats) {
    stats.totalPayoutsClaimed = stats.totalPayoutsClaimed.plus(event.params.amount)
    stats.lastUpdated = event.block.timestamp
    stats.save()
  }
}

export function handleIndividualPayoutClaimed(event: IndividualPayoutClaimedEvent): void {
  // Similar to handlePayoutClaimed but for individual claims
  handlePayoutClaimed(event as PayoutClaimedEvent)
}

export function handleFinalTokensClaimed(event: FinalTokensClaimedEvent): void {
  let finalClaim = new FinalTokenClaim(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  finalClaim.wrappedToken = event.address
  finalClaim.user = event.params.user
  finalClaim.amount = event.params.amount
  finalClaim.claimedAt = event.block.timestamp
  finalClaim.claimedBlock = event.block.number
  finalClaim.transactionHash = event.transaction.hash
  finalClaim.save()

  // Update wrapped token investor record - mark as claimed
  let investorId = event.address.toHexString() + "-" + event.params.user.toHexString()
  let investor = WrappedTokenInvestor.load(Bytes.fromUTF8(investorId))
  if (investor) {
    investor.hasClaimedTokens = true
    investor.save()
  }

  // Update global statistics
  let stats = GlobalStats.load(Bytes.fromUTF8("global"))
  if (stats) {
    stats.totalFinalClaims = stats.totalFinalClaims.plus(BigInt.fromI32(1))
    stats.lastUpdated = event.block.timestamp
    stats.save()
  }
}

export function handleEmergencyUnlockEnabled(event: EmergencyUnlockEnabledEvent): void {
  let wrappedToken = WrappedToken.load(event.address)
  if (wrappedToken) {
    wrappedToken.emergencyUnlockEnabled = true
    wrappedToken.emergencyUnlockPenalty = event.params.penalty
    wrappedToken.save()
  }
}

export function handleEmergencyUnlockUsed(event: EmergencyUnlockUsedEvent): void {
  let emergencyUnlock = new EmergencyUnlock(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  emergencyUnlock.wrappedToken = event.address
  emergencyUnlock.user = event.params.user
  emergencyUnlock.amount = event.params.amount
  emergencyUnlock.penalty = event.params.penalty
  
  // Calculate penalty percentage
  let totalAmount = event.params.amount.plus(event.params.penalty)
  emergencyUnlock.penaltyPercentage = totalAmount.gt(BigInt.fromI32(0)) 
    ? event.params.penalty.times(BigInt.fromI32(10000)).div(totalAmount)
    : BigInt.fromI32(0)
  
  emergencyUnlock.unlockedAt = event.block.timestamp
  emergencyUnlock.unlockedBlock = event.block.number
  emergencyUnlock.transactionHash = event.transaction.hash
  emergencyUnlock.save()

  // Update wrapped token investor record - mark as emergency unlocked
  let investorId = event.address.toHexString() + "-" + event.params.user.toHexString()
  let investor = WrappedTokenInvestor.load(Bytes.fromUTF8(investorId))
  if (investor) {
    investor.emergencyUnlocked = true
    investor.wrappedBalance = BigInt.fromI32(0) // Tokens burned
    investor.save()
  }

  // Update wrapped token total supply
  let wrappedToken = WrappedToken.load(event.address)
  if (wrappedToken) {
    // Total supply will be updated by Transfer event (burn)
    wrappedToken.save()
  }

  // Update total investment record
  let totalInvestmentId = wrappedToken ? wrappedToken.offeringContract.toHexString() + "-" + event.params.user.toHexString() : ""
  if (totalInvestmentId) {
    let totalInvestment = TotalInvestment.load(Bytes.fromUTF8(totalInvestmentId))
    if (totalInvestment) {
      totalInvestment.wrappedTokenBalance = BigInt.fromI32(0)
      totalInvestment.save()
    }
  }

  // Update global statistics
  let stats = GlobalStats.load(Bytes.fromUTF8("global"))
  if (stats) {
    stats.totalEmergencyUnlocks = stats.totalEmergencyUnlocks.plus(BigInt.fromI32(1))
    stats.lastUpdated = event.block.timestamp
    stats.save()
  }
}

export function handleTransfer(event: TransferEvent): void {
  let wrappedToken = WrappedToken.load(event.address)
  if (!wrappedToken) return

  // Handle minting (from zero address)
  if (event.params.from.equals(Address.zero())) {
    // Create or update investor record
    let investorId = event.address.toHexString() + "-" + event.params.to.toHexString()
    let investor = WrappedTokenInvestor.load(Bytes.fromUTF8(investorId))
    
    if (!investor) {
      investor = new WrappedTokenInvestor(Bytes.fromUTF8(investorId))
      investor.wrappedToken = event.address
      investor.userAddress = event.params.to
      investor.deposited = event.params.value
      investor.wrappedBalance = BigInt.fromI32(0)
      investor.totalPayoutsClaimed = BigInt.fromI32(0)
      investor.totalPayoutBalance = BigInt.fromI32(0)
      investor.payoutFrequency = 0 // Default to daily
      investor.lastPayoutTime = event.block.timestamp
      investor.hasClaimedTokens = false
      investor.emergencyUnlocked = false
      investor.registeredAt = event.block.timestamp
      investor.registeredBlock = event.block.number
    }
    
    investor.wrappedBalance = investor.wrappedBalance.plus(event.params.value)
    investor.save()

    // Update wrapped token total supply
    wrappedToken.totalSupply = wrappedToken.totalSupply.plus(event.params.value)
    wrappedToken.save()
  }

  // Handle burning (to zero address)
  if (event.params.to.equals(Address.zero())) {
    // Update investor record
    let investorId = event.address.toHexString() + "-" + event.params.from.toHexString()
    let investor = WrappedTokenInvestor.load(Bytes.fromUTF8(investorId))
    
    if (investor) {
      investor.wrappedBalance = investor.wrappedBalance.minus(event.params.value)
      investor.save()
    }

    // Update wrapped token total supply
    wrappedToken.totalSupply = wrappedToken.totalSupply.minus(event.params.value)
    wrappedToken.save()
  }
}

function getRoundNumber(wrappedTokenAddress: Address, timestamp: BigInt): BigInt {
  // Simple round numbering based on timestamp
  // In practice, you might want to track this more precisely
  return timestamp.div(BigInt.fromI32(86400)) // Daily rounds
}