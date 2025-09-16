import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts"
import { User, UserNotification, UserActivityHistory, GlobalStats } from "../generated/schema"

export function getOrCreateUser(userAddress: Bytes, timestamp: BigInt): User {
  let user = User.load(userAddress)
  
  if (!user) {
    user = new User(userAddress)
    user.address = userAddress
    
    // Initialize counters
    user.totalInvestments = BigInt.fromI32(0)
    user.totalInvestmentVolume = BigInt.fromI32(0)
    user.totalTokensReceived = BigInt.fromI32(0)
    user.totalTokensClaimed = BigInt.fromI32(0)
    user.totalPayoutsReceived = BigInt.fromI32(0)
    user.totalPayoutsClaimed = BigInt.fromI32(0)
    user.activeWrappedTokens = BigInt.fromI32(0)
    user.totalEmergencyUnlocks = BigInt.fromI32(0)
    user.totalPenaltiesPaid = BigInt.fromI32(0)
    user.totalOfferingsCreated = BigInt.fromI32(0)
    user.totalFundsRaised = BigInt.fromI32(0)
    user.firstActivityAt = timestamp
    user.lastActivityAt = timestamp
    user.save()
  }
  
  return user
}

export function updateUserActivity(
  userAddress: Bytes, 
  activityType: string, 
  amount: BigInt, 
  tokenAddress: Bytes,
  timestamp: BigInt,
  blockNumber: BigInt,
  transactionHash: Bytes,
  description: string = "",
  offeringAddress: Bytes | null = null,
  wrappedTokenAddress: Bytes | null = null
): void {
  let user = getOrCreateUser(userAddress, timestamp)
  user.lastActivityAt = timestamp
  
  // Update user stats based on activity type
  if (activityType == "investment") {
    user.totalInvestments = user.totalInvestments.plus(BigInt.fromI32(1))
    user.totalInvestmentVolume = user.totalInvestmentVolume.plus(amount)
  } else if (activityType == "claim") {
    user.totalTokensClaimed = user.totalTokensClaimed.plus(amount)
  } else if (activityType == "payout") {
    user.totalPayoutsClaimed = user.totalPayoutsClaimed.plus(amount)
  } else if (activityType == "emergency") {
    user.totalEmergencyUnlocks = user.totalEmergencyUnlocks.plus(BigInt.fromI32(1))
    user.totalPenaltiesPaid = user.totalPenaltiesPaid.plus(amount)
  }
  
  user.save()
}