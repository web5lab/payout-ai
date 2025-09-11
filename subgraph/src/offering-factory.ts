import {
  OfferingDeployed as OfferingDeployedEvent
} from "../generated/OfferingFactory/OfferingFactory"
import { User, Offering } from "../generated/schema"
import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts"
import { getOrCreateUser, updateUserActivity } from "./user-manager"

export function handleOfferingDeployed(event: OfferingDeployedEvent): void {
  let creator = getOrCreateUser(event.params.creator, event.block.timestamp)
  
  // Update creator stats
  creator.totalOfferingsCreated = creator.totalOfferingsCreated.plus(BigInt.fromI32(1))
  creator.save()
  
  // Create offering entity with contract data
  let offering = new Offering(event.params.offeringAddress)

  offering.creator = event.params.creator
  offering.creatorAddress = event.params.creator
  offering.tokenOwner = event.params.tokenOwner
  
  // Initialize with default values
  offering.saleToken = Bytes.empty()
  offering.saleTokenSymbol = "SALE"
  offering.minInvestment = BigInt.fromI32(0)
  offering.maxInvestment = BigInt.fromI32(0)
  offering.startDate = BigInt.fromI32(0)
  offering.endDate = BigInt.fromI32(0)
  offering.maturityDate = BigInt.fromI32(0)
  offering.fundraisingCap = BigInt.fromI32(0)
  offering.softCap = BigInt.fromI32(0)
  offering.tokenPrice = BigInt.fromI32(0)
  offering.autoTransfer = true
  offering.apyEnabled = false
  offering.wrappedTokenAddress = null
  offering.payoutTokenAddress = null
  offering.payoutRate = BigInt.fromI32(0)
  
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
  
  // Try to get symbol from contract
  // This would require binding to ERC20 contract
  return "TOKEN"
}