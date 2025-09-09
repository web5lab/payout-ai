import {
  WrappedTokenDeployed as WrappedTokenDeployedEvent
} from "../generated/WrappedTokenFactory/WrappedTokenFactory"
import { 
  WrappedTokenDeployed,
  WrappedToken,
  GlobalStats
} from "../generated/schema"
import { WRAPEDTOKEN as WrappedTokenTemplate } from "../generated/templates"
import { WRAPEDTOKEN as WrappedTokenContract } from "../generated/WrappedTokenFactory/WRAPEDTOKEN"
import { BigInt, Bytes } from "@graphprotocol/graph-ts"

export function handleWrappedTokenDeployed(event: WrappedTokenDeployedEvent): void {
  // Create wrapped token deployed record
  let entity = new WrappedTokenDeployed(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.tokenId = event.params.tokenId
  entity.creator = event.params.creator
  entity.wrappedTokenAddress = event.params.wrappedTokenAddress
  entity.offeringContract = event.params.offeringContract
  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()

  // Create wrapped token entity with contract data
  let wrappedToken = new WrappedToken(event.params.wrappedTokenAddress)
  let wrappedTokenContract = WrappedTokenContract.bind(event.params.wrappedTokenAddress)

  // Get contract data (use try/catch for safety)
  let nameResult = wrappedTokenContract.try_name()
  let symbolResult = wrappedTokenContract.try_symbol()
  let peggedTokenResult = wrappedTokenContract.try_peggedToken()
  let payoutTokenResult = wrappedTokenContract.try_payoutToken()
  let maturityDateResult = wrappedTokenContract.try_maturityDate()
  let payoutRateResult = wrappedTokenContract.try_payoutRate()
  let totalSupplyResult = wrappedTokenContract.try_totalSupply()
  let totalEscrowedResult = wrappedTokenContract.try_totalEscrowed()
  let totalPayoutFundsResult = wrappedTokenContract.try_totalPayoutFunds()
  let emergencyUnlockEnabledResult = wrappedTokenContract.try_emergencyUnlockEnabled()
  let emergencyUnlockPenaltyResult = wrappedTokenContract.try_emergencyUnlockPenalty()

  wrappedToken.name = nameResult.reverted ? "" : nameResult.value
  wrappedToken.symbol = symbolResult.reverted ? "" : symbolResult.value
  wrappedToken.peggedToken = peggedTokenResult.reverted ? Bytes.empty() : peggedTokenResult.value
  wrappedToken.payoutToken = payoutTokenResult.reverted ? Bytes.empty() : payoutTokenResult.value
  wrappedToken.maturityDate = maturityDateResult.reverted ? BigInt.fromI32(0) : maturityDateResult.value
  wrappedToken.payoutRate = payoutRateResult.reverted ? BigInt.fromI32(0) : payoutRateResult.value
  wrappedToken.offeringContract = event.params.offeringContract
  wrappedToken.totalSupply = totalSupplyResult.reverted ? BigInt.fromI32(0) : totalSupplyResult.value
  wrappedToken.totalEscrowed = totalEscrowedResult.reverted ? BigInt.fromI32(0) : totalEscrowedResult.value
  wrappedToken.totalPayoutFunds = totalPayoutFundsResult.reverted ? BigInt.fromI32(0) : totalPayoutFundsResult.value
  wrappedToken.emergencyUnlockEnabled = emergencyUnlockEnabledResult.reverted ? false : emergencyUnlockEnabledResult.value
  wrappedToken.emergencyUnlockPenalty = emergencyUnlockPenaltyResult.reverted ? BigInt.fromI32(0) : emergencyUnlockPenaltyResult.value
  wrappedToken.createdAt = event.block.timestamp
  wrappedToken.createdBlock = event.block.number
  wrappedToken.save()

  // Start indexing this wrapped token contract
  WrappedTokenTemplate.create(event.params.wrappedTokenAddress)

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

  stats.totalWrappedTokens = stats.totalWrappedTokens.plus(BigInt.fromI32(1))
  stats.lastUpdated = event.block.timestamp
  stats.save()
}