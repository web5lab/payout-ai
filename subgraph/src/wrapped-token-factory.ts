import {
  WrappedTokenDeployed as WrappedTokenDeployedEvent
} from "../generated/WrappedTokenFactory/WrappedTokenFactory"
import { 
  User,
  WrappedToken,
  WrappedTokenDeployment,
  GlobalStats
} from "../generated/schema"
import { WRAPEDTOKEN as WrappedTokenTemplate } from "../generated/templates"
import { WRAPEDTOKEN as WrappedTokenContract } from "../generated/WrappedTokenFactory/WRAPEDTOKEN"
import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { 
  getOrCreateUser, 
  updateUserActivity, 
  updateGlobalStats,
  createUserNotification
} from "./user-manager"

export function handleWrappedTokenDeployed(event: WrappedTokenDeployedEvent): void {
  let creator = getOrCreateUser(event.params.creator, event.block.timestamp)
  
  // Create wrapped token deployment record
  let deploymentId = event.transaction.hash.concatI32(event.logIndex.toI32())
  let deployment = new WrappedTokenDeployment(deploymentId)
  
  deployment.tokenId = event.params.tokenId
  deployment.creator = event.params.creator
  deployment.creatorAddress = event.params.creator
  deployment.wrappedToken = event.params.wrappedTokenAddress
  deployment.wrappedTokenAddress = event.params.wrappedTokenAddress
  deployment.offeringContract = event.params.offeringContract
  deployment.blockNumber = event.block.number
  deployment.blockTimestamp = event.block.timestamp
  deployment.transactionHash = event.transaction.hash
  
  deployment.save()

  // Create wrapped token entity with contract data
  let wrappedToken = new WrappedToken(event.params.wrappedTokenAddress)
  let wrappedTokenContract = WrappedTokenContract.bind(event.params.wrappedTokenAddress)

  // Get contract data safely
  let nameResult = wrappedTokenContract.try_name()
  let symbolResult = wrappedTokenContract.try_symbol()
  let peggedTokenResult = wrappedTokenContract.try_peggedToken()
  let payoutTokenResult = wrappedTokenContract.try_payoutToken()
  let maturityDateResult = wrappedTokenContract.try_maturityDate()
  let payoutAPRResult = wrappedTokenContract.try_payoutAPR()
  let payoutPeriodDurationResult = wrappedTokenContract.try_payoutPeriodDuration()
  let firstPayoutDateResult = wrappedTokenContract.try_firstPayoutDate()
  let currentPayoutPeriodResult = wrappedTokenContract.try_currentPayoutPeriod()
  let totalSupplyResult = wrappedTokenContract.try_totalSupply()
  let totalEscrowedResult = wrappedTokenContract.try_totalEscrowed()
  let totalUSDTInvestedResult = wrappedTokenContract.try_totalUSDTInvested()
  let emergencyUnlockEnabledResult = wrappedTokenContract.try_emergencyUnlockEnabled()
  let emergencyUnlockPenaltyResult = wrappedTokenContract.try_emergencyUnlockPenalty()

  wrappedToken.name = nameResult.reverted ? "" : nameResult.value
  wrappedToken.symbol = symbolResult.reverted ? "" : symbolResult.value
  wrappedToken.offering = event.params.offeringContract
  wrappedToken.offeringAddress = event.params.offeringContract
  wrappedToken.peggedToken = peggedTokenResult.reverted ? Bytes.empty() : peggedTokenResult.value
  wrappedToken.payoutToken = payoutTokenResult.reverted ? Bytes.empty() : payoutTokenResult.value
  wrappedToken.payoutTokenSymbol = getTokenSymbol(wrappedToken.payoutToken)
  wrappedToken.maturityDate = maturityDateResult.reverted ? BigInt.fromI32(0) : maturityDateResult.value
  wrappedToken.payoutAPR = payoutAPRResult.reverted ? BigInt.fromI32(0) : payoutAPRResult.value
  wrappedToken.payoutPeriodDuration = payoutPeriodDurationResult.reverted ? BigInt.fromI32(0) : payoutPeriodDurationResult.value
  wrappedToken.firstPayoutDate = firstPayoutDateResult.reverted ? BigInt.fromI32(0) : firstPayoutDateResult.value
  wrappedToken.currentPayoutPeriod = currentPayoutPeriodResult.reverted ? BigInt.fromI32(0) : currentPayoutPeriodResult.value
  wrappedToken.lastPayoutDistributionTime = BigInt.fromI32(0)
  wrappedToken.totalSupply = totalSupplyResult.reverted ? BigInt.fromI32(0) : totalSupplyResult.value
  wrappedToken.totalEscrowed = totalEscrowedResult.reverted ? BigInt.fromI32(0) : totalEscrowedResult.value
  wrappedToken.totalUSDTInvested = totalUSDTInvestedResult.reverted ? BigInt.fromI32(0) : totalUSDTInvestedResult.value
  wrappedToken.totalPayoutFundsDistributed = BigInt.fromI32(0)
  wrappedToken.totalPayoutsClaimed = BigInt.fromI32(0)
  wrappedToken.currentPayoutFunds = BigInt.fromI32(0)
  wrappedToken.emergencyUnlockEnabled = emergencyUnlockEnabledResult.reverted ? false : emergencyUnlockEnabledResult.value
  wrappedToken.emergencyUnlockPenalty = emergencyUnlockPenaltyResult.reverted ? BigInt.fromI32(0) : emergencyUnlockPenaltyResult.value
  wrappedToken.totalEmergencyUnlocks = BigInt.fromI32(0)
  wrappedToken.totalHolders = BigInt.fromI32(0)
  wrappedToken.activeHolders = BigInt.fromI32(0)
  wrappedToken.createdAt = event.block.timestamp
  wrappedToken.createdBlock = event.block.number
  
  wrappedToken.save()

  // Start indexing this wrapped token contract
  WrappedTokenTemplate.create(event.params.wrappedTokenAddress)

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

  // Update global statistics
  updateGlobalStats("wrapped_token", BigInt.fromI32(1), event.block.timestamp)
  
  // Create wrapped token creation notification
  createUserNotification(
    event.params.creator,
    "wrapped_token_created",
    "Wrapped Token Created!",
    "Your wrapped token '" + wrappedToken.name + "' has been deployed successfully with APY features enabled.",
    "high",
    event.block.timestamp,
    event.params.offeringContract,
    event.params.wrappedTokenAddress
  )
}

function getTokenSymbol(tokenAddress: Bytes): string {
  // Implementation to get token symbol
  return "TOKEN"
}