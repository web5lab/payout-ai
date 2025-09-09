import {
  Invested as InvestedEvent,
  Claimed as ClaimedEvent,
  SaleClosed as SaleClosedEvent
} from "../generated/templates/Offering/Offering"
import { 
  Offering,
  TotalInvestment
} from "../generated/schema"
import { BigInt, Bytes } from "@graphprotocol/graph-ts"

export function handleInvested(event: InvestedEvent): void {
  // Update offering total raised
  let offering = Offering.load(event.address)
  if (offering) {
    // This will be updated by InvestmentManager handler
    offering.save()
  }

  // Update total investment for wrapped token tracking
  let totalInvestmentId = event.address.toHexString() + "-" + event.params.investor.toHexString()
  let totalInvestment = TotalInvestment.load(Bytes.fromUTF8(totalInvestmentId))
  
  if (totalInvestment && offering && offering.apyEnabled && offering.wrappedTokenAddress) {
    totalInvestment.hasWrappedTokens = true
    totalInvestment.wrappedTokenAddress = offering.wrappedTokenAddress
    totalInvestment.wrappedTokenBalance = totalInvestment.wrappedTokenBalance.plus(event.params.tokensReceived)
    totalInvestment.save()
  }
}

export function handleClaimed(event: ClaimedEvent): void {
  // This is handled by InvestmentManager
}

export function handleSaleClosed(event: SaleClosedEvent): void {
  let offering = Offering.load(event.address)
  if (offering) {
    offering.isActive = false
    offering.totalRaised = event.params.totalRaised
    offering.save()
  }
}