import {
  WrappedTokenDeployed as WrappedTokenDeployedEvent
} from "../generated/WrappedTokenFactory/WrappedTokenFactory"
import { WRAPEDTOKEN as WrappedTokenContract } from "../generated/WrappedTokenFactory/WRAPEDTOKEN"
import { User, WrappedToken, WrappedTokenDeployment } from "../generated/schema"
import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts"
import { getOrCreateUser, updateUserActivity } from "./user-manager"
import { WRAPEDTOKEN as WrappedTokenTemplate } from "../generated/templates"

export function handleWrappedTokenDeployed(event: WrappedTokenDeployedEvent): void {
  let creator = getOrCreateUser(event.params.creator, event.block.timestamp)
  
  // Create template to track wrapped token events
  WrappedTokenTemplate.create(event.params.wrappedTokenAddress)
  
  // Bind to the actual wrapped token contract to read real data
  let wrappedTokenContract = WrappedTokenContract.bind(event.params.wrappedTokenAddress)
  
  // Create wrapped token entity with contract data
  let wrappedToken = new WrappedToken(event.params.wrappedTokenAddress)

  // Read actual contract data
  let nameResult = wrappedTokenContract.try_name()
  wrappedToken.name = nameResult.reverted ? "Wrapped Token" : nameResult.value
  
  let symbolResult = wrappedTokenContract.try_symbol()
  wrappedToken.symbol = symbolResult.reverted ? "wTKN" : symbolResult.value
  
  wrappedToken.offering = event.params.offeringContract
  wrappedToken.offeringAddress = event.params.offeringContract
  
  let peggedTokenResult = wrappedTokenContract.try_peggedToken()
  wrappedToken.peggedToken = peggedTokenResult.reverted ? Bytes.empty() : peggedTokenResult.value
  
  let payoutTokenResult = wrappedTokenContract.try_payoutToken()
  wrappedToken.payoutToken = payoutTokenResult.reverted ? Bytes.empty() : payoutTokenResult.value
  wrappedToken.payoutTokenSymbol = getTokenSymbol(wrappedToken.payoutToken)
  
  let maturityDateResult = wrappedTokenContract.try_maturityDate()
  wrappedToken.maturityDate = maturityDateResult.reverted ? BigInt.fromI32(0) : maturityDateResult.value
  
  let payoutAPRResult = wrappedTokenContract.try_payoutAPR()
  wrappedToken.payoutAPR = payoutAPRResult.reverted ? BigInt.fromI32(0) : payoutAPRResult.value
  
  let payoutPeriodDurationResult = wrappedTokenContract.try_payoutPeriodDuration()
  wrappedToken.payoutPeriodDuration = payoutPeriodDurationResult.reverted ? BigInt.fromI32(0) : payoutPeriodDurationResult.value
  
  let firstPayoutDateResult = wrappedTokenContract.try_firstPayoutDate()
  wrappedToken.firstPayoutDate = firstPayoutDateResult.reverted ? BigInt.fromI32(0) : firstPayoutDateResult.value
  
  let currentPayoutPeriodResult = wrappedTokenContract.try_currentPayoutPeriod()
  wrappedToken.currentPayoutPeriod = currentPayoutPeriodResult.reverted ? BigInt.fromI32(0) : currentPayoutPeriodResult.value
  
  wrappedToken.lastPayoutDistributionTime = BigInt.fromI32(0) // This will be updated on first distribution
  
  let totalSupplyResult = wrappedTokenContract.try_totalSupply()
  wrappedToken.totalSupply = totalSupplyResult.reverted ? BigInt.fromI32(0) : totalSupplyResult.value
  
  let totalEscrowedResult = wrappedTokenContract.try_totalEscrowed()
  wrappedToken.totalEscrowed = totalEscrowedResult.reverted ? BigInt.fromI32(0) : totalEscrowedResult.value
  
  let totalUSDTInvestedResult = wrappedTokenContract.try_totalUSDTInvested()
  wrappedToken.totalUSDTInvested = totalUSDTInvestedResult.reverted ? BigInt.fromI32(0) : totalUSDTInvestedResult.value
  
  wrappedToken.totalPayoutFundsDistributed = BigInt.fromI32(0)
  wrappedToken.totalPayoutsClaimed = BigInt.fromI32(0)
  wrappedToken.currentPayoutFunds = BigInt.fromI32(0)
  
  let emergencyUnlockEnabledResult = wrappedTokenContract.try_emergencyUnlockEnabled()
  wrappedToken.emergencyUnlockEnabled = emergencyUnlockEnabledResult.reverted ? false : emergencyUnlockEnabledResult.value
  
  let emergencyUnlockPenaltyResult = wrappedTokenContract.try_emergencyUnlockPenalty()
  wrappedToken.emergencyUnlockPenalty = emergencyUnlockPenaltyResult.reverted ? BigInt.fromI32(0) : emergencyUnlockPenaltyResult.value
  
  wrappedToken.totalEmergencyUnlocks = BigInt.fromI32(0)
  wrappedToken.totalHolders = BigInt.fromI32(0)
  wrappedToken.activeHolders = BigInt.fromI32(0)
  wrappedToken.createdAt = event.block.timestamp
  wrappedToken.createdBlock = event.block.number
  
  wrappedToken.save()

  // Create wrapped token deployment record
  let deploymentId = event.transaction.hash.concatI32(event.logIndex.toI32())
  let deployment = new WrappedTokenDeployment(deploymentId)
  deployment.tokenId = event.params.tokenId
  deployment.creator = event.params.creator
  deployment.creatorAddress = event.params.creator
  deployment.wrappedTokenAddress = event.params.wrappedTokenAddress
  deployment.offeringContract = event.params.offeringContract
  deployment.blockNumber = event.block.number
  deployment.blockTimestamp = event.block.timestamp
  deployment.transactionHash = event.transaction.hash
  deployment.save()
  
  // Update user activity
  updateUserActivity(
    event.params.creator,
    "wrapped_token_created",
    BigInt.fromI32(0),
    wrappedToken.peggedToken,
    event.block.timestamp,
    event.block.number,
    event.transaction.hash,
    "Created wrapped token: " + wrappedToken.name,
    event.params.offeringContract,
    event.params.wrappedTokenAddress
  )
}

function getTokenSymbol(tokenAddress: Bytes): string {
  if (tokenAddress.equals(Address.zero())) {
    return "ETH"
  }
  
  // For now return a generic symbol, could be enhanced with ERC20 binding
  return "TOKEN"
}