import { describe, expect, it } from "vitest";
import { TtlCache } from "../../src/util/cache";
import { FakeClock } from "../helpers/fakes/clock";

const TTL = 30;

describe("B01-cache-1 empty cache", () => {
  it("get returns undefined and size is 0", () => {
    const cache = new TtlCache<string>(new FakeClock(), TTL);
    expect(cache.get("eth")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });
});

describe("B01-cache-2 set then get", () => {
  it("returns the value with storedAt = clock.now()", () => {
    const clock = new FakeClock();
    clock.set(1000);
    const cache = new TtlCache<string>(clock, TTL);
    cache.set("eth", "2451.12");
    expect(cache.get("eth")).toEqual({ value: "2451.12", storedAt: 1000 });
    expect(cache.size()).toBe(1);
  });
});

describe("B01-cache-3 isFresh boundary", () => {
  it("is fresh before ttl and stale at exactly ttl", () => {
    const clock = new FakeClock();
    clock.set(1000);
    const cache = new TtlCache<string>(clock, TTL);
    cache.set("eth", "1");
    expect(cache.isFresh("eth")).toBe(true);
    clock.advance(TTL - 1);
    expect(cache.isFresh("eth")).toBe(true);
    clock.advance(1);
    expect(cache.isFresh("eth")).toBe(false);
    expect(cache.isFresh("missing")).toBe(false);
  });
});

describe("B01-cache-4 stale entries stay readable", () => {
  it("get returns the entry after ttl so callers can serve stale on upstream error", () => {
    const clock = new FakeClock();
    clock.set(1000);
    const cache = new TtlCache<string>(clock, TTL);
    cache.set("eth", "1");
    clock.advance(TTL * 10);
    expect(cache.isFresh("eth")).toBe(false);
    expect(cache.get("eth")).toEqual({ value: "1", storedAt: 1000 });
  });
});

describe("B01-cache-5 getFresh", () => {
  it("returns the value only while fresh", () => {
    const clock = new FakeClock();
    const cache = new TtlCache<number>(clock, TTL);
    expect(cache.getFresh("eth")).toBeUndefined();
    cache.set("eth", 7);
    expect(cache.getFresh("eth")).toBe(7);
    clock.advance(TTL);
    expect(cache.getFresh("eth")).toBeUndefined();
  });
});

describe("B01-cache-6 overwrite", () => {
  it("set on an existing key replaces the value, refreshes storedAt and keeps size at one", () => {
    const clock = new FakeClock();
    clock.set(1000);
    const cache = new TtlCache<string>(clock, TTL);
    cache.set("eth", "old");
    clock.advance(TTL);
    expect(cache.isFresh("eth")).toBe(false);
    cache.set("eth", "new");
    expect(cache.get("eth")).toEqual({ value: "new", storedAt: 1000 + TTL });
    expect(cache.isFresh("eth")).toBe(true);
    expect(cache.size()).toBe(1);
  });
});
