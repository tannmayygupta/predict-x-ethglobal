import { describe, expect, it, vi } from "vitest";
import { ApiClientError, createApiClient, type Transport } from "../src/api";

const WALLET = "0x1111111111111111111111111111111111111111";
const market = {
  symbol: "ETH", name: "Ethereum", address: "0x4200000000000000000000000000000000000006",
  flashChainId: 8453, priceUsd: "2451.12", change24hPct: -1.8, updatedAt: 1761600000,
};

function client(transport: Transport) {
  return createApiClient("http://localhost:8787/api/v1/", transport);
}

describe("api client", () => {
  it("builds the URL, sends the request and parses the response with the shared schema", async () => {
    const transport = vi.fn<Transport>().mockResolvedValue({ status: 200, body: market });
    expect((await client(transport).market("ETH")).priceUsd).toBe("2451.12");
    expect(transport).toHaveBeenCalledWith({ method: "GET", url: "http://localhost:8787/api/v1/market/ETH", body: undefined });
  });

  it("sends JSON bodies for POST endpoints", async () => {
    const body = { symbol: "ETH", tip: "t", bias: "neutral", confidence: "low", suggestedLimit: null, degraded: true, disclaimer: "d" };
    const transport = vi.fn<Transport>().mockResolvedValue({ status: 200, body });
    await client(transport).insight({ symbol: "ETH", userIntent: "dip" });
    expect(transport.mock.calls[0]?.[0]).toMatchObject({
      method: "POST", url: "http://localhost:8787/api/v1/insight", body: { symbol: "ETH", userIntent: "dip" },
    });
  });

  it("puts the wallet address in the position query", async () => {
    const body = { poolId: 3, address: WALLET, yesStake: "1", noStake: "0", claimable: "0", claimed: false, refundable: "0" };
    const transport = vi.fn<Transport>().mockResolvedValue({ status: 200, body });
    await client(transport).position(3, WALLET);
    expect(transport.mock.calls[0]?.[0].url).toBe(`http://localhost:8787/api/v1/pools/3/position?address=${WALLET}`);
  });

  it("turns the server error shape into an ApiClientError with its code", async () => {
    const transport: Transport = async () => ({
      status: 400, body: { error: { code: "UNSUPPORTED_TOKEN", message: "Unsupported token: XYZ" } },
    });
    await expect(client(transport).market("XYZ")).rejects.toMatchObject({
      code: "UNSUPPORTED_TOKEN", status: 400, message: "Unsupported token: XYZ",
    });
  });

  it("reports NETWORK when no answer arrives", async () => {
    const transport: Transport = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(client(transport).market("ETH")).rejects.toMatchObject({ code: "NETWORK", status: 0 });
  });

  it("reports CONTRACT_MISMATCH when a 200 does not match the schema", async () => {
    const transport: Transport = async () => ({ status: 200, body: { symbol: "ETH", priceUsd: 5 } });
    await expect(client(transport).market("ETH")).rejects.toBeInstanceOf(ApiClientError);
    await expect(client(transport).market("ETH")).rejects.toMatchObject({ code: "CONTRACT_MISMATCH" });
  });

  it("reports INTERNAL for a non-2xx answer that is not the error shape", async () => {
    const transport: Transport = async () => ({ status: 502, body: "<html>bad gateway</html>" });
    await expect(client(transport).pools()).rejects.toMatchObject({ code: "INTERNAL", status: 502 });
  });
});
