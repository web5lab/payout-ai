import {
  InvestmentRouted as InvestmentRoutedEvent,
  OwnershipTransferred as OwnershipTransferredEvent,
  TokensClaimed as TokensClaimedEvent
} from "../generated/Contract/Contract"
import { InvestmentRouted, OwnershipTransferred, TotalInvestment, TokensClaimed } from "../generated/schema"
import { BigInt, Bytes } from "@graphprotocol/graph-ts"

export function handleInvestmentRouted(event: InvestmentRoutedEvent): void {
  let entity = new InvestmentRouted(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.investor = event.params.investor
  entity.offeringAddress = event.params.offeringAddress
  entity.paymentToken = event.params.paymentToken
  entity.paidAmount = event.params.paidAmount
  entity.tokensReceived = event.params.tokensReceived

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()

  let totalInvestmentId = event.params.offeringAddress.toHexString() + "-" + event.params.investor.toHexString()
  let totalInvestment = TotalInvestment.load(Bytes.fromUTF8(totalInvestmentId))

  if (!totalInvestment) {
    totalInvestment = new TotalInvestment(Bytes.fromUTF8(totalInvestmentId))
    totalInvestment.offeringAddress = event.params.offeringAddress
    totalInvestment.userAddress = event.params.investor
    totalInvestment.totalInvestment = BigInt.fromI32(0)
    totalInvestment.latestInvestmentTimestamp = event.block.timestamp
    totalInvestment.claimableTokens = BigInt.fromI32(0)
    totalInvestment.claimedTokens = BigInt.fromI32(0)
  }

  totalInvestment.totalInvestment = totalInvestment.totalInvestment.plus(event.params.paidAmount)
  totalInvestment.latestInvestmentTimestamp = event.block.timestamp
  totalInvestment.claimableTokens = totalInvestment.claimableTokens.plus(event.params.tokensReceived)
  totalInvestment.save()
}

export function handleTokensClaimed(event: TokensClaimedEvent): void {
  let entity = new TokensClaimed(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.investor = event.params.investor
  entity.offeringAddress = event.params.offeringAddress
  entity.amount = event.params.amount

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()

  let totalInvestmentId = event.params.offeringAddress.toHexString() + "-" + event.params.investor.toHexString()
  let totalInvestment = TotalInvestment.load(Bytes.fromUTF8(totalInvestmentId))

  if (totalInvestment) {
    totalInvestment.claimableTokens = totalInvestment.claimableTokens.minus(event.params.amount)
    totalInvestment.claimedTokens = totalInvestment.claimedTokens.plus(event.params.amount)
    totalInvestment.save()
  }
}

export function handleOwnershipTransferred(
  event: OwnershipTransferredEvent
): void {
  let entity = new OwnershipTransferred(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.previousOwner = event.params.previousOwner
  entity.newOwner = event.params.newOwner

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}
