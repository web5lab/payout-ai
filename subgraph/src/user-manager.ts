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
    
    // Update global stats
    // updateGlobalUserCount(timestamp)
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

export function updateGlobalStats(
  statType: string, 
  amount: BigInt, 
  timestamp: BigInt, 
  increment: boolean = true
): void {
  let stats = GlobalStats.load(Bytes.fromUTF8("global"))
  if (!stats) {
    stats = new GlobalStats(Bytes.fromUTF8("global"))
    stats.totalUsers = BigInt.fromI32(0)
    stats.activeInvestors = BigInt.fromI32(0)
    stats.totalCreators = BigInt.fromI32(0)
    stats.totalOfferings = BigInt.fromI32(0)
    stats.activeOfferings = BigInt.fromI32(0)
    stats.totalOfferingVolume = BigInt.fromI32(0)
    stats.totalInvestments = BigInt.fromI32(0)
    stats.totalInvestmentVolume = BigInt.fromI32(0)
    stats.totalWrappedTokens = BigInt.fromI32(0)
    stats.activeWrappedTokens = BigInt.fromI32(0)
    stats.totalWrappedTokenHolders = BigInt.fromI32(0)
    stats.totalPayoutDistributions = BigInt.fromI32(0)
    stats.totalPayoutVolume = BigInt.fromI32(0)
    stats.totalPayoutsClaimed = BigInt.fromI32(0)
    stats.totalEmergencyUnlocks = BigInt.fromI32(0)
    stats.totalPenaltiesPaid = BigInt.fromI32(0)
    stats.totalRefunds = BigInt.fromI32(0)
    stats.totalRefundVolume = BigInt.fromI32(0)
    stats.totalKYBValidations = BigInt.fromI32(0)
    stats.kybValidatedInvestments = BigInt.fromI32(0)
    stats.lastUpdated = timestamp
  }
  
  // Update stats based on type
  if (statType == "investment") {
    stats.totalInvestments = stats.totalInvestments.plus(BigInt.fromI32(1))
    stats.totalInvestmentVolume = stats.totalInvestmentVolume.plus(amount)
  } else if (statType == "payout") {
    stats.totalPayoutsClaimed = stats.totalPayoutsClaimed.plus(amount)
  } else if (statType == "emergency") {
    stats.totalEmergencyUnlocks = stats.totalEmergencyUnlocks.plus(BigInt.fromI32(1))
    stats.totalPenaltiesPaid = stats.totalPenaltiesPaid.plus(amount)
  } else if (statType == "refund") {
    stats.totalRefunds = stats.totalRefunds.plus(BigInt.fromI32(1))
    stats.totalRefundVolume = stats.totalRefundVolume.plus(amount)
  }
  
  stats.lastUpdated = timestamp
  stats.save()
}

export function createUserNotification(
  userAddress: Bytes,
  notificationType: string,
  title: string,
  message: string,
  priority: string,
  timestamp: BigInt,
  relatedOffering: Bytes | null = null,
  relatedWrappedToken: Bytes | null = null,
  relatedAmount: BigInt = BigInt.fromI32(0)
): void {
  let notificationId = userAddress.toHexString() + "-" + timestamp.toString() + "-" + notificationType
  let notification = new UserNotification(Bytes.fromUTF8(notificationId))
  
  notification.user = userAddress
  notification.userAddress = userAddress
  notification.notificationType = notificationType
  notification.title = title
  notification.message = message
  notification.priority = priority
  notification.isRead = false
  notification.isActionable = true
  notification.createdAt = timestamp
  notification.relatedOffering = relatedOffering
  notification.relatedWrappedToken = relatedWrappedToken
  notification.relatedAmount = relatedAmount
  
  notification.save()
}

export function calculateSharePercentage(userBalance: BigInt, totalSupply: BigInt): BigInt {
  if (totalSupply.equals(BigInt.fromI32(0))) {
    return BigInt.fromI32(0)
  }
  return userBalance.times(BigInt.fromI32(10000)).div(totalSupply) // Returns basis points
}

export function checkAndCreatePayoutNotifications(
  userAddress: Bytes,
  wrappedTokenAddress: Bytes,
  claimableAmount: BigInt,
  timestamp: BigInt
): void {
  if (claimableAmount.gt(BigInt.fromI32(0))) {
    createUserNotification(
      userAddress,
      "payout_available",
      "Payout Available!",
      "You have " + claimableAmount.toString() + " tokens available to claim.",
      "medium",
      timestamp,
      null,
      wrappedTokenAddress,
      claimableAmount
    )
  }
}

export function checkAndCreateMaturityNotifications(
  userAddress: Bytes,
  wrappedTokenAddress: Bytes,
  maturityDate: BigInt,
  currentTimestamp: BigInt
): void {
  let timeToMaturity = maturityDate.minus(currentTimestamp)
  let oneWeek = BigInt.fromI32(7 * 24 * 60 * 60)
  
  if (timeToMaturity.le(oneWeek) && timeToMaturity.gt(BigInt.fromI32(0))) {
    createUserNotification(
      userAddress,
      "maturity_approaching",
      "Maturity Approaching",
      "Your wrapped tokens will mature in less than a week. Prepare to claim your final tokens!",
      "high",
      currentTimestamp,
      null,
      wrappedTokenAddress
    )
  }
}