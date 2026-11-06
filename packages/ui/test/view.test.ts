import { describe, expect, it } from "vitest";
import { formatCountdown, oddsOf, poolSize } from "../src/view";

describe("oddsOf", () => {
  it("is empty with no bets", () => {
    expect(oddsOf("0", "0")).toEqual({ hasBets: false, yesPct: 0, noPct: 0, yesBar: 0, noBar: 0 });
  });
  it("computes the 60/40 example", () => {
    expect(oddsOf("60000000", "40000000")).toMatchObject({ yesPct: 60, noPct: 40, yesBar: 60, noBar: 40 });
  });
  it("always sums to 100 and keeps each side at least 4% wide when both exist", () => {
    const o = oddsOf("1", "999999");
    expect(o.yesPct + o.noPct).toBe(100);
    expect(o.yesBar).toBe(4);
    expect(o.noBar).toBe(96);
  });
  it("fills the bar when only one side has bets", () => {
    expect(oddsOf("5000000", "0")).toMatchObject({ yesPct: 100, yesBar: 100, noBar: 0 });
    expect(oddsOf("0", "5000000")).toMatchObject({ noPct: 100, noBar: 100, yesBar: 0 });
  });
});

describe("formatCountdown", () => {
  it("shows MM:SS under an hour", () => {
    expect(formatCountdown(1000 + 192, 1000)).toBe("03:12");
    expect(formatCountdown(1000 + 59, 1000)).toBe("00:59");
  });
  it("shows Hh Mm from one hour up", () => {
    expect(formatCountdown(1000 + 3600, 1000)).toBe("1h 0m");
    expect(formatCountdown(1000 + 3 * 3600 + 25 * 60 + 40, 1000)).toBe("3h 25m");
  });
  it("shows Closed at and after zero", () => {
    expect(formatCountdown(1000, 1000)).toBe("Closed");
    expect(formatCountdown(1000, 2000)).toBe("Closed");
  });
});

describe("poolSize", () => {
  it("adds both sides in USDC", () => {
    expect(poolSize("60000000", "40000000")).toBe("100.00");
  });
});

import { effectiveStatus, STATUS_LABEL } from "../src/view";

describe("effectiveStatus", () => {
  it("shows an open pool as awaiting once the local clock passes the close", () => {
    expect(effectiveStatus({ status: "open", resolveTime: 100 }, 99)).toBe("open");
    expect(effectiveStatus({ status: "open", resolveTime: 100 }, 100)).toBe("awaiting");
  });
  it("never changes a settled pool", () => {
    expect(effectiveStatus({ status: "resolved", resolveTime: 100 }, 50)).toBe("resolved");
    expect(effectiveStatus({ status: "void", resolveTime: 100 }, 50)).toBe("void");
  });
  it("has the four labels from FR-P-09", () => {
    expect(Object.values(STATUS_LABEL)).toEqual(["Open", "Awaiting result", "Resolved", "Void"]);
  });
});
