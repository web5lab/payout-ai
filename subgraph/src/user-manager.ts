import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts"
import { 
  User, 
  UserDailyStats, 
  UserMonthlyStats,
  UserActivityHistory,
  GlobalStats,
  DailySystemStats,
  UserNotification
} from "../generated/schema"

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
    updateGlobalUserCount(timestamp)
    
    // Create welcome notification
    createUserNotification(
      userAddress,
      "welcome",
      "Welcome to the Platform!",
      "You've successfully joined our investment ecosystem. Start exploring offerings to begin your investment journey.",
      "medium",
      timestamp
    )
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
  
  // Create activity history record
  let historyId = userAddress.toHexString() + "-" + timestamp.toString() + "-" + activityType
  let history = new UserActivityHistory(Bytes.fromUTF8(historyId))
  
  history.user = userAddress
  history.userAddress = userAddress
  history.activityType = activityType
  history.description = description
  history.amount = amount
  history.tokenAddress = tokenAddress
  history.offeringAddress = offeringAddress
  history.wrappedTokenAddress = wrappedTokenAddress
  history.blockNumber = blockNumber
  history.blockTimestamp = timestamp
  history.transactionHash = transactionHash
  
  history.save()
  
  // Update daily stats
  updateUserDailyStats(userAddress, activityType, amount, timestamp)
  
  // Update monthly stats
  updateUserMonthlyStats(userAddress, activityType, amount, timestamp)
}

export function updateUserDailyStats(
  userAddress: Bytes, 
  activityType: string, 
  amount: BigInt, 
  timestamp: BigInt
): void {
  let date = formatDate(timestamp)
  let dailyStatsId = userAddress.toHexString() + "-" + date
  let dailyStats = UserDailyStats.load(Bytes.fromUTF8(dailyStatsId))
  
  if (!dailyStats) {
    dailyStats = new UserDailyStats(Bytes.fromUTF8(dailyStatsId))
    dailyStats.user = userAddress
    dailyStats.userAddress = userAddress
    dailyStats.date = date
    dailyStats.investmentsCount = BigInt.fromI32(0)
    dailyStats.investmentVolume = BigInt.fromI32(0)
    dailyStats.claimsCount = BigInt.fromI32(0)
    dailyStats.claimedAmount = BigInt.fromI32(0)
    dailyStats.payoutsCount = BigInt.fromI32(0)
    dailyStats.payoutAmount = BigInt.fromI32(0)
    dailyStats.totalInvestmentVolume = BigInt.fromI32(0)
    dailyStats.totalTokensHeld = BigInt.fromI32(0)
    dailyStats.totalPayoutsReceived = BigInt.fromI32(0)
  }
  
  if (activityType == "investment") {
    dailyStats.investmentsCount = dailyStats.investmentsCount.plus(BigInt.fromI32(1))
    dailyStats.investmentVolume = dailyStats.investmentVolume.plus(amount)
  } else if (activityType == "claim") {
    dailyStats.claimsCount = dailyStats.claimsCount.plus(BigInt.fromI32(1))
    dailyStats.claimedAmount = dailyStats.claimedAmount.plus(amount)
  } else if (activityType == "payout") {
    dailyStats.payoutsCount = dailyStats.payoutsCount.plus(BigInt.fromI32(1))
    dailyStats.payoutAmount = dailyStats.payoutAmount.plus(amount)
  }
  
  dailyStats.lastUpdated = timestamp
  dailyStats.save()
  
  // Update daily system stats
  updateDailySystemStats(activityType, amount, timestamp)
}

export function updateUserMonthlyStats(
  userAddress: Bytes, 
  activityType: string, 
  amount: BigInt, 
  timestamp: BigInt
): void {
  let yearMonth = formatYearMonth(timestamp)
  let monthlyStatsId = userAddress.toHexString() + "-" + yearMonth
  let monthlyStats = UserMonthlyStats.load(Bytes.fromUTF8(monthlyStatsId))
  
  if (!monthlyStats) {
    monthlyStats = new UserMonthlyStats(Bytes.fromUTF8(monthlyStatsId))
    monthlyStats.user = userAddress
    monthlyStats.userAddress = userAddress
    monthlyStats.yearMonth = yearMonth
    monthlyStats.investmentsCount = BigInt.fromI32(0)
    monthlyStats.investmentVolume = BigInt.fromI32(0)
    monthlyStats.claimsCount = BigInt.fromI32(0)
    monthlyStats.claimedAmount = BigInt.fromI32(0)
    monthlyStats.payoutsCount = BigInt.fromI32(0)
    monthlyStats.payoutAmount = BigInt.fromI32(0)
    monthlyStats.avgInvestmentSize = BigInt.fromI32(0)
    monthlyStats.avgPayoutSize = BigInt.fromI32(0)
  }
  
  if (activityType == "investment") {
    monthlyStats.investmentsCount = monthlyStats.investmentsCount.plus(BigInt.fromI32(1))
    monthlyStats.investmentVolume = monthlyStats.investmentVolume.plus(amount)
    monthlyStats.avgInvestmentSize = monthlyStats.investmentVolume.div(monthlyStats.investmentsCount)
  } else if (activityType == "payout") {
    monthlyStats.payoutsCount = monthlyStats.payoutsCount.plus(BigInt.fromI32(1))
    monthlyStats.payoutAmount = monthlyStats.payoutAmount.plus(amount)
    if (monthlyStats.payoutsCount.gt(BigInt.fromI32(0))) {
      monthlyStats.avgPayoutSize = monthlyStats.payoutAmount.div(monthlyStats.payoutsCount)
    }
  }
  
  monthlyStats.lastUpdated = timestamp
  monthlyStats.save()
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
  relatedAmount: BigInt | null = null,
  expiresAt: BigInt | null = null
): void {
  let notificationId = userAddress.toHexString() + "-" + notificationType + "-" + timestamp.toString()
  let notification = new UserNotification(Bytes.fromUTF8(notificationId))
  
  notification.user = userAddress
  notification.userAddress = userAddress
  notification.notificationType = notificationType
  notification.title = title
  notification.message = message
  notification.priority = priority
  notification.relatedOffering = relatedOffering
  notification.relatedWrappedToken = relatedWrappedToken
  notification.relatedAmount = relatedAmount || BigInt.fromI32(0)
  notification.isRead = false
  notification.isActionable = true
  notification.expiresAt = expiresAt || BigInt.fromI32(0)
  notification.createdAt = timestamp
  notification.readAt = BigInt.fromI32(0)
  
  notification.save()
}

function updateGlobalUserCount(timestamp: BigInt): void {
  let stats = GlobalStats.load(Bytes.fromUTF8("global"))
  if (!stats) {
    stats = new GlobalStats(Bytes.fromUTF8("global"))
    initializeGlobalStats(stats)
  }
  
  stats.totalUsers = stats.totalUsers.plus(BigInt.fromI32(1))
  stats.lastUpdated = timestamp
  stats.save()
}

function updateDailySystemStats(activityType: string, amount: BigInt, timestamp: BigInt): void {
  let date = formatDate(timestamp)
  let dailyStats = DailySystemStats.load(Bytes.fromUTF8(date))
  
  if (!dailyStats) {
    dailyStats = new DailySystemStats(Bytes.fromUTF8(date))
    dailyStats.date = date
    dailyStats.newUsers = BigInt.fromI32(0)
    dailyStats.newOfferings = BigInt.fromI32(0)
    dailyStats.newInvestments = BigInt.fromI32(0)
    dailyStats.investmentVolume = BigInt.fromI32(0)
    dailyStats.payoutDistributions = BigInt.fromI32(0)
    dailyStats.payoutVolume = BigInt.fromI32(0)
    dailyStats.payoutClaims = BigInt.fromI32(0)
    dailyStats.emergencyUnlocks = BigInt.fromI32(0)
    dailyStats.emergencyVolume = BigInt.fromI32(0)
    dailyStats.totalUsers = BigInt.fromI32(0)
    dailyStats.totalOfferings = BigInt.fromI32(0)
    dailyStats.totalInvestmentVolume = BigInt.fromI32(0)
  }
  
  if (activityType == "investment") {
    dailyStats.newInvestments = dailyStats.newInvestments.plus(BigInt.fromI32(1))
    dailyStats.investmentVolume = dailyStats.investmentVolume.plus(amount)
  } else if (activityType == "payout") {
    dailyStats.payoutClaims = dailyStats.payoutClaims.plus(BigInt.fromI32(1))
    dailyStats.payoutVolume = dailyStats.payoutVolume.plus(amount)
  } else if (activityType == "emergency") {
    dailyStats.emergencyUnlocks = dailyStats.emergencyUnlocks.plus(BigInt.fromI32(1))
    dailyStats.emergencyVolume = dailyStats.emergencyVolume.plus(amount)
  }
  
  dailyStats.lastUpdated = timestamp
  dailyStats.save()
}

function initializeGlobalStats(stats: GlobalStats): void {
  stats.totalOfferings = BigInt.fromI32(0)
  stats.activeOfferings = BigInt.fromI32(0)
  stats.totalOfferingVolume = BigInt.fromI32(0)
  stats.totalUsers = BigInt.fromI32(0)
  stats.activeInvestors = BigInt.fromI32(0)
  stats.totalInvestments = BigInt.fromI32(0)
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
}

export function formatDate(timestamp: BigInt): string {
  // Convert timestamp to YYYY-MM-DD format
  let date = new Date(timestamp.toI32() * 1000)
  let year = date.getUTCFullYear().toString()
  let month = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  let day = date.getUTCDate().toString().padStart(2, '0')
  return year + "-" + month + "-" + day
}

export function formatYearMonth(timestamp: BigInt): string {
  // Convert timestamp to YYYY-MM format
  let date = new Date(timestamp.toI32() * 1000)
  let year = date.getUTCFullYear().toString()
  let month = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  return year + "-" + month
}

export function calculateSharePercentage(userAmount: BigInt, totalAmount: BigInt): BigInt {
  if (totalAmount.equals(BigInt.fromI32(0))) {
    return BigInt.fromI32(0)
  }
  return userAmount.times(BigInt.fromI32(10000)).div(totalAmount) // Returns basis points
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
    initializeGlobalStats(stats)
  }
  
  let delta = increment ? BigInt.fromI32(1) : BigInt.fromI32(-1)
  let amountDelta = increment ? amount : amount.times(BigInt.fromI32(-1))
  
  if (statType == "offering") {
    stats.totalOfferings = stats.totalOfferings.plus(delta)
    if (increment) stats.activeOfferings = stats.activeOfferings.plus(delta)
  } else if (statType == "investment") {
    stats.totalInvestments = stats.totalInvestments.plus(delta)
    stats.totalOfferingVolume = stats.totalOfferingVolume.plus(amountDelta)
  } else if (statType == "payout") {
    stats.totalPayoutsClaimed = stats.totalPayoutsClaimed.plus(delta)
    stats.totalPayoutVolume = stats.totalPayoutVolume.plus(amountDelta)
  } else if (statType == "emergency") {
    stats.totalEmergencyUnlocks = stats.totalEmergencyUnlocks.plus(delta)
    stats.totalPenaltiesPaid = stats.totalPenaltiesPaid.plus(amountDelta)
  } else if (statType == "refund") {
    stats.totalRefunds = stats.totalRefunds.plus(delta)
    stats.totalRefundVolume = stats.totalRefundVolume.plus(amountDelta)
  } else if (statType == "kyb") {
    stats.totalKYBValidations = stats.totalKYBValidations.plus(delta)
  }
  
  stats.lastUpdated = timestamp
  stats.save()
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
      "You have " + claimableAmount.toString() + " tokens available to claim from your wrapped token investment.",
      "high",
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
  let oneDay = BigInt.fromI32(24 * 60 * 60)
  
  if (timeToMaturity.le(oneWeek) && timeToMaturity.gt(oneDay)) {
    createUserNotification(
      userAddress,
      "maturity_approaching",
      "Token Maturity Approaching",
      "Your wrapped tokens will mature in less than a week. Prepare to claim your final tokens!",
      "medium",
      currentTimestamp,
      null,
      wrappedTokenAddress,
      null,
      maturityDate
    )
  } else if (timeToMaturity.le(oneDay) && timeToMaturity.gt(BigInt.fromI32(0))) {
    createUserNotification(
      userAddress,
      "maturity_imminent",
      "Token Maturity Tomorrow!",
      "Your wrapped tokens mature within 24 hours. Don't forget to claim your final tokens!",
      "high",
      currentTimestamp,
      null,
      wrappedTokenAddress,
      null,
      maturityDate
    )
  }
}