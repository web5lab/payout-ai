import {
  WrappedTokenDeployed as WrappedTokenDeployedEvent
} from "../generated/WrappedTokenFactory/WrappedTokenFactory"
import { User, WrappedToken } from "../generated/schema"
import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { getOrCreateUser, updateUserActivity } from "./user-manager"

export function handleWrappedTokenDeployed(event: WrappedTokenDeployedEvent): void {
  let creator = getOrCreateUser(event.params.creator, event.block.timestamp)
  
  // Create wrapped token entity with contract data
  let wrappedToken = new WrappedToken(event.params.wrappedTokenAddress)

  // Initialize with default values
  wrappedToken.name = "Wrapped Token"
  wrappedToken.symbol = "wTKN"
  wrappedToken.offering = event.params.offeringContract
  wrappedToken.offeringAddress = event.params.offeringContract
  wrappedToken.peggedToken = Bytes.empty()
  wrappedToken.payoutToken = Bytes.empty()
  wrappedToken.payoutTokenSymbol = "PAYOUT"
  wrappedToken.maturityDate = BigInt.fromI32(0)
  wrappedToken.payoutAPR = BigInt.fromI32(0)
  wrappedToken.payoutPeriodDuration = BigInt.fromI32(0)
  wrappedToken.firstPayoutDate = BigInt.fromI32(0)
  wrappedToken.currentPayoutPeriod = BigInt.fromI32(0)
  wrappedToken.lastPayoutDistributionTime = BigInt.fromI32(0)
  wrappedToken.totalSupply = BigInt.fromI32(0)
  wrappedToken.totalEscrowed = BigInt.fromI32(0)
  wrappedToken.totalUSDTInvested = BigInt.fromI32(0)
  wrappedToken.totalPayoutFundsDistributed = BigInt.fromI32(0)
  wrappedToken.totalPayoutsClaimed = BigInt.fromI32(0)
  wrappedToken.currentPayoutFunds = BigInt.fromI32(0)
  wrappedToken.emergencyUnlockEnabled = false
  wrappedToken.emergencyUnlockPenalty = BigInt.fromI32(0)
  wrappedToken.totalEmergencyUnlocks = BigInt.fromI32(0)
  wrappedToken.totalHolders = BigInt.fromI32(0)
  wrappedToken.activeHolders = BigInt.fromI32(0)
  wrappedToken.createdAt = event.block.timestamp
  wrappedToken.createdBlock = event.block.number
  
  wrappedToken.save()

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
  // Implementation to get token symbol
  return "TOKEN"
}