import {
  PayoutDistributed as PayoutDistributedEvent,
  PayoutClaimed as PayoutClaimedEvent,
  FinalTokensClaimed as FinalTokensClaimedEvent,
  EmergencyUnlockEnabled as EmergencyUnlockEnabledEvent,
  EmergencyUnlockUsed as EmergencyUnlockUsedEvent,
  InvestmentRegistered as InvestmentRegisteredEvent,
  Transfer as TransferEvent,
  FirstPayoutDateSet as FirstPayoutDateSetEvent
} from "../generated/templates/WRAPEDTOKEN/WRAPEDTOKEN"
import { 
  User,
  WrappedToken,
  UserWrappedTokenHolding,
  UserPayout,
  UserEmergencyUnlock,
  UserClaim,
  PayoutDistribution,
  PayoutPeriod,
  UserUpcomingPayout,
  PayoutCalculation,
  PayoutSchedule,
  UserNotification,
  UserActivityHistory,
  Offering
} from "../generated/schema"
import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts"
import { 
  getOrCreateUser, 
  updateUserActivity,
} from "./user-manager"

// Helper function to calculate next payout time
function calculateNextPayoutTime(wrappedToken: WrappedToken, currentTime: BigInt): BigInt {
  if (wrappedToken.firstPayoutDate.equals(BigInt.fromI32(0))) {
    return BigInt.fromI32(0)
  }
  
  if (wrappedToken.lastPayoutDistributionTime.equals(BigInt.fromI32(0))) {
    return wrappedToken.firstPayoutDate
  }
  
  return wrappedToken.lastPayoutDistributionTime.plus(wrappedToken.payoutPeriodDuration)
}

// Helper function to calculate required payout tokens
function calculateRequiredPayoutTokens(wrappedToken: WrappedToken): BigInt {
  if (wrappedToken.totalUSDTInvested.equals(BigInt.fromI32(0))) {
    return BigInt.fromI32(0)
  }
  
  // Calculate period APR: (Annual APR * Period Duration) / Seconds Per Year
  let secondsPerYear = BigInt.fromI32(365 * 24 * 60 * 60)
  let periodAPR = wrappedToken.payoutAPR.times(wrappedToken.payoutPeriodDuration).div(secondsPerYear)
  
  // Calculate required amount: (Total USDT * Period APR) / 10000
  return wrappedToken.totalUSDTInvested.times(periodAPR).div(BigInt.fromI32(10000))
}

// Helper function to update payout status
function updatePayoutStatus(wrappedToken: WrappedToken, currentTime: BigInt): void {
  let nextPayoutTime = calculateNextPayoutTime(wrappedToken, currentTime)
  wrappedToken.nextPayoutTime = nextPayoutTime
  wrappedToken.isPayoutPeriodAvailable = currentTime.ge(nextPayoutTime) && !nextPayoutTime.equals(BigInt.fromI32(0))
  wrappedToken.requiredPayoutTokens = calculateRequiredPayoutTokens(wrappedToken)
  
  // Update status based on conditions
  if (currentTime.lt(wrappedToken.maturityDate)) {
    if (wrappedToken.currentPayoutFunds.gt(BigInt.fromI32(0))) {
      wrappedToken.payoutStatus = "ready"
    } else if (wrappedToken.isPayoutPeriodAvailable) {
      wrappedToken.payoutStatus = "waiting"
    } else {
      wrappedToken.payoutStatus = "distributed"
    }
  } else {
    wrappedToken.payoutStatus = "completed"
  }
}

// Helper function to create upcoming payouts for all holders
function updateUpcomingPayoutsForPeriod(
  wrappedTokenAddress: Address, 
  period: BigInt, 
  distributedAmount: BigInt,
  totalUSDTAtDistribution: BigInt,
  timestamp: BigInt
): void {
  // Update all upcoming payouts for this period to mark as distributed
  // Note: In a real implementation, you might want to iterate through all holders
  // For now, upcoming payouts are updated when users claim or when created
  
  // This function serves as a placeholder for batch updates
  // Individual upcoming payouts are updated in handlePayoutClaimed
}

// Create complete payout schedule when first payout date is set
function createPayoutSchedule(wrappedToken: WrappedToken, timestamp: BigInt): void {
  if (wrappedToken.totalPayoutRounds.equals(BigInt.fromI32(0))) {
    return // No schedule to create
  }
  
  // Calculate expected payout amount per period
  let expectedAmountPerPeriod = BigInt.fromI32(0)
  if (wrappedToken.totalUSDTInvested.gt(BigInt.fromI32(0))) {
    let secondsPerYear = BigInt.fromI32(365 * 24 * 60 * 60)
    let periodAPR = wrappedToken.payoutAPR.times(wrappedToken.payoutPeriodDuration).div(secondsPerYear)
    expectedAmountPerPeriod = wrappedToken.totalUSDTInvested.times(periodAPR).div(BigInt.fromI32(10000))
  }
  
  // Create schedule entries for all payout periods
  for (let i = BigInt.fromI32(1); i.le(wrappedToken.totalPayoutRounds); i = i.plus(BigInt.fromI32(1))) {
    let scheduleId = wrappedToken.id.toHexString() + "-" + i.toString() + "-schedule"
    let schedule = new PayoutSchedule(Bytes.fromUTF8(scheduleId))
    
    schedule.wrappedToken = wrappedToken.id
    schedule.wrappedTokenAddress = wrappedToken.id
    schedule.offering = wrappedToken.offeringAddress
    schedule.offeringAddress = wrappedToken.offeringAddress
    schedule.periodNumber = i
    
    // Calculate expected payout time: firstPayoutDate + (period - 1) * duration
    schedule.expectedPayoutTime = wrappedToken.firstPayoutDate.plus(
      i.minus(BigInt.fromI32(1)).times(wrappedToken.payoutPeriodDuration)
    )
    
    schedule.expectedAmount = expectedAmountPerPeriod
    schedule.actualPayoutTime = BigInt.fromI32(0)
    schedule.actualAmount = BigInt.fromI32(0)
    schedule.isDistributed = false
    schedule.isOnTime = false
    schedule.delayInSeconds = BigInt.fromI32(0)
    schedule.amountVariance = BigInt.fromI32(0)
    schedule.accuracyPercentage = BigInt.fromI32(10000) // 100%
    schedule.status = "scheduled"
    schedule.createdAt = timestamp
    schedule.updatedAt = timestamp
    
    schedule.save()
  }
}

// Update payout schedule when distribution happens
function updatePayoutScheduleOnDistribution(
  wrappedTokenAddress: Address,
  period: BigInt,
  actualAmount: BigInt,
  timestamp: BigInt
): void {
  let scheduleId = wrappedTokenAddress.toHexString() + "-" + period.toString() + "-schedule"
  let schedule = PayoutSchedule.load(Bytes.fromUTF8(scheduleId))
  
  if (schedule) {
    schedule.actualPayoutTime = timestamp
    schedule.actualAmount = actualAmount
    schedule.isDistributed = true
    
    // Calculate timing accuracy
    if (schedule.expectedPayoutTime.gt(BigInt.fromI32(0))) {
      schedule.delayInSeconds = timestamp.minus(schedule.expectedPayoutTime)
      let tolerance = BigInt.fromI32(3600) // 1 hour tolerance
      schedule.isOnTime = schedule.delayInSeconds.le(tolerance) && schedule.delayInSeconds.ge(BigInt.fromI32(-3600))
    } else {
      schedule.isOnTime = true
      schedule.delayInSeconds = BigInt.fromI32(0)
    }
    
    // Calculate amount accuracy
    if (schedule.expectedAmount.gt(BigInt.fromI32(0))) {
      schedule.amountVariance = actualAmount.minus(schedule.expectedAmount)
      schedule.accuracyPercentage = actualAmount.times(BigInt.fromI32(10000)).div(schedule.expectedAmount)
    } else {
      schedule.amountVariance = BigInt.fromI32(0)
      schedule.accuracyPercentage = BigInt.fromI32(10000)
    }
    
    schedule.status = "distributed"
    schedule.updatedAt = timestamp
    schedule.save()
  }
}

// Update expected payout calculations
function updateExpectedPayoutCalculations(wrappedToken: WrappedToken): void {
  if (wrappedToken.totalUSDTInvested.gt(BigInt.fromI32(0)) && wrappedToken.totalPayoutRounds.gt(BigInt.fromI32(0))) {
    // Calculate expected payout per period
    let secondsPerYear = BigInt.fromI32(365 * 24 * 60 * 60)
    let periodAPR = wrappedToken.payoutAPR.times(wrappedToken.payoutPeriodDuration).div(secondsPerYear)
    wrappedToken.expectedPayoutPerPeriod = wrappedToken.totalUSDTInvested.times(periodAPR).div(BigInt.fromI32(10000))
    
    // Calculate total expected payouts over all periods
    wrappedToken.totalExpectedPayouts = wrappedToken.expectedPayoutPerPeriod.times(wrappedToken.totalPayoutRounds)
  }
}

// Update payout accuracy metrics
function updatePayoutAccuracyMetrics(wrappedToken: WrappedToken, actualAmount: BigInt, period: BigInt): void {
  // Calculate variance from expected
  if (wrappedToken.expectedPayoutPerPeriod.gt(BigInt.fromI32(0))) {
    let variance = actualAmount.minus(wrappedToken.expectedPayoutPerPeriod)
    wrappedToken.payoutVariance = wrappedToken.payoutVariance.plus(variance)
    
    // Calculate overall accuracy
    let totalExpectedSoFar = wrappedToken.expectedPayoutPerPeriod.times(period)
    if (totalExpectedSoFar.gt(BigInt.fromI32(0))) {
      wrappedToken.payoutAccuracy = wrappedToken.totalPayoutFundsDistributed.times(BigInt.fromI32(10000)).div(totalExpectedSoFar)
    }
  }
}

export function handleInvestmentRegistered(event: InvestmentRegisteredEvent): void {
  let user = getOrCreateUser(event.params.user, event.block.timestamp)
  let wrappedToken = WrappedToken.load(event.address)
  
  if (!wrappedToken) {
    // Create wrapped token entity if it doesn't exist
    wrappedToken = createWrappedTokenEntity(event.address, event.block.timestamp)
  }
  
  // Update payout calculations
  updatePayoutStatus(wrappedToken, event.block.timestamp)
  wrappedToken.save()
  
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
  holding.usdValueInvested = holding.usdValueInvested.plus(event.params.usdtValue)
  holding.lastActivityAt = event.block.timestamp
  holding.save()
  
  // Update wrapped token stats
  wrappedToken.totalSupply = wrappedToken.totalSupply.plus(event.params.tokenAmount)
  wrappedToken.totalUSDTInvested = wrappedToken.totalUSDTInvested.plus(event.params.usdtValue)
  wrappedToken.save()
  
  // Always create upcoming payout for this user
  let nextPeriodNumber = wrappedToken.currentPayoutPeriod.equals(BigInt.fromI32(0)) 
    ? BigInt.fromI32(1) 
    : wrappedToken.currentPayoutPeriod.plus(BigInt.fromI32(1))
  
  createUpcomingPayoutForUser(
    event.params.user,
    event.address,
    nextPeriodNumber,
    event.params.usdtValue,
    wrappedToken.totalUSDTInvested,
    event.block.timestamp,
    wrappedToken
  )
  
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
}

export function handlePayoutDistributed(event: PayoutDistributedEvent): void {
  let wrappedToken = WrappedToken.load(event.address)
  if (!wrappedToken) return

  // Update payout schedule entry
  updatePayoutScheduleOnDistribution(
    event.address,
    event.params.period,
    event.params.amount,
    event.block.timestamp
  )

  // Update expected vs actual tracking
  updatePayoutAccuracyMetrics(wrappedToken, event.params.amount, event.params.period)

  // Update offering payout statistics
  let offering = Offering.load(wrappedToken.offeringAddress)
  if (offering) {
    offering.totalPayoutDistributions = offering.totalPayoutDistributions.plus(BigInt.fromI32(1))
    offering.totalPayoutVolume = offering.totalPayoutVolume.plus(event.params.amount)
    offering.currentPayoutPeriod = event.params.period
    offering.nextPayoutTime = calculateNextPayoutTime(wrappedToken, event.block.timestamp)
    
    // Update offering status based on completion
    if (event.params.period.ge(wrappedToken.totalPayoutRounds)) {
      offering.payoutStatus = "completed"
      wrappedToken.payoutScheduleStatus = "completed"
    } else {
      offering.payoutStatus = "active"
      wrappedToken.payoutScheduleStatus = "active"
    }
    
    offering.save()
  }

  // Create payout calculation record
  let calculationId = event.address.toHexString() + "-" + event.params.period.toString() + "-calculation"
  let calculation = new PayoutCalculation(Bytes.fromUTF8(calculationId))
  
  calculation.wrappedToken = event.address
  calculation.wrappedTokenAddress = event.address
  calculation.periodNumber = event.params.period
  calculation.totalUSDTInvested = event.params.totalUSDTAtDistribution
  calculation.actualDistributedTokens = event.params.amount
  calculation.calculatedAt = event.block.timestamp
  calculation.distributedAt = event.block.timestamp
  
  // Calculate required vs actual variance
  let requiredAmount = calculateRequiredPayoutTokens(wrappedToken)
  calculation.requiredPayoutTokens = requiredAmount
  
  if (requiredAmount.gt(BigInt.fromI32(0))) {
    calculation.variance = event.params.amount.minus(requiredAmount)
    calculation.variancePercentage = calculation.variance.times(BigInt.fromI32(10000)).div(requiredAmount)
  } else {
    calculation.variance = BigInt.fromI32(0)
    calculation.variancePercentage = BigInt.fromI32(0)
  }
  
  // Calculate period APR
  let secondsPerYear = BigInt.fromI32(365 * 24 * 60 * 60)
  calculation.periodAPR = wrappedToken.payoutAPR.times(wrappedToken.payoutPeriodDuration).div(secondsPerYear)
  
  calculation.save()

  // Create payout distribution record
  let distributionId = event.address.toHexString() + "-" + event.params.period.toString() + "-distribution"
  let distribution = new PayoutDistribution(Bytes.fromUTF8(distributionId))
  
  distribution.wrappedToken = event.address
  distribution.wrappedTokenAddress = event.address
  distribution.offering = wrappedToken.offeringAddress
  distribution.offeringAddress = wrappedToken.offeringAddress
  distribution.period = event.params.period
  distribution.amount = event.params.amount
  distribution.totalUSDTAtDistribution = event.params.totalUSDTAtDistribution
  distribution.distributedBy = event.transaction.from
  distribution.blockNumber = event.block.number
  distribution.status = "distributed"
  distribution.claimRate = BigInt.fromI32(0) // Will be updated as claims happen
  distribution.blockTimestamp = event.block.timestamp
  distribution.transactionHash = event.transaction.hash
  
  // Calculate eligible holders and balance
  distribution.eligibleHolders = wrappedToken.activeHolders
  distribution.totalEligibleBalance = wrappedToken.totalSupply
  
  // Calculate average payout per user
  if (distribution.eligibleHolders.gt(BigInt.fromI32(0))) {
    distribution.averagePayoutPerUser = event.params.amount.div(distribution.eligibleHolders)
  } else {
    distribution.averagePayoutPerUser = BigInt.fromI32(0)
  }
  
  distribution.save()

  // Create or update payout period
  let periodId = event.address.toHexString() + "-period-" + event.params.period.toString()
  let payoutPeriod = PayoutPeriod.load(Bytes.fromUTF8(periodId))
  
  if (!payoutPeriod) {
    payoutPeriod = new PayoutPeriod(Bytes.fromUTF8(periodId))
    payoutPeriod.wrappedToken = event.address
    payoutPeriod.wrappedTokenAddress = event.address
    payoutPeriod.offering = wrappedToken.offeringAddress
    payoutPeriod.offeringAddress = wrappedToken.offeringAddress
    payoutPeriod.periodNumber = event.params.period
    payoutPeriod.totalClaims = BigInt.fromI32(0)
    payoutPeriod.totalClaimedAmount = BigInt.fromI32(0)
    
    // Set expected values from schedule
    let scheduleId = event.address.toHexString() + "-" + event.params.period.toString() + "-schedule"
    let schedule = PayoutSchedule.load(Bytes.fromUTF8(scheduleId))
    if (schedule) {
      payoutPeriod.expectedStartTime = schedule.expectedPayoutTime
      payoutPeriod.expectedEndTime = schedule.expectedPayoutTime.plus(wrappedToken.payoutPeriodDuration)
      payoutPeriod.expectedAmount = schedule.expectedAmount
      payoutPeriod.actualAmount = event.params.amount
      payoutPeriod.amountVariance = event.params.amount.minus(schedule.expectedAmount)
      
      // Calculate accuracy percentage
      if (schedule.expectedAmount.gt(BigInt.fromI32(0))) {
        payoutPeriod.accuracyPercentage = event.params.amount.times(BigInt.fromI32(10000)).div(schedule.expectedAmount)
      } else {
        payoutPeriod.accuracyPercentage = BigInt.fromI32(10000)
      }
      
      // Check if on schedule (within 1 hour tolerance)
      let tolerance = BigInt.fromI32(3600) // 1 hour
      payoutPeriod.delayFromSchedule = event.block.timestamp.minus(schedule.expectedPayoutTime)
      payoutPeriod.isOnSchedule = payoutPeriod.delayFromSchedule.le(tolerance)
    } else {
      // Fallback values if schedule not found
      payoutPeriod.expectedStartTime = BigInt.fromI32(0)
      payoutPeriod.expectedEndTime = BigInt.fromI32(0)
      payoutPeriod.expectedAmount = BigInt.fromI32(0)
      payoutPeriod.actualAmount = event.params.amount
      payoutPeriod.amountVariance = BigInt.fromI32(0)
      payoutPeriod.accuracyPercentage = BigInt.fromI32(10000)
      payoutPeriod.isOnSchedule = true
      payoutPeriod.delayFromSchedule = BigInt.fromI32(0)
    }
  }
  
  payoutPeriod.startTime = wrappedToken.lastPayoutDistributionTime
  payoutPeriod.endTime = event.block.timestamp.plus(wrappedToken.payoutPeriodDuration)
  payoutPeriod.distributedAmount = event.params.amount
  payoutPeriod.totalUSDTAtDistribution = event.params.totalUSDTAtDistribution
  payoutPeriod.distributedAt = event.block.timestamp
  payoutPeriod.distributedBy = event.transaction.from
  payoutPeriod.unclaimedAmount = event.params.amount
  payoutPeriod.eligibleUsers = wrappedToken.activeHolders
  payoutPeriod.status = "distributed"
  payoutPeriod.blockNumber = event.block.number
  payoutPeriod.transactionHash = event.transaction.hash
  
  payoutPeriod.save()

  // Update wrapped token stats
  wrappedToken.currentPayoutPeriod = event.params.period
  wrappedToken.lastPayoutDistributionTime = event.block.timestamp
  wrappedToken.totalPayoutFundsDistributed = wrappedToken.totalPayoutFundsDistributed.plus(event.params.amount)
  wrappedToken.currentPayoutFunds = wrappedToken.currentPayoutFunds.plus(event.params.amount)
  
  // Update payout status
  updatePayoutStatus(wrappedToken, event.block.timestamp)
  wrappedToken.save()

  // Update existing upcoming payouts for this period to mark as distributed
  updateUpcomingPayoutsForPeriod(
    event.address,
    event.params.period,
    event.params.amount,
    event.params.totalUSDTAtDistribution,
    event.block.timestamp
  )
  
  // Notify all holders about available payout
  notifyHoldersAboutPayout(event.address, event.params.amount, event.block.timestamp)
}

export function handlePayoutClaimed(event: PayoutClaimedEvent): void {
  let user = getOrCreateUser(event.params.user, event.block.timestamp)
  let wrappedToken = WrappedToken.load(event.address)
  if (!wrappedToken) return

  // Update offering payout statistics
  let offering = Offering.load(wrappedToken.offeringAddress)
  if (offering) {
    offering.totalPayoutsClaimed = offering.totalPayoutsClaimed.plus(event.params.amount)
    
    // Update payout status based on claim activity
    if (offering.currentPayoutPeriod.gt(BigInt.fromI32(0))) {
      let periodId = event.address.toHexString() + "-period-" + offering.currentPayoutPeriod.toString()
      let payoutPeriod = PayoutPeriod.load(Bytes.fromUTF8(periodId))
      
      if (payoutPeriod && payoutPeriod.unclaimedAmount.equals(BigInt.fromI32(0))) {
        offering.payoutStatus = "completed"
      } else {
        offering.payoutStatus = "active"
      }
    }
    
    offering.save()
  }

  // Update payout period statistics
  let periodId = event.address.toHexString() + "-period-" + event.params.period.toString()
  let payoutPeriod = PayoutPeriod.load(Bytes.fromUTF8(periodId))
  
  if (payoutPeriod) {
    payoutPeriod.totalClaims = payoutPeriod.totalClaims.plus(BigInt.fromI32(1))
    payoutPeriod.totalClaimedAmount = payoutPeriod.totalClaimedAmount.plus(event.params.amount)
    payoutPeriod.unclaimedAmount = payoutPeriod.distributedAmount.minus(payoutPeriod.totalClaimedAmount)
    
    // Update claim rate
    if (payoutPeriod.distributedAmount.gt(BigInt.fromI32(0))) {
      payoutPeriod.claimRate = payoutPeriod.totalClaimedAmount.times(BigInt.fromI32(10000)).div(payoutPeriod.distributedAmount)
    }
    
    // Update status
    if (payoutPeriod.unclaimedAmount.equals(BigInt.fromI32(0))) {
      payoutPeriod.status = "completed"
    } else {
      payoutPeriod.status = "active"
    }
    
    payoutPeriod.save()
  }
  
  // Update distribution statistics
  let distributionId = event.address.toHexString() + "-" + event.params.period.toString() + "-distribution"
  let distribution = PayoutDistribution.load(Bytes.fromUTF8(distributionId))
  
  if (distribution) {
    // Update claim rate
    let totalClaimed = distribution.amount.minus(payoutPeriod ? payoutPeriod.unclaimedAmount : BigInt.fromI32(0))
    if (distribution.amount.gt(BigInt.fromI32(0))) {
      distribution.claimRate = totalClaimed.times(BigInt.fromI32(10000)).div(distribution.amount)
    }
    
    // Update status
    if (distribution.claimRate.equals(BigInt.fromI32(10000))) {
      distribution.status = "fully_claimed"
    } else if (distribution.claimRate.gt(BigInt.fromI32(0))) {
      distribution.status = "partially_claimed"
    }
    
    distribution.save()
  }
  
  // Update or create upcoming payout record
  let upcomingPayoutId = event.params.user.toHexString() + "-" + event.address.toHexString() + "-" + event.params.period.toString()
  let upcomingPayout = UserUpcomingPayout.load(Bytes.fromUTF8(upcomingPayoutId))
  
  if (upcomingPayout) {
    upcomingPayout.isDistributed = true
    upcomingPayout.isClaimed = true
    upcomingPayout.isClaimable = false
    upcomingPayout.claimedAt = event.block.timestamp
    upcomingPayout.actualPayoutTime = event.block.timestamp
    upcomingPayout.updatedAt = event.block.timestamp
    upcomingPayout.save()
  } else {
    // Create the upcoming payout record if it doesn't exist (shouldn't happen normally)
    upcomingPayout = new UserUpcomingPayout(Bytes.fromUTF8(upcomingPayoutId))
    upcomingPayout.user = event.params.user
    upcomingPayout.userAddress = event.params.user
    upcomingPayout.wrappedToken = event.address
    upcomingPayout.wrappedTokenAddress = event.address
    upcomingPayout.offering = wrappedToken.offeringAddress
    upcomingPayout.offeringAddress = wrappedToken.offeringAddress
    upcomingPayout.periodNumber = event.params.period
    upcomingPayout.estimatedAmount = event.params.amount
    upcomingPayout.isClaimable = false
    upcomingPayout.isDistributed = true
    upcomingPayout.isClaimed = true
    upcomingPayout.actualPayoutTime = event.block.timestamp
    upcomingPayout.claimedAt = event.block.timestamp
    upcomingPayout.createdAt = event.block.timestamp
    upcomingPayout.updatedAt = event.block.timestamp
    
    // Calculate share percentage from the actual claim
    if (payoutPeriod && payoutPeriod.distributedAmount.gt(BigInt.fromI32(0))) {
      upcomingPayout.sharePercentage = event.params.amount.times(BigInt.fromI32(10000)).div(payoutPeriod.distributedAmount)
    } else {
      upcomingPayout.sharePercentage = BigInt.fromI32(0)
    }
    
    upcomingPayout.save()
  }
  // Create user payout record
  let payoutId = event.transaction.hash.concatI32(event.logIndex.toI32())
  let userPayout = new UserPayout(payoutId)
  
  userPayout.user = event.params.user
  userPayout.userAddress = event.params.user
  userPayout.wrappedToken = event.address
  userPayout.wrappedTokenAddress = event.address
  userPayout.offering = wrappedToken.offeringAddress
  userPayout.offeringAddress = wrappedToken.offeringAddress
  userPayout.amount = event.params.amount
  userPayout.payoutToken = wrappedToken.payoutToken
  userPayout.payoutTokenSymbol = wrappedToken.payoutTokenSymbol || ""
  userPayout.payoutPeriodNumber = event.params.period
  userPayout.isPartialClaim = false // Assuming full claim for now
  userPayout.remainingClaimable = BigInt.fromI32(0)
  userPayout.blockNumber = event.block.number
  userPayout.blockTimestamp = event.block.timestamp
  userPayout.transactionHash = event.transaction.hash
  
  // Link to payout distribution and period
  if (distribution) {
    userPayout.payoutDistribution = distribution.id
  }
  
  // Get user's wrapped token balance for share calculation
  let holdingId = event.params.user.toHexString() + "-" + event.address.toHexString()
  let holding = UserWrappedTokenHolding.load(Bytes.fromUTF8(holdingId))
  
  if (holding) {
    userPayout.userWrappedBalance = holding.currentBalance
    userPayout.sharePercentage = holding.currentBalance.times(BigInt.fromI32(10000)).div(wrappedToken.totalSupply)
    
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


  // Update wrapped token stats
  wrappedToken.totalPayoutsClaimed = wrappedToken.totalPayoutsClaimed.plus(event.params.amount)
  wrappedToken.currentPayoutFunds = wrappedToken.currentPayoutFunds.minus(event.params.amount)
  
  // Update payout status
  updatePayoutStatus(wrappedToken, event.block.timestamp)
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

export function handleFirstPayoutDateSet(event: FirstPayoutDateSetEvent): void {
  let wrappedToken = WrappedToken.load(event.address)
  if (!wrappedToken) return

  // Update wrapped token with first payout date
  wrappedToken.firstPayoutDate = event.params.firstPayoutDate
  wrappedToken.nextPayoutTime = event.params.firstPayoutDate
  wrappedToken.isPayoutPeriodAvailable = false // Not available yet, just scheduled
  wrappedToken.payoutStatus = "ready"
  wrappedToken.payoutScheduleStatus = "scheduled"
  
  // Calculate maturity date: firstPayoutDate + (totalPayoutRounds * payoutPeriodDuration)
  wrappedToken.maturityDate = event.params.firstPayoutDate.plus(
    wrappedToken.totalPayoutRounds.times(wrappedToken.payoutPeriodDuration)
  )
  
  // Calculate expected payout amounts now that we have the schedule
  updateExpectedPayoutCalculations(wrappedToken)
  wrappedToken.save()

  // Update linked offering
  let offering = Offering.load(wrappedToken.offeringAddress)
  if (offering) {
    offering.nextPayoutTime = event.params.firstPayoutDate
    offering.maturityDate = wrappedToken.maturityDate
    offering.payoutStatus = "ready"
    offering.save()
  }

  // Create the complete payout schedule
  createPayoutSchedule(wrappedToken, event.block.timestamp)

  // Notify all holders about payout schedule
  notifyHoldersAboutPayoutSchedule(event.address, event.params.firstPayoutDate, event.block.timestamp)
  
  // Update all existing upcoming payouts with the correct estimated payout time
  updateExistingUpcomingPayoutsWithFirstPayoutDate(event.address, event.params.firstPayoutDate, event.block.timestamp)
}

function updateExistingUpcomingPayoutsWithFirstPayoutDate(
  wrappedTokenAddress: Address,
  firstPayoutDate: BigInt,
  timestamp: BigInt
): void {
  // This function would ideally update all existing UserUpcomingPayout entities
  // for this wrapped token to have the correct estimatedPayoutTime
  // In a production system, you might want to implement this differently
  // For now, new upcoming payouts will have the correct timing
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
  wrappedToken.nextPayoutTime = BigInt.fromI32(0) // Initialize to 0
  wrappedToken.isPayoutPeriodAvailable = false
  wrappedToken.totalSupply = BigInt.fromI32(0)
  wrappedToken.totalEscrowed = BigInt.fromI32(0)
  wrappedToken.totalUSDTInvested = BigInt.fromI32(0)
  wrappedToken.totalPayoutFundsDistributed = BigInt.fromI32(0)
  wrappedToken.totalPayoutsClaimed = BigInt.fromI32(0)
  wrappedToken.currentPayoutFunds = BigInt.fromI32(0)
  wrappedToken.requiredPayoutTokens = BigInt.fromI32(0)
  wrappedToken.payoutStatus = "waiting"
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

// Helper function to create upcoming payout for a specific user
function createUpcomingPayoutForUser(
  userAddress: Address,
  wrappedTokenAddress: Address,
  periodNumber: BigInt,
  userUSDTValue: BigInt,
  totalUSDTAtPeriod: BigInt,
  timestamp: BigInt,
  wrappedToken: WrappedToken
): void {
  let upcomingPayoutId = userAddress.toHexString() + "-" + wrappedTokenAddress.toHexString() + "-" + periodNumber.toString()
  let upcomingPayout = UserUpcomingPayout.load(Bytes.fromUTF8(upcomingPayoutId))
  
  if (!upcomingPayout) {
    upcomingPayout = new UserUpcomingPayout(Bytes.fromUTF8(upcomingPayoutId))
    upcomingPayout.user = userAddress
    upcomingPayout.userAddress = userAddress
    upcomingPayout.wrappedToken = wrappedTokenAddress
    upcomingPayout.wrappedTokenAddress = wrappedTokenAddress
    
    // Link to offering
    upcomingPayout.offering = wrappedToken.offeringAddress
    upcomingPayout.offeringAddress = wrappedToken.offeringAddress
    
    upcomingPayout.periodNumber = periodNumber
    upcomingPayout.isClaimable = false
    upcomingPayout.isDistributed = false
    upcomingPayout.isClaimed = false
    upcomingPayout.actualPayoutTime = BigInt.fromI32(0)
    upcomingPayout.claimedAt = BigInt.fromI32(0)
    upcomingPayout.createdAt = timestamp
  }
  
  upcomingPayout.userUSDTValue = userUSDTValue
  upcomingPayout.totalUSDTAtPeriod = totalUSDTAtPeriod
  
  // Calculate share percentage
  if (totalUSDTAtPeriod.gt(BigInt.fromI32(0))) {
    upcomingPayout.sharePercentage = userUSDTValue.times(BigInt.fromI32(10000)).div(totalUSDTAtPeriod)
  } else {
    upcomingPayout.sharePercentage = BigInt.fromI32(0)
  }
  
  // Estimate payout amount based on current APR and period
  let requiredAmount = calculateRequiredPayoutTokens(wrappedToken)
  if (requiredAmount.gt(BigInt.fromI32(0)) && upcomingPayout.sharePercentage.gt(BigInt.fromI32(0))) {
    upcomingPayout.estimatedAmount = requiredAmount.times(upcomingPayout.sharePercentage).div(BigInt.fromI32(10000))
  } else {
    // If no distribution has happened yet, estimate based on user's share
    if (wrappedToken.totalUSDTInvested.gt(BigInt.fromI32(0))) {
      let periodAPR = wrappedToken.payoutAPR.times(wrappedToken.payoutPeriodDuration).div(BigInt.fromI32(365 * 24 * 60 * 60))
      upcomingPayout.estimatedAmount = userUSDTValue.times(periodAPR).div(BigInt.fromI32(10000))
    } else {
      upcomingPayout.estimatedAmount = BigInt.fromI32(0)
    }
  }
  
  // Calculate estimated payout time
  // Use predictable schedule calculation
  if (wrappedToken.firstPayoutDate.gt(BigInt.fromI32(0))) {
    upcomingPayout.expectedPayoutTime = wrappedToken.firstPayoutDate.plus(
      periodNumber.minus(BigInt.fromI32(1)).times(wrappedToken.payoutPeriodDuration)
    )
  } else {
    // Fallback if first payout date not set yet
    upcomingPayout.expectedPayoutTime = timestamp.plus(
      periodNumber.times(wrappedToken.payoutPeriodDuration)
    )
  }
  
  upcomingPayout.updatedAt = timestamp
  upcomingPayout.save()
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

function notifyHoldersAboutPayoutSchedule(
  wrappedTokenAddress: Address, 
  firstPayoutDate: BigInt, 
  timestamp: BigInt
): void {
  // This would notify all holders about payout schedule
  // Implementation would depend on your notification strategy
}

function getTokenSymbol(tokenAddress: Bytes): string {
  if (tokenAddress.equals(Address.zero())) {
    return "ETH"
  }
  
  // Try to get symbol from contract
  return "TOKEN"
}