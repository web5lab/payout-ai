import {
  OfferingDeployed as OfferingDeployedEvent
} from "../generated/OfferingFactory/OfferingFactory"
import { 
  OfferingDeployed,
  Offering,
  GlobalStats
} from "../generated/schema"
import { Offering as OfferingTemplate } from "../generated/templates"
import { Offering as OfferingContract } from "../generated/OfferingFactory/Offering"
import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts"

export function handleOfferingDeployed(event: OfferingDeployedEvent): void {
  // Create offering deployed record
  let entity = new OfferingDeployed(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.offeringId = event.params.offeringId
  entity.creator = event.params.creator
  entity.offeringAddress = event.params.offeringAddress
  entity.tokenOwner = event.params.tokenOwner
  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()

  // Create offering entity with contract data
  let offering = new Offering(event.params.offeringAddress)
  let offeringContract = OfferingContract.bind(event.params.offeringAddress)

  // Try to get contract data (use try/catch for safety)
  let saleTokenResult = offeringContract.try_saleToken()
  let minInvestmentResult = offeringContract.try_minInvestment()
  let maxInvestmentResult = offeringContract.try_maxInvestment()
  let startDateResult = offeringContract.try_startDate()
  let endDateResult = offeringContract.try_endDate()
  let maturityDateResult = offeringContract.try_maturityDate()
  let fundraisingCapResult = offeringContract.try_fundraisingCap()
  let tokenPriceResult = offeringContract.try_tokenPrice()
  let autoTransferResult = offeringContract.try_autoTransfer()
  let apyEnabledResult = offeringContract.try_apyEnabled()
  let wrappedTokenAddressResult = offeringContract.try_wrappedTokenAddress()
  let payoutTokenAddressResult = offeringContract.try_payoutTokenAddress()
  let payoutRateResult = offeringContract.try_payoutRate()

  offering.saleToken = saleTokenResult.reverted ? Bytes.empty() : saleTokenResult.value
  offering.tokenOwner = event.params.tokenOwner
  offering.minInvestment = minInvestmentResult.reverted ? BigInt.fromI32(0) : minInvestmentResult.value
  offering.maxInvestment = maxInvestmentResult.reverted ? BigInt.fromI32(0) : maxInvestmentResult.value
  offering.startDate = startDateResult.reverted ? BigInt.fromI32(0) : startDateResult.value
  offering.endDate = endDateResult.reverted ? BigInt.fromI32(0) : endDateResult.value
  offering.maturityDate = maturityDateResult.reverted ? BigInt.fromI32(0) : maturityDateResult.value
  offering.fundraisingCap = fundraisingCapResult.reverted ? BigInt.fromI32(0) : fundraisingCapResult.value
  offering.tokenPrice = tokenPriceResult.reverted ? BigInt.fromI32(0) : tokenPriceResult.value
  offering.totalRaised = BigInt.fromI32(0)
  offering.autoTransfer = autoTransferResult.reverted ? false : autoTransferResult.value
  offering.apyEnabled = apyEnabledResult.reverted ? false : apyEnabledResult.value
  offering.wrappedTokenAddress = wrappedTokenAddressResult.reverted ? null : wrappedTokenAddressResult.value
  offering.payoutTokenAddress = payoutTokenAddressResult.reverted ? null : payoutTokenAddressResult.value
  offering.payoutRate = payoutRateResult.reverted ? BigInt.fromI32(0) : payoutRateResult.value
  offering.isActive = true
  offering.totalInvestors = BigInt.fromI32(0)
  offering.createdAt = event.block.timestamp
  offering.createdBlock = event.block.number
  offering.save()

  // Start indexing this offering contract
  OfferingTemplate.create(event.params.offeringAddress)

  // Update global statistics
  let stats = GlobalStats.load(Bytes.fromUTF8("global"))
  if (!stats) {
    stats = new GlobalStats(Bytes.fromUTF8("global"))
    stats.totalOfferings = BigInt.fromI32(0)
    stats.totalWrappedTokens = BigInt.fromI32(0)
    stats.totalInvestments = BigInt.fromI32(0)
    stats.totalInvestmentVolume = BigInt.fromI32(0)
    stats.totalPayoutFunds = BigInt.fromI32(0)
    stats.totalPayoutsClaimed = BigInt.fromI32(0)
    stats.totalEmergencyUnlocks = BigInt.fromI32(0)
    stats.totalFinalClaims = BigInt.fromI32(0)
  }

  stats.totalOfferings = stats.totalOfferings.plus(BigInt.fromI32(1))
  stats.lastUpdated = event.block.timestamp
  stats.save()
}