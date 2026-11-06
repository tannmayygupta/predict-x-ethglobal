import { buildQuestion } from "@predictx/shared";
import { describe, expect, it } from "vitest";
import { CONFIRMATION_BUFFER_SECONDS, prepareCreate, type CreateInput } from "../src/create";
import { UiError } from "../src/errors";

const NOW = 1_761_600_000;
const base: CreateInput = { symbol: "PEPE", coingeckoId: "pepe", direction: "above", strikeUsd: "0.0000120", durationSeconds: 180 };

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (e) {
    return e instanceof UiError ? e.code : "not a UiError";
  }
  return "did not throw";
}

describe("prepareCreate", () => {
  it("canonicalises the strike so the question matches what the API will serve later", () => {
    const p = prepareCreate(base, NOW);
    expect(p.strikeUsd).toBe("0.000012");
    expect(p.strikeE18).toBe(12_000_000_000_000n);
    expect(p.question).toContain("$0.000012");
    expect(p.question).not.toContain("0.0000120");
  });

  it("builds exactly the question the shared helper builds for the resolve time it chose", () => {
    const p = prepareCreate(base, NOW);
    expect(p.question).toBe(buildQuestion({ symbol: "PEPE", direction: "above", strikeUsd: "0.000012", resolveTime: p.resolveTime }));
  });

  it("rounds the resolve time up to a whole minute, so the HH:MM in the question is the real settle time", () => {
    const now = NOW + 17;
    const p = prepareCreate(base, now);
    const earliest = now + 180 + CONFIRMATION_BUFFER_SECONDS;
    expect(p.resolveTime % 60).toBe(0);
    expect(p.resolveTime).toBeGreaterThanOrEqual(earliest);
    expect(p.resolveTime).toBeLessThan(earliest + 60);
  });

  it("always leaves more than the contract minimum of 120 s", () => {
    for (let offset = 0; offset < 120; offset += 7) {
      expect(prepareCreate(base, NOW + offset).resolveTime - (NOW + offset)).toBeGreaterThan(120);
    }
  });

  it("encodes direction for the contract: 0 above, 1 below", () => {
    expect(prepareCreate(base, NOW).direction).toBe(0);
    expect(prepareCreate({ ...base, direction: "below" }, NOW).direction).toBe(1);
  });

  it.each([["abc"], [""], ["-5"], ["1e5"], ["0"], ["0.0"]])("rejects the strike %j with BAD_INPUT", (strikeUsd) => {
    expect(codeOf(() => prepareCreate({ ...base, strikeUsd }, NOW))).toBe("BAD_INPUT");
  });

  it("rejects durations that are not one of the presets", () => {
    expect(() => prepareCreate({ ...base, durationSeconds: 30 }, NOW)).toThrowError(/how long/);
  });

  it("rejects a question that would not fit onchain", () => {
    expect(() => prepareCreate({ ...base, symbol: "X".repeat(130) }, NOW)).toThrowError(/too long/);
  });
});
