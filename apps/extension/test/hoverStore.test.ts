import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOSE_DELAY_MS, OPEN_DELAY_MS, createHoverStore, placeCard } from "../src/x/hoverStore";

const anchor = { left: 100, top: 200, right: 140, bottom: 220 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("hover timings (FR-X-02)", () => {
  it("opens only after 300 ms on the tag", () => {
    const s = createHoverStore();
    s.enterTag("ETH", anchor);
    vi.advanceTimersByTime(OPEN_DELAY_MS - 1);
    expect(s.getState().symbol).toBeNull();
    vi.advanceTimersByTime(1);
    expect(s.getState()).toEqual({ symbol: "ETH", anchor });
  });

  it("does not open if the pointer leaves before 300 ms", () => {
    const s = createHoverStore();
    s.enterTag("ETH", anchor);
    vi.advanceTimersByTime(200);
    s.leaveTag();
    vi.advanceTimersByTime(1000);
    expect(s.getState().symbol).toBeNull();
  });

  it("closes 150 ms after leaving the tag", () => {
    const s = createHoverStore();
    s.enterTag("ETH", anchor);
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    s.leaveTag();
    vi.advanceTimersByTime(CLOSE_DELAY_MS - 1);
    expect(s.getState().symbol).toBe("ETH");
    vi.advanceTimersByTime(1);
    expect(s.getState().symbol).toBeNull();
  });

  it("stays open while the pointer moves from the tag onto the card", () => {
    const s = createHoverStore();
    s.enterTag("ETH", anchor);
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    s.leaveTag();
    vi.advanceTimersByTime(100);
    s.enterCard();
    vi.advanceTimersByTime(5000);
    expect(s.getState().symbol).toBe("ETH");
  });

  it("closes 150 ms after leaving the card", () => {
    const s = createHoverStore();
    s.enterTag("ETH", anchor);
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    s.enterCard();
    s.leaveCard();
    vi.advanceTimersByTime(CLOSE_DELAY_MS);
    expect(s.getState().symbol).toBeNull();
  });

  it("re-entering the same open tag keeps the card and cancels a pending close", () => {
    const s = createHoverStore();
    s.enterTag("ETH", anchor);
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    s.leaveTag();
    vi.advanceTimersByTime(100);
    s.enterTag("ETH", anchor);
    vi.advanceTimersByTime(1000);
    expect(s.getState().symbol).toBe("ETH");
  });

  it("only one card at a time: a different tag replaces the open one", () => {
    const s = createHoverStore();
    s.enterTag("ETH", anchor);
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    s.leaveTag();
    s.enterTag("BTC", anchor);
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    expect(s.getState().symbol).toBe("BTC");
  });

  it("Escape (close) is immediate and cancels pending timers", () => {
    const s = createHoverStore();
    s.enterTag("ETH", anchor);
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    s.close();
    expect(s.getState().symbol).toBeNull();
    s.enterTag("BTC", anchor);
    s.close();
    vi.advanceTimersByTime(1000);
    expect(s.getState().symbol).toBeNull();
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const s = createHoverStore();
    const listener = vi.fn();
    const off = s.subscribe(listener);
    s.enterTag("ETH", anchor);
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    s.close();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("placeCard", () => {
  const card = { width: 340, height: 360 };
  const viewport = { width: 1200, height: 900 };

  it("sits 8 px below the tag when there is room", () => {
    expect(placeCard(anchor, viewport, card)).toEqual({ left: 100, top: 228 });
  });

  it("flips above the tag when less than the card height fits below", () => {
    const low = { left: 100, top: 700, right: 140, bottom: 720 };
    expect(placeCard(low, viewport, card)).toEqual({ left: 100, top: 700 - 8 - 360 });
  });

  it("clamps to the viewport with a 12 px margin on both sides", () => {
    expect(placeCard({ ...anchor, left: 1190 }, viewport, card).left).toBe(1200 - 340 - 12);
    expect(placeCard({ ...anchor, left: -50 }, viewport, card).left).toBe(12);
  });

  it("never goes above the top margin", () => {
    const high = { left: 100, top: 100, right: 140, bottom: 120 };
    expect(placeCard(high, { width: 1200, height: 300 }, card).top).toBe(12);
  });
});
