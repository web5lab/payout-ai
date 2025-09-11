import {
  InvestmentRouted as InvestmentRoutedEvent,
  TokensClaimed as TokensClaimedEvent,
  RefundClaimed as RefundClaimedEvent,
  KYBValidatedInvestment as KYBValidatedInvestmentEvent
} from "../generated/InvestmentManager/InvestmentManager"
import { 
  User,
  UserInvestment, 
  UserClaim,
  UserRefund,
  UserKYBValidation,
  Offering,
  InvestmentEvent,
  RefundEvent
} from "../generated/schema"
import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts"
import { 
  getOrCreateUser, 
  updateUserActivity, 
  updateGlobalStats,
  createUserNotification
} from "./user-manager"

export function handleInvestmentRouted(event: InvestmentRoutedEvent): void {
  let user = getOrCreateUser(event.params.investor, event.block.timestamp)
  
  // Create user investment record
  let investmentId = event.transaction.hash.concatI32(event.logIndex.toI32())
  let userInvestment = new UserInvestment(investmentId)
  
  userInvestment.user = event.params.investor
  userInvestment.userAddress = event.params.investor
  userInvestment.offering = event.params.offeringAddress
  userInvestment.offeringAddress = event.params.offeringAddress
  userInvestment.paymentToken = event.params.paymentToken
  userInvestment.paidAmount = event.params.paidAmount
  userInvestment.tokensReceived = event.params.tokensReceived
  userInvestment.isKYBValidated = false
  userInvestment.isNativeETH = event.params.paymentToken.equals(Address.zero())
  userInvestment.hasWrappedTokens = false
  userInvestment.wrappedTokensReceived = BigInt.fromI32(0)
  userInvestment.blockNumber = event.block.number
  userInvestment.blockTimestamp = event.block.timestamp
  userInvestment.transactionHash = event.transaction.hash
  userInvestment.gasUsed = event.receipt ? event.receipt.gasUsed : BigInt.fromI32(0)
  userInvestment.gasPrice = event.transaction.gasPrice || BigInt.fromI32(0)
  
  // Try to get token symbol
  userInvestment.paymentTokenSymbol = getTokenSymbol(event.params.paymentToken)
  
  // Calculate USD value (assuming 1:1 for simplicity, could be enhanced with oracle data)
  userInvestment.usdValue = event.params.paidAmount
  
  // Check if offering has APY enabled
  let offering = Offering.load(event.params.offeringAddress)
  if (offering && offering.apyEnabled && offering.wrappedTokenAddress) {
    userInvestment.hasWrappedTokens = true
    userInvestment.wrappedTokenAddress = offering.wrappedTokenAddress
    userInvestment.wrappedTokensReceived = event.params.tokensReceived
    
    // Update user's active wrapped tokens count
    user.activeWrappedTokens = user.activeWrappedTokens.plus(BigInt.fromI32(1))
    user.save()
  }
  
  userInvestment.save()
  
  // Create investment event record
  let eventRecord = new InvestmentEvent(investmentId)
  eventRecord.eventType = "routed"
  eventRecord.investor = event.params.investor
  eventRecord.offering = event.params.offeringAddress
  eventRecord.paymentToken = event.params.paymentToken
  eventRecord.amount = event.params.paidAmount
  eventRecord.tokensReceived = event.params.tokensReceived
  eventRecord.isKYBValidated = false
  eventRecord.blockNumber = event.block.number
  eventRecord.blockTimestamp = event.block.timestamp
  eventRecord.transactionHash = event.transaction.hash
  eventRecord.gasUsed = event.receipt ? event.receipt.gasUsed : BigInt.fromI32(0)
  eventRecord.save()
  
  // Update user activity
  updateUserActivity(
    event.params.investor,
    "investment",
    event.params.paidAmount,
    event.params.paymentToken,
    event.block.timestamp,
    event.block.number,
    event.transaction.hash,
    "Investment in offering " + event.params.offeringAddress.toHexString(),
    event.params.offeringAddress,
    userInvestment.wrappedTokenAddress
  )
  
  // Update offering statistics
  if (offering) {
    offering.totalRaised = offering.totalRaised.plus(event.params.paidAmount)
    offering.totalInvestors = offering.totalInvestors.plus(BigInt.fromI32(1))
    offering.totalTokensDistributed = offering.totalTokensDistributed.plus(event.params.tokensReceived)
    offering.save()
  }
  
  // Update global statistics
  updateGlobalStats("investment", event.params.paidAmount, event.block.timestamp)
  
  // Create success notification
  createUserNotification(
    event.params.investor,
    "investment_success",
    "Investment Successful!",
    "Your investment of " + event.params.paidAmount.toString() + " has been processed successfully.",
    "medium",
    event.block.timestamp,
    event.params.offeringAddress,
    userInvestment.wrappedTokenAddress,
    event.params.paidAmount
  )
}

export function handleKYBValidatedInvestment(event: KYBValidatedInvestmentEvent): void {
  // Create KYB validation record
  let kybId = event.transaction.hash.concatI32(event.logIndex.toI32())
  let kybValidation = new UserKYBValidation(kybId)
  
  kybValidation.user = event.params.investor
  kybValidation.userAddress = event.params.investor
  kybValidation.signatureHash = event.params.signatureHash
  kybValidation.offeringAddress = event.params.offeringAddress
  kybValidation.investmentAmount = event.params.paidAmount
  kybValidation.blockNumber = event.block.number
  kybValidation.blockTimestamp = event.block.timestamp
  kybValidation.transactionHash = event.transaction.hash
  
  // Try to get validator address from transaction
  kybValidation.validator = event.transaction.from // This might not be the actual validator
  
  kybValidation.save()
  
  // Update the corresponding investment record to mark as KYB validated
  let investmentId = event.transaction.hash.concatI32(event.logIndex.toI32())
  let userInvestment = UserInvestment.load(investmentId)
  if (userInvestment) {
    userInvestment.isKYBValidated = true
    kybValidation.investment = investmentId
    kybValidation.save()
    userInvestment.save()
  }
  
  // Create enhanced investment event
  let eventRecord = new InvestmentEvent(investmentId)
  eventRecord.eventType = "kyb_validated"
  eventRecord.investor = event.params.investor
  eventRecord.offering = event.params.offeringAddress
  eventRecord.paymentToken = event.params.paymentToken
  eventRecord.amount = event.params.paidAmount
  eventRecord.tokensReceived = event.params.tokensReceived
  eventRecord.isKYBValidated = true
  eventRecord.kybValidator = event.transaction.from
  eventRecord.signatureHash = event.params.signatureHash
  eventRecord.blockNumber = event.block.number
  eventRecord.blockTimestamp = event.block.timestamp
  eventRecord.transactionHash = event.transaction.hash
  eventRecord.gasUsed = event.receipt ? event.receipt.gasUsed : BigInt.fromI32(0)
  eventRecord.save()
  
  // Update global KYB stats
  updateGlobalStats("kyb", BigInt.fromI32(1), event.block.timestamp)
  
  // Create KYB success notification
  createUserNotification(
    event.params.investor,
    "kyb_validated",
    "KYB Validated Investment",
    "Your KYB-validated investment has been processed successfully with enhanced security.",
    "high",
    event.block.timestamp,
    event.params.offeringAddress,
    null,
    event.params.paidAmount
  )
}

export function handleTokensClaimed(event: TokensClaimedEvent): void {
  let user = getOrCreateUser(event.params.investor, event.block.timestamp)
  
  // Create user claim record
  let claimId = event.transaction.hash.concatI32(event.logIndex.toI32())
  let userClaim = new UserClaim(claimId)
  
  userClaim.user = event.params.investor
  userClaim.userAddress = event.params.investor
  userClaim.offering = event.params.offeringAddress
  userClaim.offeringAddress = event.params.offeringAddress
  userClaim.claimType = "investment_tokens"
  userClaim.amount = event.params.amount
  userClaim.isEmergencyUnlock = false
  userClaim.penaltyAmount = BigInt.fromI32(0)
  userClaim.blockNumber = event.block.number
  userClaim.blockTimestamp = event.block.timestamp
  userClaim.transactionHash = event.transaction.hash
  
  // Get token info from offering
  let offering = Offering.load(event.params.offeringAddress)
  if (offering) {
    userClaim.tokenAddress = offering.saleToken
    userClaim.tokenSymbol = offering.saleTokenSymbol || ""
  } else {
    userClaim.tokenAddress = Bytes.empty()
    userClaim.tokenSymbol = ""
  }
  
  userClaim.save()
  
  // Update user activity
  updateUserActivity(
    event.params.investor,
    "claim",
    event.params.amount,
    userClaim.tokenAddress,
    event.block.timestamp,
    event.block.number,
    event.transaction.hash,
    "Claimed investment tokens from offering",
    event.params.offeringAddress
  )
  
  // Create claim success notification
  createUserNotification(
    event.params.investor,
    "tokens_claimed",
    "Tokens Claimed Successfully!",
    "You have successfully claimed " + event.params.amount.toString() + " tokens from your investment.",
    "medium",
    event.block.timestamp,
    event.params.offeringAddress,
    null,
    event.params.amount
  )
}

export function handleRefundClaimed(event: RefundClaimedEvent): void {
  let user = getOrCreateUser(event.params.investor, event.block.timestamp)
  
  // Create user refund record
  let refundId = event.transaction.hash.concatI32(event.logIndex.toI32())
  let userRefund = new UserRefund(refundId)
  
  userRefund.user = event.params.investor
  userRefund.userAddress = event.params.investor
  userRefund.offering = event.params.offeringAddress
  userRefund.offeringAddress = event.params.offeringAddress
  userRefund.refundToken = event.params.token
  userRefund.refundAmount = event.params.amount
  userRefund.originalInvestment = event.params.amount // Assuming full refund
  userRefund.blockNumber = event.block.number
  userRefund.blockTimestamp = event.block.timestamp
  userRefund.transactionHash = event.transaction.hash
  
  userRefund.save()
  
  // Create user claim record for refund
  let claimId = event.transaction.hash.concatI32(event.logIndex.toI32() + 1000) // Offset to avoid collision
  let userClaim = new UserClaim(claimId)
  
  userClaim.user = event.params.investor
  userClaim.userAddress = event.params.investor
  userClaim.offering = event.params.offeringAddress
  userClaim.offeringAddress = event.params.offeringAddress
  userClaim.claimType = "refund"
  userClaim.amount = event.params.amount
  userClaim.tokenAddress = event.params.token
  userClaim.tokenSymbol = getTokenSymbol(event.params.token)
  userClaim.isEmergencyUnlock = false
  userClaim.penaltyAmount = BigInt.fromI32(0)
  userClaim.blockNumber = event.block.number
  userClaim.blockTimestamp = event.block.timestamp
  userClaim.transactionHash = event.transaction.hash
  
  userClaim.save()
  
  // Create refund event record
  let refundEvent = new RefundEvent(refundId)
  refundEvent.eventType = "claimed"
  refundEvent.offering = event.params.offeringAddress
  refundEvent.user = event.params.investor
  refundEvent.token = event.params.token
  refundEvent.amount = event.params.amount
  refundEvent.blockNumber = event.block.number
  refundEvent.blockTimestamp = event.block.timestamp
  refundEvent.transactionHash = event.transaction.hash
  refundEvent.save()
  
  // Update user activity
  updateUserActivity(
    event.params.investor,
    "refund",
    event.params.amount,
    event.params.token,
    event.block.timestamp,
    event.block.number,
    event.transaction.hash,
    "Refund claimed from offering",
    event.params.offeringAddress
  )
  
  // Update offering statistics
  let offering = Offering.load(event.params.offeringAddress)
  if (offering) {
    offering.totalRefunded = offering.totalRefunded.plus(event.params.amount)
    offering.save()
  }
  
  // Update global statistics
  updateGlobalStats("refund", event.params.amount, event.block.timestamp)
  
  // Create refund notification
  createUserNotification(
    event.params.investor,
    "refund_processed",
    "Refund Processed",
    "Your refund of " + event.params.amount.toString() + " has been processed successfully.",
    "high",
    event.block.timestamp,
    event.params.offeringAddress,
    null,
    event.params.amount
  )
}

function getTokenSymbol(tokenAddress: Bytes): string {
  if (tokenAddress.equals(Address.zero())) {
    return "ETH"
  }
  
  // Try to get symbol from contract (this would require binding to ERC20)
  // For now, return a placeholder
  return "TOKEN"
}