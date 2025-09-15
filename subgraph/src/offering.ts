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
  User
} from "../generated/schema"
import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { 
  createUserNotification
} from "./user-manager"

export function handleInvested(event: InvestedEvent): void {
  let offering = Offering.load(event.address)
  if (!offering) return

  // Update offering statistics
  offering.totalRaised = offering.totalRaised.plus(event.params.paidAmount)
  offering.totalTokensDistributed = offering.totalTokensDistributed.plus(event.params.tokensReceived)
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
    
    // Notify creator about soft cap reached
    createUserNotification(
      offering.creatorAddress,
      "soft_cap_reached",
      "Soft Cap Reached!",
      "Your offering has reached its soft cap of " + offering.softCap.toString() + "!",
      "high",
      event.block.timestamp,
      event.address
    )
  }
  
  // Check if this investment triggers hard cap
  if (offering.totalRaised.ge(offering.fundraisingCap)) {
    performance.timeToHardCap = event.block.timestamp.minus(offering.startDate)
    performance.save()
    
    // Notify creator about hard cap reached
    createUserNotification(
      offering.creatorAddress,
      "hard_cap_reached",
      "Hard Cap Reached!",
      "Your offering has reached its fundraising cap! The sale will close automatically.",
      "urgent",
      event.block.timestamp,
      event.address
    )
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

  // Notify creator about sale closure
  createUserNotification(
    offering.creatorAddress,
    "sale_closed",
    "Sale Closed",
    "Your offering sale has closed with total raised: " + event.params.totalRaised.toString(),
    "high",
    event.block.timestamp,
    event.address
  )
}

export function handleOfferingFinalized(event: OfferingFinalizedEvent): void {
  let offering = Offering.load(event.address)
  if (!offering) return

  offering.isFinalized = true
  offering.finalizedAt = event.params.timestamp
  offering.save()
  
  // Notify creator about finalization
  createUserNotification(
    offering.creatorAddress,
    "offering_finalized",
    "Offering Finalized",
    "Your offering has been finalized. Funds are now available for withdrawal.",
    "high",
    event.block.timestamp,
    event.address
  )
}

export function handleOfferingCancelled(event: OfferingCancelledEvent): void {
  let offering = Offering.load(event.address)
  if (!offering) return

  offering.isCancelled = true
  offering.isActive = false
  offering.cancelledAt = event.params.timestamp
  offering.save()

  // Notify creator about cancellation
  createUserNotification(
    offering.creatorAddress,
    "offering_cancelled",
    "Offering Cancelled",
    "Your offering has been cancelled. Refunds are now enabled for all investors.",
    "urgent",
    event.block.timestamp,
    event.address
  )
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
  
  // Notify creator
  createUserNotification(
    offering.creatorAddress,
    "soft_cap_reached",
    "Soft Cap Achieved!",
    "Congratulations! Your offering has reached its soft cap of " + event.params.softCap.toString(),
    "high",
    event.block.timestamp,
    event.address
  )
}