import {
  InvestmentRouted as InvestmentRoutedEvent,
  TokensClaimed as TokensClaimedEvent,
  RefundClaimed as RefundClaimedEvent,
  KYBValidatedInvestment as KYBValidatedInvestmentEvent
} from "../generated/InvestmentManager/InvestmentManager"
import { 
  UserInvestment, 
  UserClaim, 
  UserRefund,
  UserOfferingInvestment,
  OfferingInvestmentTransaction,
  Offering,
  User
} from "../generated/schema"
import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts"
import { getOrCreateUser, updateUserActivity } from "./user-manager"

export function handleInvestmentRouted(event: InvestmentRoutedEvent): void {
  let user = getOrCreateUser(event.params.investor, event.block.timestamp)
  
  // Create offering investment transaction record
  let transactionId = event.transaction.hash.concatI32(event.logIndex.toI32())
  let offeringTransaction = new OfferingInvestmentTransaction(transactionId)
  
  offeringTransaction.offering = event.params.offeringAddress
  offeringTransaction.offeringAddress = event.params.offeringAddress
  offeringTransaction.investor = event.params.investor
  offeringTransaction.investorAddress = event.params.investor
  offeringTransaction.paymentToken = event.params.paymentToken
  offeringTransaction.paymentTokenSymbol = getTokenSymbol(event.params.paymentToken)
  offeringTransaction.investmentAmount = event.params.paidAmount
  offeringTransaction.tokensReceived = event.params.tokensReceived
  offeringTransaction.usdValue = event.params.paidAmount // Assuming 1:1 for now
  offeringTransaction.isKYBValidated = false
  offeringTransaction.isNativeETH = event.params.paymentToken.equals(Address.zero())
  offeringTransaction.hasWrappedTokens = false
  offeringTransaction.wrappedTokensReceived = BigInt.fromI32(0)
  offeringTransaction.blockNumber = event.block.number
  offeringTransaction.blockTimestamp = event.block.timestamp
  offeringTransaction.transactionHash = event.transaction.hash
  offeringTransaction.gasUsed = BigInt.fromI32(0) // Can be enhanced with actual gas data
  offeringTransaction.gasPrice = BigInt.fromI32(0) // Can be enhanced with actual gas data
  
  // Check if offering has wrapped tokens enabled
  let offering = Offering.load(event.params.offeringAddress)
  if (offering && offering.apyEnabled && offering.wrappedTokenAddress) {
    offeringTransaction.hasWrappedTokens = true
    offeringTransaction.wrappedTokenAddress = offering.wrappedTokenAddress
    offeringTransaction.wrappedTokensReceived = event.params.tokensReceived
  }
  
  offeringTransaction.save()
  
  // Create or update aggregated investment for this user+offering combination
  let aggregatedId = event.params.investor.toHexString() + "-" + event.params.offeringAddress.toHexString()
  let aggregatedInvestment = UserOfferingInvestment.load(Bytes.fromUTF8(aggregatedId))
  
  if (!aggregatedInvestment) {
    aggregatedInvestment = new UserOfferingInvestment(Bytes.fromUTF8(aggregatedId))
    aggregatedInvestment.user = event.params.investor
    aggregatedInvestment.userAddress = event.params.investor
    aggregatedInvestment.offering = event.params.offeringAddress
    aggregatedInvestment.offeringAddress = event.params.offeringAddress
    aggregatedInvestment.totalInvestments = BigInt.fromI32(0)
    aggregatedInvestment.totalPaidAmount = BigInt.fromI32(0)
    aggregatedInvestment.totalUSDValue = BigInt.fromI32(0)
    aggregatedInvestment.totalTokensReceived = BigInt.fromI32(0)
    aggregatedInvestment.totalWrappedTokensReceived = BigInt.fromI32(0)
    aggregatedInvestment.totalETHInvested = BigInt.fromI32(0)
    aggregatedInvestment.totalERC20Invested = BigInt.fromI32(0)
    aggregatedInvestment.totalKYBValidatedInvestments = BigInt.fromI32(0)
    aggregatedInvestment.hasClaimedTokens = false
    aggregatedInvestment.totalTokensClaimed = BigInt.fromI32(0)
    aggregatedInvestment.hasReceivedRefund = false
    aggregatedInvestment.totalRefundReceived = BigInt.fromI32(0)
    aggregatedInvestment.firstInvestmentAt = event.block.timestamp
  }
  
  // Update aggregated investment
  aggregatedInvestment.totalInvestments = aggregatedInvestment.totalInvestments.plus(BigInt.fromI32(1))
  aggregatedInvestment.totalPaidAmount = aggregatedInvestment.totalPaidAmount.plus(event.params.paidAmount)
  aggregatedInvestment.totalUSDValue = aggregatedInvestment.totalUSDValue.plus(event.params.paidAmount) // Assuming 1:1 for now
  aggregatedInvestment.totalTokensReceived = aggregatedInvestment.totalTokensReceived.plus(event.params.tokensReceived)
  
  // Track payment method
  if (event.params.paymentToken.equals(Address.zero())) {
    aggregatedInvestment.totalETHInvested = aggregatedInvestment.totalETHInvested.plus(event.params.paidAmount)
  } else {
    aggregatedInvestment.totalERC20Invested = aggregatedInvestment.totalERC20Invested.plus(event.params.paidAmount)
  }
  
  aggregatedInvestment.lastInvestmentAt = event.block.timestamp
  aggregatedInvestment.save()
  
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
  userInvestment.gasUsed = BigInt.fromI32(0)
  userInvestment.gasPrice = BigInt.fromI32(0)
  
  // Try to get token symbol
  userInvestment.paymentTokenSymbol = getTokenSymbol(event.params.paymentToken)
  
  // Calculate USD value (assuming 1:1 for simplicity, could be enhanced with oracle data)
  userInvestment.usdValue = event.params.paidAmount
  
  // Link to aggregated investment
  userInvestment.aggregatedInvestment = aggregatedInvestment.id
  
  userInvestment.save()
  
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
}

export function handleKYBValidatedInvestment(event: KYBValidatedInvestmentEvent): void {
  // Handle KYB validated investment
  let user = getOrCreateUser(event.params.investor, event.block.timestamp)
  
  // Update the corresponding offering investment transaction to mark as KYB validated
  let transactionId = event.transaction.hash.concatI32(event.logIndex.toI32())
  let offeringTransaction = OfferingInvestmentTransaction.load(transactionId)
  if (offeringTransaction) {
    offeringTransaction.isKYBValidated = true
    offeringTransaction.save()
  }
  
  // Update aggregated investment for KYB validation
  let aggregatedId = event.params.investor.toHexString() + "-" + event.params.offeringAddress.toHexString()
  let aggregatedInvestment = UserOfferingInvestment.load(Bytes.fromUTF8(aggregatedId))
  
  if (aggregatedInvestment) {
    aggregatedInvestment.totalKYBValidatedInvestments = aggregatedInvestment.totalKYBValidatedInvestments.plus(BigInt.fromI32(1))
    aggregatedInvestment.save()
  }
  
  // Update user activity for KYB investment
  updateUserActivity(
    event.params.investor,
    "kyb_investment",
    event.params.paidAmount,
    event.params.paymentToken,
    event.block.timestamp,
    event.block.number,
    event.transaction.hash,
    "KYB validated investment",
    event.params.offeringAddress
  )
}

export function handleTokensClaimed(event: TokensClaimedEvent): void {
  let user = getOrCreateUser(event.params.investor, event.block.timestamp)
  
  // Update aggregated investment for token claims
  let aggregatedId = event.params.investor.toHexString() + "-" + event.params.offeringAddress.toHexString()
  let aggregatedInvestment = UserOfferingInvestment.load(Bytes.fromUTF8(aggregatedId))
  
  if (aggregatedInvestment) {
    aggregatedInvestment.hasClaimedTokens = true
    aggregatedInvestment.totalTokensClaimed = aggregatedInvestment.totalTokensClaimed.plus(event.params.amount)
    aggregatedInvestment.save()
  }
  
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
  
  userClaim.tokenAddress = Bytes.empty()
  userClaim.tokenSymbol = "SALE"
  
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
  
}

export function handleRefundClaimed(event: RefundClaimedEvent): void {
  let user = getOrCreateUser(event.params.investor, event.block.timestamp)
  
  // Update aggregated investment for refunds
  let aggregatedId = event.params.investor.toHexString() + "-" + event.params.offeringAddress.toHexString()
  let aggregatedInvestment = UserOfferingInvestment.load(Bytes.fromUTF8(aggregatedId))
  
  if (aggregatedInvestment) {
    aggregatedInvestment.hasReceivedRefund = true
    aggregatedInvestment.totalRefundReceived = aggregatedInvestment.totalRefundReceived.plus(event.params.amount)
    aggregatedInvestment.save()
  }
  
  // Create user refund record
  let refundId = event.transaction.hash.concatI32(event.logIndex.toI32())
  let userClaim = new UserClaim(refundId)
  
  userClaim.user = event.params.investor
  userClaim.userAddress = event.params.investor
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
}

function getTokenSymbol(tokenAddress: Bytes): string {
  if (tokenAddress.equals(Address.zero())) {
    return "ETH"
  }
  
  // Try to get symbol from contract (this would require binding to ERC20)
  // For now, return a placeholder
  return "TOKEN"
}