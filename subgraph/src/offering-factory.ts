import {
  OfferingDeployed as OfferingDeployedEvent
} from "../generated/OfferingFactory/OfferingFactory"
import { 
  User,
  Offering,
  OfferingDeployment,
  OfferingPerformance,
  GlobalStats
} from "../generated/schema"
import { Offering as OfferingTemplate } from "../generated/templates"
import { Offering as OfferingContract } from "../generated/OfferingFactory/Offering"
import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts"
import { 
  getOrCreateUser, 
  updateUserActivity, 
  updateGlobalStats,
  createUserNotification
} from "./user-manager"

export function handleOfferingDeployed(event: OfferingDeployedEvent): void {
  let creator = getOrCreateUser(event.params.creator, event.block.timestamp)
  
  // Update creator stats
  creator.totalOfferingsCreated = creator.totalOfferingsCreated.plus(BigInt.fromI32(1))
  creator.save()
  
  // Create offering deployment record
  let deploymentId = event.transaction.hash.concatI32(event.logIndex.toI32())
  let deployment = new OfferingDeployment(deploymentId)
  
  deployment.offeringId = event.params.offeringId
  deployment.creator = event.params.creator
  deployment.creatorAddress = event.params.creator
  deployment.offering = event.params.offeringAddress
  deployment.offeringAddress = event.params.offeringAddress
  deployment.tokenOwner = event.params.tokenOwner
  deployment.blockNumber = event.block.number
  deployment.blockTimestamp = event.block.timestamp
  deployment.transactionHash = event.transaction.hash
  
  deployment.save()

  // Create offering entity with contract data
  let offering = new Offering(event.params.offeringAddress)
  let offeringContract = OfferingContract.bind(event.params.offeringAddress)

  // Get contract data safely
  offering.creator = event.params.creator
  offering.creatorAddress = event.params.creator
  offering.tokenOwner = event.params.tokenOwner
  
  // Try to get contract data
  let saleTokenResult = offeringContract.try_saleToken()
  let minInvestmentResult = offeringContract.try_minInvestment()
  let maxInvestmentResult = offeringContract.try_maxInvestment()
  let startDateResult = offeringContract.try_startDate()
  let endDateResult = offeringContract.try_endDate()
  let fundraisingCapResult = offeringContract.try_fundraisingCap()
  let softCapResult = offeringContract.try_softCap()
  let tokenPriceResult = offeringContract.try_tokenPrice()
  let apyEnabledResult = offeringContract.try_apyEnabled()
  let wrappedTokenAddressResult = offeringContract.try_wrappedTokenAddress()
  let payoutTokenAddressResult = offeringContract.try_payoutTokenAddress()
  let payoutRateResult = offeringContract.try_payoutRate()

  offering.saleToken = saleTokenResult.reverted ? Bytes.empty() : saleTokenResult.value
  offering.saleTokenSymbol = getTokenSymbol(offering.saleToken)
  offering.minInvestment = minInvestmentResult.reverted ? BigInt.fromI32(0) : minInvestmentResult.value
  offering.maxInvestment = maxInvestmentResult.reverted ? BigInt.fromI32(0) : maxInvestmentResult.value
  offering.startDate = startDateResult.reverted ? BigInt.fromI32(0) : startDateResult.value
  offering.endDate = endDateResult.reverted ? BigInt.fromI32(0) : endDateResult.value
  offering.maturityDate = offering.endDate.plus(BigInt.fromI32(30 * 24 * 60 * 60)) // Default 30 days after end
  offering.fundraisingCap = fundraisingCapResult.reverted ? BigInt.fromI32(0) : fundraisingCapResult.value
  offering.softCap = softCapResult.reverted ? BigInt.fromI32(0) : softCapResult.value
  offering.tokenPrice = tokenPriceResult.reverted ? BigInt.fromI32(0) : tokenPriceResult.value
  offering.autoTransfer = true // Default assumption
  offering.apyEnabled = apyEnabledResult.reverted ? false : apyEnabledResult.value
  offering.wrappedTokenAddress = wrappedTokenAddressResult.reverted ? null : wrappedTokenAddressResult.value
  offering.payoutTokenAddress = payoutTokenAddressResult.reverted ? null : payoutTokenAddressResult.value
  offering.payoutRate = payoutRateResult.reverted ? BigInt.fromI32(0) : payoutRateResult.value
  
  // Initialize status
  offering.isActive = true
  offering.isFinalized = false
  offering.isCancelled = false
  offering.softCapReached = false
  
  // Initialize statistics
  offering.totalRaised = BigInt.fromI32(0)
  offering.totalInvestors = BigInt.fromI32(0)
  offering.totalTokensDistributed = BigInt.fromI32(0)
  offering.totalRefunded = BigInt.fromI32(0)
  
  // Set timestamps
  offering.createdAt = event.block.timestamp
  offering.createdBlock = event.block.number
  
  offering.save()

  // Create offering performance tracking
  let performance = new OfferingPerformance(event.params.offeringAddress)
  performance.offering = event.params.offeringAddress
  performance.offeringAddress = event.params.offeringAddress
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
  performance.save()

  // Start indexing this offering contract
  OfferingTemplate.create(event.params.offeringAddress)

  // Update user activity
  updateUserActivity(
    event.params.creator,
    "offering_created",
    BigInt.fromI32(0),
    offering.saleToken,
    event.block.timestamp,
    event.block.number,
    event.transaction.hash,
    "Created new offering: " + event.params.offeringAddress.toHexString(),
    event.params.offeringAddress
  )

  // Update global statistics
  updateGlobalStats("offering", BigInt.fromI32(1), event.block.timestamp)
  
  // Create offering creation notification
  createUserNotification(
    event.params.creator,
    "offering_created",
    "Offering Created Successfully!",
    "Your offering has been deployed and is ready for configuration. Address: " + event.params.offeringAddress.toHexString(),
    "high",
    event.block.timestamp,
    event.params.offeringAddress
  )
}

function getTokenSymbol(tokenAddress: Bytes): string {
  if (tokenAddress.equals(Address.zero())) {
    return "ETH"
  }
  
  // Try to get symbol from contract
  // This would require binding to ERC20 contract
  return "TOKEN"
}