import {
  assert,
  describe,
  test,
  clearStore,
  beforeAll,
  afterAll
} from "matchstick-as/assembly/index"
import { Address, BigInt } from "@graphprotocol/graph-ts"
import { InvestmentRouted } from "../generated/schema"
import { InvestmentRouted as InvestmentRoutedEvent } from "../generated/Contract/Contract"
import { handleInvestmentRouted } from "../src/contract"
import { createInvestmentRoutedEvent } from "./contract-utils"

// Tests structure (matchstick-as >=0.5.0)
// https://thegraph.com/docs/en/developer/matchstick/#tests-structure-0-5-0

describe("Describe entity assertions", () => {
  beforeAll(() => {
    let investor = Address.fromString(
      "0x0000000000000000000000000000000000000001"
    )
    let offeringAddress = Address.fromString(
      "0x0000000000000000000000000000000000000001"
    )
    let paymentToken = Address.fromString(
      "0x0000000000000000000000000000000000000001"
    )
    let paidAmount = BigInt.fromI32(234)
    let tokensReceived = BigInt.fromI32(234)
    let newInvestmentRoutedEvent = createInvestmentRoutedEvent(
      investor,
      offeringAddress,
      paymentToken,
      paidAmount,
      tokensReceived
    )
    handleInvestmentRouted(newInvestmentRoutedEvent)
  })

  afterAll(() => {
    clearStore()
  })

  // For more test scenarios, see:
  // https://thegraph.com/docs/en/developer/matchstick/#write-a-unit-test

  test("InvestmentRouted created and stored", () => {
    assert.entityCount("InvestmentRouted", 1)

    // 0xa16081f360e3847006db660bae1c6d1b2e17ec2a is the default address used in newMockEvent() function
    assert.fieldEquals(
      "InvestmentRouted",
      "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1",
      "investor",
      "0x0000000000000000000000000000000000000001"
    )
    assert.fieldEquals(
      "InvestmentRouted",
      "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1",
      "offeringAddress",
      "0x0000000000000000000000000000000000000001"
    )
    assert.fieldEquals(
      "InvestmentRouted",
      "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1",
      "paymentToken",
      "0x0000000000000000000000000000000000000001"
    )
    assert.fieldEquals(
      "InvestmentRouted",
      "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1",
      "paidAmount",
      "234"
    )
    assert.fieldEquals(
      "InvestmentRouted",
      "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1",
      "tokensReceived",
      "234"
    )

    // More assert options:
    // https://thegraph.com/docs/en/developer/matchstick/#asserts
  })
})
