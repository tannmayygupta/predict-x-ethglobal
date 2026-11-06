/**
 * PredictX resolver (REQUIREMENTS.md section G, FR-R-01..05).
 * Cron -> getDuePoolIds -> getPool -> CoinGecko price (median consensus) -> outcome -> writeReport.
 * Capabilities use the SDK's .result() pattern only (RULES.md 6.5). A pool whose price cannot be
 * fetched or parsed is skipped this run and never resolved with a guessed price (RULES.md 6.6).
 */
import {
  bytesToHex,
  consensusMedianAggregation,
  EVMClient,
  encodeCallMsg,
  getNetwork,
  type HTTPSendRequester,
  HTTPClient,
  LATEST_BLOCK_NUMBER,
  prepareReportRequest,
  type Runtime,
  TxStatus,
} from "@chainlink/cre-sdk"
import { type Address, decodeFunctionResult, encodeFunctionData, zeroAddress } from "viem"
import { predictionPoolAbi } from "../../../packages/shared/src/abi"
import { buildPriceRequest, type PriceRequest, parsePriceResponse } from "./coingecko"
import { decideOutcome } from "./outcome"
import { formatE18 } from "./price"
import { encodeResolveReport } from "./report"

export type Config = {
  schedule: string
  chainSelectorName: string
  poolAddress: string
  maxPools: number
  gasLimit: string
  coingeckoBaseUrl: string
}

export const COINGECKO_SECRET_ID = "COINGECKO_API_KEY"

// ReceiverContractExecutionStatus.REVERTED in the EVM capability proto (not re-exported by the SDK index).
const RECEIVER_REVERTED = 1

type RunSummary = { due: string[]; resolved: string[]; skipped: string[]; failed: string[] }

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function callView(runtime: Runtime<Config>, evm: EVMClient, data: `0x${string}`): `0x${string}` {
  const reply = evm
    .callContract(runtime, {
      call: encodeCallMsg({ from: zeroAddress, to: runtime.config.poolAddress as Address, data }),
      // Latest block: due-ness depends on block.timestamp, and the finalized head lags by minutes.
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result()
  return bytesToHex(reply.data)
}

function readDuePoolIds(runtime: Runtime<Config>, evm: EVMClient): readonly bigint[] {
  const data = encodeFunctionData({
    abi: predictionPoolAbi,
    functionName: "getDuePoolIds",
    args: [BigInt(runtime.config.maxPools)],
  })
  return decodeFunctionResult({
    abi: predictionPoolAbi,
    functionName: "getDuePoolIds",
    data: callView(runtime, evm, data),
  })
}

function readPool(runtime: Runtime<Config>, evm: EVMClient, id: bigint) {
  const data = encodeFunctionData({ abi: predictionPoolAbi, functionName: "getPool", args: [id] })
  return decodeFunctionResult({ abi: predictionPoolAbi, functionName: "getPool", data: callView(runtime, evm, data) })
}

/** Optional secret: keyless CoinGecko must work, so a missing secret means "no key". */
function readCoingeckoKey(runtime: Runtime<Config>): string | undefined {
  try {
    const value = runtime.getSecret({ id: COINGECKO_SECRET_ID }).result().value.trim()
    return value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

/** Runs on every node; the DON takes the median of the per-node priceE18 values. */
const fetchPriceE18 = (sendRequester: HTTPSendRequester, request: PriceRequest, coingeckoId: string): bigint => {
  const response = sendRequester.sendRequest(request).result()
  return parsePriceResponse(response.statusCode, new TextDecoder().decode(response.body), coingeckoId)
}

function fetchMedianPriceE18(runtime: Runtime<Config>, coingeckoId: string, apiKey: string | undefined): bigint {
  const request = buildPriceRequest(runtime.config.coingeckoBaseUrl, coingeckoId, apiKey)
  return new HTTPClient()
    .sendRequest(runtime, fetchPriceE18, consensusMedianAggregation<bigint>())(request, coingeckoId)
    .result()
}

function writeResolveReport(runtime: Runtime<Config>, evm: EVMClient, reportHex: `0x${string}`): string {
  const report = runtime.report(prepareReportRequest(reportHex)).result()
  const reply = evm
    .writeReport(runtime, {
      receiver: runtime.config.poolAddress,
      report,
      gasConfig: { gasLimit: runtime.config.gasLimit },
    })
    .result()
  const txHash = reply.txHash && reply.txHash.length > 0 ? bytesToHex(reply.txHash) : "(none)"
  if (reply.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`tx status ${TxStatus[reply.txStatus]} tx ${txHash} ${reply.errorMessage ?? ""}`.trim())
  }
  if (reply.receiverContractExecutionStatus === RECEIVER_REVERTED) {
    throw new Error(`onReport reverted tx ${txHash} ${reply.errorMessage ?? ""}`.trim())
  }
  return txHash
}

export const onCronTrigger = (runtime: Runtime<Config>): string => {
  const { chainSelectorName, poolAddress } = runtime.config
  const network = getNetwork({ chainFamily: "evm", chainSelectorName })
  if (!network) throw new Error(`unknown chain: ${chainSelectorName}`)
  const evm = new EVMClient(network.chainSelector.selector)

  const dueIds = readDuePoolIds(runtime, evm)
  runtime.log(`pool contract ${poolAddress} on ${chainSelectorName}: due pool ids: [${dueIds.join(", ")}]`)
  const summary: RunSummary = { due: dueIds.map(String), resolved: [], skipped: [], failed: [] }
  if (dueIds.length === 0) return JSON.stringify(summary)

  const apiKey = readCoingeckoKey(runtime)
  runtime.log(`coingecko: ${apiKey ? "demo/pro key from secret" : "keyless"}`)

  // One fetch per coin per run; a failed fetch is remembered so every pool on that coin is skipped.
  const prices = new Map<string, bigint | Error>()

  for (const id of dueIds) {
    let reportHex: `0x${string}`
    try {
      const pool = readPool(runtime, evm, id)
      let price = prices.get(pool.coingeckoId)
      if (price === undefined) {
        try {
          price = fetchMedianPriceE18(runtime, pool.coingeckoId, apiKey)
        } catch (e) {
          price = new Error(errorMessage(e))
        }
        prices.set(pool.coingeckoId, price)
      }
      if (price instanceof Error) throw price

      const outcomeYes = decideOutcome(pool.direction, pool.strikeE18, price)
      reportHex = encodeResolveReport(id, outcomeYes, price)
      runtime.log(`pool ${id} ${pool.coingeckoId} price ${formatE18(price)} USD (priceE18 ${price})`)
      runtime.log(
        `pool ${id} outcome ${outcomeYes ? "YES" : "NO"} (${pool.direction === 0 ? "above" : "below"} strike ${formatE18(pool.strikeE18)})`,
      )
      runtime.log(`pool ${id} report ${reportHex}`)
    } catch (e) {
      runtime.log(`pool ${id} skipped: ${errorMessage(e)}`)
      summary.skipped.push(String(id))
      continue
    }

    try {
      const txHash = writeResolveReport(runtime, evm, reportHex)
      runtime.log(`pool ${id} write ok tx ${txHash}`)
      summary.resolved.push(String(id))
    } catch (e) {
      runtime.log(`pool ${id} write failed: ${errorMessage(e)}`)
      summary.failed.push(String(id))
    }
  }

  runtime.log(
    `run done: resolved [${summary.resolved.join(", ")}] skipped [${summary.skipped.join(", ")}] failed [${summary.failed.join(", ")}]`,
  )
  return JSON.stringify(summary)
}
