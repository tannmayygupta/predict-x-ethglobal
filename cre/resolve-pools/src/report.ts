import { encodeAbiParameters, type Hex, parseAbiParameters } from "viem"

const REPORT_PARAMS = parseAbiParameters("uint256 poolId, bool outcomeYes, uint256 priceE18")

/** report = abi.encode(uint256 poolId, bool outcomeYes, uint256 priceE18), decoded by PredictionPool.onReport. */
export function encodeResolveReport(poolId: bigint, outcomeYes: boolean, priceE18: bigint): Hex {
  return encodeAbiParameters(REPORT_PARAMS, [poolId, outcomeYes, priceE18])
}
