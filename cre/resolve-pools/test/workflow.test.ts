import { describe, expect } from "bun:test"
import { getNetwork } from "@chainlink/cre-sdk"
import {
  addContractMock,
  EvmMock,
  HttpActionsMock,
  newTestRuntime,
  REPORT_METADATA_HEADER_LENGTH,
  type Secrets,
  test,
  type WriteReportMockInput,
} from "@chainlink/cre-sdk/test"
import { bytesToHex, type Address } from "viem"
import { predictionPoolAbi } from "../../../packages/shared/src/abi"
import { type Config, COINGECKO_SECRET_ID, onCronTrigger } from "../src/workflow"
import { encodeResolveReport } from "../src/report"

const POOL: Address = "0x6b0f6C0f324C615Add6BfcA5EE0b8eeD66F2C0cd"
const config: Config = {
  schedule: "0 */1 * * * *",
  chainSelectorName: "ethereum-testnet-sepolia-base-1",
  poolAddress: POOL,
  maxPools: 10,
  gasLimit: "400000",
  coingeckoBaseUrl: "https://api.coingecko.com/api/v3",
}
const selector = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainSelectorName })!.chainSelector.selector
const E18 = 10n ** 18n

function pool(coingeckoId: string, direction: number, strikeE18: bigint) {
  return {
    question: `q ${coingeckoId}`,
    coingeckoId,
    direction,
    strikeE18,
    resolveTime: 1n,
    createdAt: 0n,
    yesTotal: 1n,
    noTotal: 1n,
    resolved: false,
    outcomeYes: false,
    resolvedPriceE18: 0n,
    feeBps: 200,
    creator: "0x8CF9113b19Aa9D169365CA7B1BB9d7b957B460e5" as Address,
  }
}

const POOLS: Record<string, ReturnType<typeof pool>> = {
  "0": pool("ethereum", 0, 3000n * E18),
  "1": pool("bitcoin", 1, 100_000n * E18),
  "2": pool("not-a-coin", 0, 1n * E18),
}

const b64 = (s: string) => Buffer.from(s).toString("base64")
const okWrite = {
  txStatus: "TX_STATUS_SUCCESS" as const,
  receiverContractExecutionStatus: "RECEIVER_CONTRACT_EXECUTION_STATUS_SUCCESS" as const,
  txHash: Buffer.from(new Uint8Array(32).fill(0xab)).toString("base64"),
}

type Setup = {
  dueIds?: bigint[]
  prices?: Record<string, { status: number; body: string } | "throw">
  writeReply?: (input: WriteReportMockInput) => typeof okWrite | Record<string, unknown>
  secrets?: Secrets
}

function setup(opts: Setup = {}) {
  const evm = EvmMock.testInstance(selector)
  const contract = addContractMock(evm, { address: POOL, abi: predictionPoolAbi })
  const dueCalls: unknown[] = []
  contract.getDuePoolIds = (max: unknown) => {
    dueCalls.push(max)
    return opts.dueIds ?? [0n, 1n]
  }
  contract.getPool = (id: unknown) => POOLS[String(id)]
  const writes: WriteReportMockInput[] = []
  contract.writeReport = (input) => {
    writes.push(input)
    return (opts.writeReply ?? (() => okWrite))(input) as typeof okWrite
  }

  const http = HttpActionsMock.testInstance()
  const requests: { url: string; headers: Record<string, string[]> }[] = []
  const prices = opts.prices ?? {
    ethereum: { status: 200, body: '{"ethereum":{"usd":3412.57}}' },
    bitcoin: { status: 200, body: '{"bitcoin":{"usd":109876.5}}' },
  }
  http.sendRequest = (req) => {
    const headers: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(req.multiHeaders ?? {})) headers[k] = [...v.values]
    requests.push({ url: req.url, headers })
    const id = new URL(req.url).searchParams.get("ids") ?? ""
    const reply = prices[id] ?? { status: 200, body: "{}" }
    if (reply === "throw") throw new Error("connection refused")
    return { statusCode: reply.status, body: b64(reply.body) }
  }

  const runtime = newTestRuntime<Config>(opts.secrets ?? null)
  runtime.config = config
  return { runtime, dueCalls, writes, requests }
}

const payloadOf = (w: WriteReportMockInput) => bytesToHex(w.report.rawReport.slice(REPORT_METADATA_HEADER_LENGTH))

describe("onCronTrigger", () => {
  test("reads getDuePoolIds(maxPools) and logs the ids (FR-R-02)", () => {
    const { runtime, dueCalls } = setup()
    onCronTrigger(runtime)
    expect(dueCalls).toEqual([10n])
    expect(runtime.getLogs().join("\n")).toContain("due pool ids: [0, 1]")
  })

  test("does nothing when no pool is due", () => {
    const { runtime, writes, requests } = setup({ dueIds: [] })
    onCronTrigger(runtime)
    expect(writes).toHaveLength(0)
    expect(requests).toHaveLength(0)
  })

  test("fetches each price keyless with full precision and writes the exact report bytes (FR-R-03, FR-R-04)", () => {
    const { runtime, writes, requests } = setup()
    const result = onCronTrigger(runtime)

    expect(requests.map((r) => r.url)).toEqual([
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&precision=full",
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&precision=full",
    ])
    expect(requests.every((r) => Object.keys(r.headers).length === 0)).toBe(true)

    expect(writes).toHaveLength(2)
    for (const w of writes) {
      expect(bytesToHex(w.receiver).toLowerCase()).toBe(POOL.toLowerCase())
      expect(w.gasConfig.gasLimit).toBe(400000n)
    }
    // ETH 3412.57 >= 3000 above -> YES; BTC 109876.5 <= 100000 below -> NO
    expect(payloadOf(writes[0])).toBe(encodeResolveReport(0n, true, 3_412_570_000_000_000_000_000n))
    expect(payloadOf(writes[1])).toBe(encodeResolveReport(1n, false, 109_876_500_000_000_000_000_000n))

    const logs = runtime.getLogs().join("\n")
    expect(logs).toContain("pool 0 ethereum price 3412.57 USD (priceE18 3412570000000000000000)")
    expect(logs).toContain("pool 0 outcome YES")
    expect(logs).toContain("pool 1 outcome NO")
    expect(logs).toContain(`pool 0 report ${encodeResolveReport(0n, true, 3_412_570_000_000_000_000_000n)}`)
    expect(logs).toContain("pool 0 write ok tx 0x" + "ab".repeat(32))
    expect(JSON.parse(result)).toEqual({ due: ["0", "1"], resolved: ["0", "1"], skipped: [], failed: [] })
  })

  test("skips a pool whose HTTP fetch fails and still resolves the others, without throwing (FR-R-05)", () => {
    const { runtime, writes } = setup({
      prices: {
        ethereum: { status: 429, body: '{"status":{"error_code":429}}' },
        bitcoin: { status: 200, body: '{"bitcoin":{"usd":99000}}' },
      },
    })
    const result = onCronTrigger(runtime)
    expect(writes).toHaveLength(1)
    expect(payloadOf(writes[0])).toBe(encodeResolveReport(1n, true, 99_000n * E18))
    expect(runtime.getLogs().join("\n")).toMatch(/pool 0 skipped: .*429/)
    expect(JSON.parse(result)).toEqual({ due: ["0", "1"], resolved: ["1"], skipped: ["0"], failed: [] })
  })

  test("skips on a transport error from the HTTP capability", () => {
    const { runtime, writes } = setup({
      prices: { ethereum: "throw", bitcoin: { status: 200, body: '{"bitcoin":{"usd":99000}}' } },
    })
    const result = onCronTrigger(runtime)
    expect(writes).toHaveLength(1)
    expect(JSON.parse(result).skipped).toEqual(["0"])
  })

  test("leaves a pool with an unknown coingecko id unresolved (bad id -> empty CoinGecko map)", () => {
    const { runtime, writes } = setup({ dueIds: [2n] })
    const result = onCronTrigger(runtime)
    expect(writes).toHaveLength(0)
    expect(runtime.getLogs().join("\n")).toMatch(/pool 2 skipped: .*no usd price/)
    expect(JSON.parse(result)).toEqual({ due: ["2"], resolved: [], skipped: ["2"], failed: [] })
  })

  test("sends the demo key header only when the COINGECKO_API_KEY secret is set", () => {
    const secrets: Secrets = new Map([["main", new Map([[COINGECKO_SECRET_ID, "CG-test-key"]])]]) // SDK default secret namespace
    const { runtime, requests } = setup({ secrets })
    onCronTrigger(runtime)
    expect(requests).toHaveLength(2)
    for (const r of requests) expect(r.headers).toEqual({ "x-cg-demo-api-key": ["CG-test-key"] })
    expect(runtime.getLogs().join("\n")).not.toContain("CG-test-key")
  })

  test("reports a reverted onReport as failed and continues", () => {
    let n = 0
    const { runtime, writes } = setup({
      writeReply: () =>
        n++ === 0
          ? { ...okWrite, receiverContractExecutionStatus: "RECEIVER_CONTRACT_EXECUTION_STATUS_REVERTED" }
          : okWrite,
    })
    const result = onCronTrigger(runtime)
    expect(writes).toHaveLength(2)
    expect(JSON.parse(result)).toEqual({ due: ["0", "1"], resolved: ["1"], skipped: [], failed: ["0"] })
  })
})
