// @vitest-environment jsdom
import { fixtures } from "@predictx/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../src/api";
import { InsightPanel, insightErrorText } from "../src/components/InsightPanel";
import { clearInsightCache } from "../src/components/insightCache";
import { COPY } from "../src/copy";
import { fakeApi, withApp } from "./support";

beforeEach(() => clearInsightCache());
afterEach(cleanup);

const panel = (api = fakeApi(), onUseLimit = vi.fn()) =>
  render(withApp(api, <InsightPanel symbol="ETH" canTrade onUseLimit={onUseLimit} />));

describe("InsightPanel", () => {
  it("shows the loading state while the tip is being written", async () => {
    panel(fakeApi({ insight: () => new Promise(() => undefined) }));
    fireEvent.click(screen.getByRole("button", { name: COPY.insight_cta }));
    expect(await screen.findByText(COPY.insight_loading)).toBeTruthy();
  });

  it("shows the tip, badges and the limit row against spot with the time", async () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: COPY.insight_cta }));
    expect(await screen.findByText(fixtures.insightEth.tip)).toBeTruthy();
    expect(screen.getByText("Neutral")).toBeTruthy();
    expect(screen.getByText("Low confidence")).toBeTruthy();
    expect(screen.getByText(/Suggested limit \$2,380\.00 \(-2\.9% vs spot \$2,451\.12, as of \d\d:\d\d\)/)).toBeTruthy();
  });

  it("hands the swap tab the symbol, price and spot", async () => {
    const onUseLimit = vi.fn();
    panel(fakeApi(), onUseLimit);
    fireEvent.click(screen.getByRole("button", { name: COPY.insight_cta }));
    fireEvent.click(await screen.findByRole("button", { name: COPY.use_limit }));
    expect(onUseLimit).toHaveBeenCalledWith("2380.00", { symbol: "ETH", priceUsd: "2380.00", spotUsd: "2451.12" });
  });

  it("says so when there is no limit, and keeps the degraded notice with a retry", async () => {
    const degraded = { ...fixtures.insightEth, suggestedLimit: null, degraded: true };
    const insight = vi.fn().mockResolvedValue(degraded);
    panel(fakeApi({ insight }));
    fireEvent.click(screen.getByRole("button", { name: COPY.insight_cta }));
    expect(await screen.findByText(COPY.insight_empty)).toBeTruthy();
    expect(screen.getByText(COPY.insight_degraded)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: COPY.insight_retry }));
    await waitFor(() => expect(insight).toHaveBeenCalledTimes(2));
  });

  it("does not cache a degraded result", async () => {
    const degraded = { ...fixtures.insightEth, degraded: true };
    const first = panel(fakeApi({ insight: vi.fn().mockResolvedValue(degraded) }));
    fireEvent.click(screen.getByRole("button", { name: COPY.insight_cta }));
    await screen.findByText(COPY.insight_degraded);
    first.unmount();
    panel(fakeApi({ insight: () => new Promise(() => undefined) }));
    expect(screen.queryByText(COPY.insight_degraded)).toBeNull();
  });

  it("writes midnight as 00:05, never 24:05", () => {
    const parts = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 1, 0, 5)));
    expect(parts).toBe("00:05");
  });

  it("maps each error code to its own message", () => {
    const text = (code: ApiClientError["code"]) => insightErrorText(new ApiClientError(code, "x", 500));
    expect(text("RATE_LIMITED")).toBe(COPY.insight_rate_limited);
    expect(text("UNSUPPORTED_TOKEN")).toBe(COPY.insight_unsupported);
    expect(text("LLM_UNAVAILABLE")).toBe(COPY.insight_llm_unavailable);
    expect(text("NETWORK")).toBe(COPY.insight_network);
    expect(text("INTERNAL")).toContain("Couldn't load");
  });

  it("renders the error state from a failed call", async () => {
    panel(fakeApi({ insight: () => Promise.reject(new ApiClientError("RATE_LIMITED", "slow down", 429)) }));
    fireEvent.click(screen.getByRole("button", { name: COPY.insight_cta }));
    expect((await screen.findByRole("alert")).textContent).toContain(COPY.insight_rate_limited);
  });

  it("keeps the result when the tab is left and reopened", async () => {
    const first = panel();
    fireEvent.click(screen.getByRole("button", { name: COPY.insight_cta }));
    await screen.findByText(fixtures.insightEth.tip);
    first.unmount();
    const insight = vi.fn();
    panel(fakeApi({ insight }));
    expect(screen.getByText(fixtures.insightEth.tip)).toBeTruthy();
    expect(insight).not.toHaveBeenCalled();
  });
});
