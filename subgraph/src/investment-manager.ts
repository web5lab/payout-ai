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
  User
} from "../generated/schema"
import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts"
import { getOrCreateUser, updateUserActivity } from "./user-manager"

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
  userInvestment.gasUsed = BigInt.fromI32(0)
  userInvestment.gasPrice = BigInt.fromI32(0)
  
  // Try to get token symbol
  userInvestment.paymentTokenSymbol = getTokenSymbol(event.params.paymentToken)
  
  // Calculate USD value (assuming 1:1 for simplicity, could be enhanced with oracle data)
  userInvestment.usdValue = event.params.paidAmount
  
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