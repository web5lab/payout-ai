import {
  OfferingDeployed as OfferingDeployedEvent
} from "../generated/OfferingFactory/OfferingFactory"
import { Offering as OfferingContract } from "../generated/OfferingFactory/Offering"
import { User, Offering, OfferingDeployment } from "../generated/schema"
import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts"
import { getOrCreateUser, updateUserActivity } from "./user-manager"
import { Offering as OfferingTemplate } from "../generated/templates"

export function handleOfferingDeployed(event: OfferingDeployedEvent): void {
  let creator = getOrCreateUser(event.params.creator, event.block.timestamp)
  
  // Update creator stats
  creator.totalOfferingsCreated = creator.totalOfferingsCreated.plus(BigInt.fromI32(1))
  creator.save()
  
  // Create template to track offering events
  OfferingTemplate.create(event.params.offeringAddress)
  
  // Bind to the actual offering contract to read real data
  let offeringContract = OfferingContract.bind(event.params.offeringAddress)
  
  // Create offering entity with contract data
  let offering = new Offering(event.params.offeringAddress)

  offering.creator = event.params.creator
  offering.creatorAddress = event.params.creator
  offering.tokenOwner = event.params.tokenOwner
  
  // Read actual contract data
  let saleTokenResult = offeringContract.try_saleToken()
  offering.saleToken = saleTokenResult.reverted ? Bytes.empty() : saleTokenResult.value
  offering.saleTokenSymbol = getTokenSymbol(offering.saleToken)
  
  let minInvestmentResult = offeringContract.try_minInvestment()
  offering.minInvestment = minInvestmentResult.reverted ? BigInt.fromI32(0) : minInvestmentResult.value
  
  let maxInvestmentResult = offeringContract.try_maxInvestment()
  offering.maxInvestment = maxInvestmentResult.reverted ? BigInt.fromI32(0) : maxInvestmentResult.value
  
  let startDateResult = offeringContract.try_startDate()
  offering.startDate = startDateResult.reverted ? BigInt.fromI32(0) : startDateResult.value
  
  let endDateResult = offeringContract.try_endDate()
  offering.endDate = endDateResult.reverted ? BigInt.fromI32(0) : endDateResult.value
  
  let fundraisingCapResult = offeringContract.try_fundraisingCap()
  offering.fundraisingCap = fundraisingCapResult.reverted ? BigInt.fromI32(0) : fundraisingCapResult.value
  
  let softCapResult = offeringContract.try_softCap()
  offering.softCap = softCapResult.reverted ? BigInt.fromI32(0) : softCapResult.value
  
  let tokenPriceResult = offeringContract.try_tokenPrice()
  offering.tokenPrice = tokenPriceResult.reverted ? BigInt.fromI32(0) : tokenPriceResult.value
  
  let totalRaisedResult = offeringContract.try_totalRaised()
  offering.totalRaised = totalRaisedResult.reverted ? BigInt.fromI32(0) : totalRaisedResult.value
  
  let apyEnabledResult = offeringContract.try_apyEnabled()
  offering.apyEnabled = apyEnabledResult.reverted ? false : apyEnabledResult.value
  
  let wrappedTokenResult = offeringContract.try_wrappedTokenAddress()
  offering.wrappedTokenAddress = wrappedTokenResult.reverted ? null : wrappedTokenResult.value
  
  let payoutTokenResult = offeringContract.try_payoutTokenAddress()
  offering.payoutTokenAddress = payoutTokenResult.reverted ? null : payoutTokenResult.value
  
  let payoutRateResult = offeringContract.try_payoutRate()
  offering.payoutRate = payoutRateResult.reverted ? BigInt.fromI32(0) : payoutRateResult.value
  
  // Set maturity date (this might need to be read from wrapped token if APY enabled)
  offering.maturityDate = offering.endDate // Default to end date, can be updated later
  
  // Set autoTransfer based on contract logic (typically true for most offerings)
  offering.autoTransfer = true
  
  // Initialize status
  offering.isActive = true
  offering.isFinalized = false
  offering.isCancelled = false
  offering.softCapReached = false
  
  // Initialize statistics
  offering.totalInvestors = BigInt.fromI32(0)
  offering.totalTokensDistributed = BigInt.fromI32(0)
  offering.totalRefunded = BigInt.fromI32(0)
  
  // Set timestamps
  offering.createdAt = event.block.timestamp
  offering.createdBlock = event.block.number
  
  offering.save()

  // Create offering deployment record
  let deploymentId = event.transaction.hash.concatI32(event.logIndex.toI32())
  let deployment = new OfferingDeployment(deploymentId)
  deployment.offeringId = event.params.offeringId
  deployment.creator = event.params.creator
  deployment.creatorAddress = event.params.creator
  deployment.offeringAddress = event.params.offeringAddress
  deployment.tokenOwner = event.params.tokenOwner
  deployment.blockNumber = event.block.number
  deployment.blockTimestamp = event.block.timestamp
  deployment.transactionHash = event.transaction.hash
  deployment.save()
  
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
}

function getTokenSymbol(tokenAddress: Bytes): string {
  if (tokenAddress.equals(Address.zero())) {
    return "ETH"
  }
  
  // For now return a generic symbol, could be enhanced with ERC20 binding
  return "TOKEN"
}