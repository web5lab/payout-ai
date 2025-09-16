import {
  Invested as InvestedEvent,
  Claimed as ClaimedEvent,
  SaleClosed as SaleClosedEvent,
  OfferingFinalized as OfferingFinalizedEvent,
  OfferingCancelled as OfferingCancelledEvent,
  SoftCapReached as SoftCapReachedEvent
} from "../generated/templates/Offering/Offering"
import { 
  Offering,
  OfferingPerformance,
  User,
  UserOfferingInvestment,
  WrappedToken
} from "../generated/schema"
import { BigInt, Bytes } from "@graphprotocol/graph-ts"

export function handleInvested(event: InvestedEvent): void {
  let offering = Offering.load(event.address)
  if (!offering) return

  // Update offering statistics - use USD value instead of raw paid amount
  offering.totalRaised = offering.totalRaised.plus(event.params.paidAmount)
  offering.totalTokensDistributed = offering.totalTokensDistributed.plus(event.params.tokensReceived)
  
  // Update investor count (check if this is a new investor)
  let aggregatedId = event.params.investor.toHexString() + "-" + event.address.toHexString()
  let aggregatedInvestment = UserOfferingInvestment.load(Bytes.fromUTF8(aggregatedId))
  
  if (!aggregatedInvestment) {
    // This is a new investor
    offering.totalInvestors = offering.totalInvestors.plus(BigInt.fromI32(1))
  }
  
  offering.save()

  // Update offering performance metrics
  let performance = OfferingPerformance.load(event.address)
  if (!performance) {
    performance = new OfferingPerformance(event.address)
    performance.offering = event.address
    performance.offeringAddress = event.address
    performance.totalInvestors = BigInt.fromI32(0)
    performance.averageInvestmentSize = BigInt.fromI32(0)
    performance.largestInvestment = BigInt.fromI32(0)
    performance.smallestInvestment = BigInt.fromI32(0)
    performance.raisedInFirst24Hours = BigInt.fromI32(0)
    performance.raisedInFirstWeek = BigInt.fromI32(0)
    performance.timeToSoftCap = BigInt.fromI32(0)
    performance.timeToHardCap = BigInt.fromI32(0)
    performance.tokensClaimedPercentage = BigInt.fromI32(0)
    performance.refundedPercentage = BigInt.fromI32(0)
    performance.totalPayoutsDistributed = BigInt.fromI32(0)
    performance.averagePayoutPerUser = BigInt.fromI32(0)
    performance.emergencyUnlockRate = BigInt.fromI32(0)
    performance.lastUpdated = event.block.timestamp
  }

  // Update performance metrics
  performance.totalInvestors = performance.totalInvestors.plus(BigInt.fromI32(1))
  
  // Update largest/smallest investment
  if (performance.largestInvestment.lt(event.params.paidAmount)) {
    performance.largestInvestment = event.params.paidAmount
  }
  if (performance.smallestInvestment.equals(BigInt.fromI32(0)) || 
      performance.smallestInvestment.gt(event.params.paidAmount)) {
    performance.smallestInvestment = event.params.paidAmount
  }
  
  // Calculate average investment size
  if (performance.totalInvestors.gt(BigInt.fromI32(0))) {
    performance.averageInvestmentSize = offering.totalRaised.div(performance.totalInvestors)
  }
  
  // Track early fundraising performance
  let timeSinceStart = event.block.timestamp.minus(offering.startDate)
  let oneDay = BigInt.fromI32(24 * 60 * 60)
  let oneWeek = BigInt.fromI32(7 * 24 * 60 * 60)
  
  if (timeSinceStart.le(oneDay)) {
    performance.raisedInFirst24Hours = offering.totalRaised
  }
  if (timeSinceStart.le(oneWeek)) {
    performance.raisedInFirstWeek = offering.totalRaised
  }
  
  performance.lastUpdated = event.block.timestamp
  performance.save()

  // Check if this investment triggers soft cap
  if (!offering.softCapReached && offering.totalRaised.ge(offering.softCap)) {
    offering.softCapReached = true
    performance.timeToSoftCap = event.block.timestamp.minus(offering.startDate)
    offering.save()
    performance.save()
  }
  
  // Check if this investment triggers hard cap
  if (offering.totalRaised.ge(offering.fundraisingCap)) {
    performance.timeToHardCap = event.block.timestamp.minus(offering.startDate)
    performance.save()
  }
}

export function handleClaimed(event: ClaimedEvent): void {
  let offering = Offering.load(event.address)
  if (!offering) return

  // Update offering performance
  let performance = OfferingPerformance.load(event.address)
  if (performance) {
    // Calculate tokens claimed percentage
    if (offering.totalTokensDistributed.gt(BigInt.fromI32(0))) {
      let totalClaimed = offering.totalTokensDistributed // This would need to be tracked separately
      performance.tokensClaimedPercentage = totalClaimed
        .times(BigInt.fromI32(10000))
        .div(offering.totalTokensDistributed)
    }
    
    performance.lastUpdated = event.block.timestamp
    performance.save()
  }
}

export function handleSaleClosed(event: SaleClosedEvent): void {
  let offering = Offering.load(event.address)
  if (!offering) return

  offering.isActive = false
  offering.totalRaised = event.params.totalRaised
  offering.save()
}

export function handleOfferingFinalized(event: OfferingFinalizedEvent): void {
  let offering = Offering.load(event.address)
  if (!offering) return

  offering.isFinalized = true
  offering.finalizedAt = event.params.timestamp
  
  // Initialize payout system for APY-enabled offerings
  if (offering.apyEnabled && offering.wrappedTokenAddress) {
    offering.currentPayoutPeriod = BigInt.fromI32(0)
    offering.totalPayoutDistributions = BigInt.fromI32(0)
    offering.totalPayoutVolume = BigInt.fromI32(0)
    offering.totalPayoutsClaimed = BigInt.fromI32(0)
    
    // Set initial payout status - will be updated when first payout date is set
    offering.payoutStatus = "ready"
    offering.nextPayoutTime = BigInt.fromI32(0)
    
    // Initialize predictable payout tracking
    offering.payoutScheduleCreated = false
    offering.completedPayoutRounds = BigInt.fromI32(0)
    
    // The wrapped token's setFirstPayoutDate() will be called after this event
    // We'll create the complete payout schedule when that happens
  } else {
    // Non-APY offerings don't have payouts
    offering.payoutStatus = "not_applicable"
    offering.nextPayoutTime = BigInt.fromI32(0)
    offering.payoutScheduleCreated = false
  }
  
  offering.save()
}

export function handleOfferingCancelled(event: OfferingCancelledEvent): void {
  let offering = Offering.load(event.address)
  if (!offering) return

  offering.isCancelled = true
  offering.isActive = false
  offering.cancelledAt = event.params.timestamp
  offering.save()
}

export function handleSoftCapReached(event: SoftCapReachedEvent): void {
  let offering = Offering.load(event.address)
  if (!offering) return

  offering.softCapReached = true
  offering.save()

  // Update performance metrics
  let performance = OfferingPerformance.load(event.address)
  if (performance) {
    performance.timeToSoftCap = event.block.timestamp.minus(offering.startDate)
    performance.save()
  }
}