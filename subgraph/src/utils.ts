import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { GlobalStats } from "../generated/schema"

export function createId(address: Bytes, suffix: string): Bytes {
  return Bytes.fromUTF8(address.toHexString() + "-" + suffix)
}

export function createUserTokenId(tokenAddress: Bytes, userAddress: Bytes): Bytes {
  return Bytes.fromUTF8(tokenAddress.toHexString() + "-" + userAddress.toHexString())
}

export function createRoundId(tokenAddress: Bytes, roundNumber: BigInt): Bytes {
  return Bytes.fromUTF8(tokenAddress.toHexString() + "-" + roundNumber.toString())
}

export function calculatePercentage(part: BigInt, total: BigInt): BigInt {
  if (total.equals(BigInt.fromI32(0))) {
    return BigInt.fromI32(0)
  }
  return part.times(BigInt.fromI32(10000)).div(total) // Returns basis points (10000 = 100%)
}

export function getOrCreateGlobalStats(timestamp: BigInt): GlobalStats {
  let stats = GlobalStats.load(Bytes.fromUTF8("global"))
  if (!stats) {
    stats = new GlobalStats(Bytes.fromUTF8("global"))
    stats.totalOfferings = BigInt.fromI32(0)
    stats.totalWrappedTokens = BigInt.fromI32(0)
    stats.totalInvestments = BigInt.fromI32(0)
    stats.totalInvestmentVolume = BigInt.fromI32(0)
    stats.totalPayoutFunds = BigInt.fromI32(0)
    stats.totalPayoutsClaimed = BigInt.fromI32(0)
    stats.totalEmergencyUnlocks = BigInt.fromI32(0)
    stats.totalFinalClaims = BigInt.fromI32(0)
    stats.lastUpdated = timestamp
  }
  return stats
}