import { describe, expect, it } from "vitest";
import { luminanceOf, pickUnderline } from "../src/x/underline";

const COBALT = "#2B45E0";
const LIME = "#B9F302";

describe("cashtag underline colour", () => {
  it("uses lime on the dark X themes (Lights out and Dim)", () => {
    expect(pickUnderline("rgb(0, 0, 0)", COBALT, LIME)).toBe(LIME);
    expect(pickUnderline("rgb(21, 32, 43)", COBALT, LIME)).toBe(LIME);
  });

  it("uses cobalt on the light theme", () => {
    expect(pickUnderline("rgb(255, 255, 255)", COBALT, LIME)).toBe(COBALT);
  });

  it("falls back to cobalt when the background cannot be read", () => {
    expect(pickUnderline("", COBALT, LIME)).toBe(COBALT);
    expect(luminanceOf("transparent")).toBeNull();
  });

  it("reads rgba and space-separated syntax", () => {
    expect(luminanceOf("rgba(255, 255, 255, 1)")).toBeCloseTo(1, 3);
    expect(luminanceOf("rgb(0 0 0)")).toBe(0);
  });
});
