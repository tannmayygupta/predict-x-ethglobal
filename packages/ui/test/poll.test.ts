import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPolling } from "../src/poll";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("startPolling", () => {
  it("reads immediately, then once per interval after each read finishes", async () => {
    const read = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValue(3);
    const seen: number[] = [];
    const poller = startPolling(read, 10_000, { onData: (v: number) => seen.push(v), onError: () => undefined });
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([1]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seen).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seen).toEqual([1, 2, 3]);
    poller.stop();
  });

  it("never overlaps reads, even when refresh() is called while one is in flight", async () => {
    const resolvers: Array<(v: number) => void> = [];
    const read = vi.fn(() => new Promise<number>((resolve) => { resolvers.push(resolve); }));
    const poller = startPolling(read, 10_000, { onData: () => undefined, onError: () => undefined });
    poller.refresh();
    poller.refresh();
    expect(read).toHaveBeenCalledTimes(1);
    resolvers[0]?.(1);
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();
  });

  it("a refresh during a read is not lost: the stale answer is dropped and a fresh read follows at once", async () => {
    const resolvers: Array<(v: string) => void> = [];
    const read = vi.fn(() => new Promise<string>((resolve) => { resolvers.push(resolve); }));
    const seen: string[] = [];
    const poller = startPolling(read, 10_000, { onData: (v: string) => seen.push(v), onError: () => undefined });
    expect(read).toHaveBeenCalledTimes(1);
    poller.refresh(); // for example right after a bet confirms, while the first read is still in flight
    resolvers[0]?.("before-the-bet");
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([]); // the pre-bet answer is never shown
    expect(read).toHaveBeenCalledTimes(2); // no waiting for the next 10 s tick
    resolvers[1]?.("after-the-bet");
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual(["after-the-bet"]);
    poller.stop();
  });

  it("a refresh while idle reads immediately and does not double up the schedule", async () => {
    const read = vi.fn().mockResolvedValue(1);
    const poller = startPolling(read, 10_000, { onData: () => undefined, onError: () => undefined });
    await vi.advanceTimersByTimeAsync(0);
    poller.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it("reports errors and keeps polling", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue("ok");
    const data: string[] = [];
    const errors: unknown[] = [];
    const poller = startPolling(read, 5_000, { onData: (v: string) => data.push(v), onError: (e) => errors.push(e) });
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(data).toEqual(["ok"]);
    poller.stop();
  });

  it("stop() ends the schedule and drops a late result", async () => {
    let resolveRead: (v: number) => void = () => undefined;
    const read = vi.fn(() => new Promise<number>((resolve) => { resolveRead = resolve; }));
    const seen: number[] = [];
    const poller = startPolling(read, 1_000, { onData: (v) => seen.push(v), onError: () => undefined });
    poller.stop();
    resolveRead(7);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(seen).toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
