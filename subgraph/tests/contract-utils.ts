import { newMockEvent } from "matchstick-as"
import { ethereum, Address, BigInt } from "@graphprotocol/graph-ts"
import {
  InvestmentRouted,
  OwnershipTransferred
} from "../generated/Contract/Contract"

export function createInvestmentRoutedEvent(
  investor: Address,
  offeringAddress: Address,
  paymentToken: Address,
  paidAmount: BigInt,
  tokensReceived: BigInt
): InvestmentRouted {
  let investmentRoutedEvent = changetype<InvestmentRouted>(newMockEvent())

  investmentRoutedEvent.parameters = new Array()

  investmentRoutedEvent.parameters.push(
    new ethereum.EventParam("investor", ethereum.Value.fromAddress(investor))
  )
  investmentRoutedEvent.parameters.push(
    new ethereum.EventParam(
      "offeringAddress",
      ethereum.Value.fromAddress(offeringAddress)
    )
  )
  investmentRoutedEvent.parameters.push(
    new ethereum.EventParam(
      "paymentToken",
      ethereum.Value.fromAddress(paymentToken)
    )
  )
  investmentRoutedEvent.parameters.push(
    new ethereum.EventParam(
      "paidAmount",
      ethereum.Value.fromUnsignedBigInt(paidAmount)
    )
  )
  investmentRoutedEvent.parameters.push(
    new ethereum.EventParam(
      "tokensReceived",
      ethereum.Value.fromUnsignedBigInt(tokensReceived)
    )
  )

  return investmentRoutedEvent
}

export function createOwnershipTransferredEvent(
  previousOwner: Address,
  newOwner: Address
): OwnershipTransferred {
  let ownershipTransferredEvent = changetype<OwnershipTransferred>(
    newMockEvent()
  )

  ownershipTransferredEvent.parameters = new Array()

  ownershipTransferredEvent.parameters.push(
    new ethereum.EventParam(
      "previousOwner",
      ethereum.Value.fromAddress(previousOwner)
    )
  )
  ownershipTransferredEvent.parameters.push(
    new ethereum.EventParam("newOwner", ethereum.Value.fromAddress(newOwner))
  )

  return ownershipTransferredEvent
}
