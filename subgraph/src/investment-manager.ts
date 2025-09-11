import {
  InvestmentRouted as InvestmentRoutedEvent,
  TokensClaimed as TokensClaimedEvent
} from "../generated/InvestmentManager/InvestmentManager"
import { 
  InvestmentRouted, 
  TotalInvestment, 
  TokensClaimed,
  GlobalStats,
  Offering
} from "../generated/schema"
import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts"

export function handleInvestmentRouted(event: InvestmentRoutedEvent): void {
  // Create investment record
  let entity = new InvestmentRouted(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.investor = event.params.investor
  entity.offering = event.params.offeringAddress
  entity.offeringAddress = event.params.offeringAddress // backwards compatibility
  entity.paymentToken = event.params.paymentToken
  entity.paidAmount = event.params.paidAmount
  entity.tokensReceived = event.params.tokensReceived
  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()

  // Update or create total investment record
  let totalInvestmentId = event.params.offeringAddress.toHexString() + "-" + event.params.investor.toHexString()
  let totalInvestment = TotalInvestment.load(Bytes.fromUTF8(totalInvestmentId))

  if (!totalInvestment) {
    totalInvestment = new TotalInvestment(Bytes.fromUTF8(totalInvestmentId))
    totalInvestment.offeringAddress = event.params.offeringAddress
    totalInvestment.userAddress = event.params.investor
    totalInvestment.totalInvestment = BigInt.fromI32(0)
    totalInvestment.latestInvestmentTimestamp = event.block.timestamp
    totalInvestment.claimableTokens = BigInt.fromI32(0)
    totalInvestment.claimedTokens = BigInt.fromI32(0)
    totalInvestment.hasWrappedTokens = false
    totalInvestment.wrappedTokenBalance = BigInt.fromI32(0)
  }

  totalInvestment.totalInvestment = totalInvestment.totalInvestment.plus(event.params.paidAmount)
  totalInvestment.latestInvestmentTimestamp = event.block.timestamp
  totalInvestment.claimableTokens = totalInvestment.claimableTokens.plus(event.params.tokensReceived)
  totalInvestment.save()

  // Update offering statistics
  let offering = Offering.load(event.params.offeringAddress)
  if (offering) {
    offering.totalRaised = offering.totalRaised.plus(event.params.paidAmount)
    offering.save()
  }

  // Update global statistics
  updateGlobalStats(event.block.timestamp, "investment", event.params.paidAmount)
}

export function handleTokensClaimed(event: TokensClaimedEvent): void {
  let entity = new TokensClaimed(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.investor = event.params.investor
  entity.offeringAddress = event.params.offeringAddress
  entity.amount = event.params.amount
  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()

  // Update total investment record
  let totalInvestmentId = event.params.offeringAddress.toHexString() + "-" + event.params.investor.toHexString()
  let totalInvestment = TotalInvestment.load(Bytes.fromUTF8(totalInvestmentId))

  if (totalInvestment) {
    totalInvestment.claimableTokens = totalInvestment.claimableTokens.minus(event.params.amount)
    totalInvestment.claimedTokens = totalInvestment.claimedTokens.plus(event.params.amount)
    totalInvestment.save()
  }

  // Update global statistics
  updateGlobalStats(event.block.timestamp, "claim", event.params.amount)
}

function updateGlobalStats(timestamp: BigInt, type: string, amount: BigInt): void {
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

  if (type == "investment") {
    stats.totalInvestments = stats.totalInvestments.plus(BigInt.fromI32(1))
    stats.totalInvestmentVolume = stats.totalInvestmentVolume.plus(amount)
  } else if (type == "claim") {
    stats.totalFinalClaims = stats.totalFinalClaims.plus(BigInt.fromI32(1))
  }

  stats.lastUpdated = timestamp
  stats.save()
}