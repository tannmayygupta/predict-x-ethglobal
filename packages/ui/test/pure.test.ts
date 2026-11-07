import { fixtures, type ChartPoint } from "@predictx/shared";
import { describe, expect, it } from "vitest";
import { gutterLabelsCollide, gutterWidth, linePath, nearestIndex, projectChart, scrubLabel, timeTicks } from "../src/chart";
import { applySlippageFloor, belowBy, diff, percentOver, roundTo, tidyPrice, toScaled } from "../src/decimal";
import { EM_DASH, formatPctDetail, formatUsdCompact, formatUsdDelta, isNegative } from "../src/marketFormat";
import {
  effectiveGap, expireAtFor, limitGap, limitPresetPrice, minReceiveOf, networkCost, orderExpiry, secondsLeft, slippageBelowSuggested,
} from "../src/components/swap/swapMath";

describe("formatters", () => {
  it("compacts money like the card", () => {
    expect(formatUsdCompact("273740000000")).toBe("$273.74B");
    expect(formatUsdCompact("138690000")).toBe("$138.69M");
    expect(formatUsdCompact("11580000000")).toBe("$11.58B");
    expect(formatUsdCompact(null)).toBe(EM_DASH);
  });
  it("signs the USD move exactly", () => {
    expect(formatUsdDelta("10.48")).toBe("+$10.48");
    expect(formatUsdDelta("-44.934")).toBe("-$44.93");
    expect(formatUsdDelta(null)).toBe(EM_DASH);
  });
  it("shows two-decimal percents", () => {
    expect(formatPctDetail(0.47)).toBe("+0.47%");
    expect(formatPctDetail(-1.8)).toBe("-1.80%");
    expect(formatPctDetail("-2.5")).toBe("-2.50%");
  });
  it("never prints -0.00% and never colours it as a loss", () => {
    expect(formatPctDetail(-0.001)).toBe("0.00%");
    expect(formatPctDetail("-0.001")).toBe("0.00%");
    expect(isNegative(-0.001)).toBe(false);
    expect(isNegative(-0.01)).toBe(true);
  });
  it("keeps significant digits for a sub-cent move", () => {
    expect(formatUsdDelta("0.0000002")).toBe("+$0.00000020");
    expect(formatUsdDelta("-0.000000204")).toBe("-$0.00000020");
    expect(formatUsdDelta("0.004")).toBe("+$0.0040");
    expect(formatUsdDelta("0")).toBe("+$0.00");
  });
});

describe("decimal", () => {
  it("round-trips and rounds exactly", () => {
    expect(roundTo(toScaled("1.005"), 2)).toBe("1.01");
    expect(roundTo(toScaled("-0.004"), 2)).toBe("0.00");
    expect(diff("2.5", "3")).toBe("-0.5");
    expect(percentOver("2380", "2400", 2)).toBe("-0.83");
    expect(percentOver("1", "0")).toBeNull();
  });
  it("builds limit prices and floors the minimum", () => {
    expect(belowBy("2000", "2")).toBe("1960");
    expect(tidyPrice("2401.9647")).toBe("2401.96");
    expect(tidyPrice("0.00001234567")).toBe("0.00001234");
    expect(applySlippageFloor("0.000816", "0.01", 18)).toBe("0.00080784");
    expect(applySlippageFloor("1.239", "0.5", 2)).toBe("0.61");
  });
});

describe("chart gutter", () => {
  it("widens for a long tiny price and keeps the default for short ones", () => {
    expect(gutterWidth(["$2,240", "$2,220"])).toBe(74);
    const wide = gutterWidth(["$0.000004982", "$0.000004989"]);
    expect(wide).toBeGreaterThanOrEqual(12 * 7.2 + 20);
  });
  it("detects labels that would touch", () => {
    expect(gutterLabelsCollide(0.5, 0.52)).toBe(true);
    expect(gutterLabelsCollide(0.2, 0.8)).toBe(false);
  });
});

describe("chart projection", () => {
  const chart = fixtures.marketChartEth;
  const projection = projectChart(chart);
  it("maps time to x and higher prices to smaller y, keeping the open line inside", () => {
    expect(projection.points[0]?.x).toBe(0);
    expect(projection.points.at(-1)?.x).toBe(1);
    const high = projection.yOf("2496.05");
    const low = projection.yOf("2441.90");
    expect(high).toBeLessThan(low);
    expect(projection.openY).toBeGreaterThanOrEqual(0);
    expect(projection.openY).toBeLessThanOrEqual(1);
  });
  it("draws a flat series through the middle", () => {
    const flat = projectChart({ points: [[1, "5"], [2, "5"]] as ChartPoint[], openUsd: "5" });
    expect(flat.points.map((p) => p.y)).toEqual([0.5, 0.5]);
  });
  it("builds a path and finds the nearest point", () => {
    expect(linePath(projection.points).startsWith("M0.000 ")).toBe(true);
    expect(nearestIndex(projection.points, 0.49)).toBe(2);
    expect(nearestIndex(projection.points, 5)).toBe(projection.points.length - 1);
  });
  it("labels 6h UTC boundaries in the chosen zone plus a right-anchored now", () => {
    // 2025-10-27 18:00 UTC .. 2025-10-28 18:00 UTC
    const start = 1761588000;
    const pts = projectChart({ points: [[start, "1"], [start + 86400, "2"]] as ChartPoint[], openUsd: "1" }).points;
    const ticks = timeTicks(pts, "24h", { timeZone: "UTC", plotWidthPx: 358 });
    expect(ticks.at(-1)).toEqual({ x: 1, label: "now", anchor: "end" });
    expect(ticks.some((t) => t.label === "12:00 AM")).toBe(true);
    expect(ticks.some((t) => t.label === "6:00 AM")).toBe(true);
  });
  it("drops labels that would overlap when the plot is tiny", () => {
    const start = 1761588000;
    const pts = projectChart({ points: [[start, "1"], [start + 86400, "2"]] as ChartPoint[], openUsd: "1" }).points;
    const tight = timeTicks(pts, "24h", { timeZone: "UTC", plotWidthPx: 120 });
    const roomy = timeTicks(pts, "24h", { timeZone: "UTC", plotWidthPx: 358 });
    expect(tight.length).toBeLessThan(roomy.length);
  });
  it("formats the scrub time", () => {
    expect(scrubLabel(1761600000, "24h", "UTC")).toBe("9:20 PM");
  });
});

describe("swap maths", () => {
  const market = fixtures.quoteEthMarket;
  it("compares a limit price to the market", () => {
    expect(limitGap("2400", "2450")).toEqual({ kind: "below", pct: "2.04" });
    expect(limitGap("2450", "2450")).toEqual({ kind: "at_or_above" });
    expect(limitGap("3000", "2450")).toEqual({ kind: "at_or_above" });
    expect(limitGap("abc", "2450")).toBeNull();
    expect(limitPresetPrice("2000", "5")).toBe("1900");
  });
  it("derives the network cost from spend and receive, never negative", () => {
    expect(networkCost("5.00", "4.96")).toBe("0.04");
    expect(networkCost("2.00", "2.01")).toBe("0.00");
    expect(networkCost(null, "1")).toBeNull();
  });
  it("derives the effective gap and the minimum received", () => {
    expect(effectiveGap("2450.98", "2401.96")).toBe("2.04");
    expect(effectiveGap(null, "1")).toBeNull();
    expect(minReceiveOf(market, 18)).toBe("0.000807");
    expect(minReceiveOf({ ...market, minReceive: null }, 18)).toBe("0.00080784");
    expect(minReceiveOf({ ...market, minReceive: null, slippage: null }, 18)).toBe("0.000816");
  });
  it("counts down and picks the order expiry", () => {
    expect(secondsLeft(100, 40)).toBe(60);
    expect(secondsLeft(100, 200)).toBe(0);
    expect(expireAtFor("gtc", 1000)).toBeNull();
    expect(expireAtFor("1h", 1000)).toBe(4600);
    expect(orderExpiry(market, null)).toEqual({ kind: "at", unix: 1761600300 });
    expect(orderExpiry(fixtures.quoteEthLimit, null)).toEqual({ kind: "open_ended" });
    expect(orderExpiry(fixtures.quoteEthLimit, 5000)).toEqual({ kind: "at", unix: 5000 });
  });
  it("flags a slippage below Flash's suggestion", () => {
    expect(slippageBelowSuggested("0.01", "0.15")).toBe(true);
    expect(slippageBelowSuggested("0.15", "0.15")).toBe(false);
    expect(slippageBelowSuggested("0.01", null)).toBe(false);
  });
});
