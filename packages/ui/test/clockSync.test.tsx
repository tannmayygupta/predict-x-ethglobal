// @vitest-environment jsdom
import { cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AppServices } from "../src/context";
import { AppProvider } from "../src/context";
import { currentSeconds, getClockOffset, setClockOffset, useNow } from "../src/react/useExternal";

const localNow = (): number => Math.floor(Date.now() / 1000);

/** Only the one call AppProvider makes is faked: the latest block's timestamp. */
function services(blockTimestamp: number): AppServices {
  return { chain: { publicClient: { getBlock: async () => ({ timestamp: BigInt(blockTimestamp) }) } } } as unknown as AppServices;
}

afterEach(() => {
  cleanup();
  setClockOffset(0);
});

describe("one clock for every countdown", () => {
  it("currentSeconds and useNow follow the offset", () => {
    setClockOffset(600);
    expect(Math.abs(currentSeconds() - (localNow() + 600))).toBeLessThanOrEqual(1);
    const { result } = renderHook(() => useNow());
    expect(Math.abs(result.current - (localNow() + 600))).toBeLessThanOrEqual(1);
  });

  it("a computer clock minutes behind the chain is moved onto it", async () => {
    render(<AppProvider services={services(localNow() + 300)}>x</AppProvider>);
    await waitFor(() => expect(Math.abs(getClockOffset() - 300)).toBeLessThanOrEqual(2));
  });

  it("a clock minutes ahead of the chain is moved back", async () => {
    render(<AppProvider services={services(localNow() - 180)}>x</AppProvider>);
    await waitFor(() => expect(Math.abs(getClockOffset() + 180)).toBeLessThanOrEqual(2));
  });

  it("a clock that is only a block's lag off is left alone", async () => {
    render(<AppProvider services={services(localNow() - 2)}>x</AppProvider>);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getClockOffset()).toBe(0);
  });
});
