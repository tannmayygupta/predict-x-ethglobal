import { describe, expect, it } from "vitest";
import { redact } from "../../../scripts/gate0-redact";

const API_KEY = "dpka_gate0_key_that_must_never_leak";
const REDACTED = "[redacted]";

describe("Gate 0 report redact()", () => {
  it("replaces a string that is exactly the API key", () => {
    expect(redact(API_KEY, API_KEY)).toBe(REDACTED);
  });

  it("scrubs the API key embedded inside a longer message, keeping the rest readable", () => {
    const message = `invalid api key ${API_KEY} for header x-definitive-api-key (${API_KEY})`;
    expect(redact({ error: message }, API_KEY)).toEqual({
      error: `invalid api key ${REDACTED} for header x-definitive-api-key (${REDACTED})`,
    });
  });

  it("leaves strings alone when the API key is empty (no split on '')", () => {
    expect(redact("plain text", "")).toBe("plain text");
  });

  it.each([
    ["a 65-byte signature (130 hex)", `0x${"ab".repeat(65)}`],
    ["exactly 128 hex chars", `0x${"cd".repeat(64)}`],
    ["a longer hex blob (e.g. a contract signature)", `0x${"ef".repeat(97)}`],
    ["upper-case hex", `0x${"AB".repeat(64)}`],
  ])("redacts %s", (_name, hex) => {
    expect(redact({ data: [hex] }, API_KEY)).toEqual({ data: [REDACTED] });
  });

  it.each([
    ["an address (40 hex)", "0x1111111111111111111111111111111111111111"],
    ["a tx hash (64 hex)", `0x${"12".repeat(32)}`],
    ["126 hex chars", `0x${"34".repeat(63)}`],
    ["130 chars with a non-hex character", `0x${"ab".repeat(64)}zz`],
  ])("keeps %s", (_name, value) => {
    expect(redact(value, API_KEY)).toBe(value);
  });

  it("keeps ERC-20 approve calldata (136 hex) so recorded fixtures stay valid, but still redacts other 136-char blobs", () => {
    const approve = `0x095ea7b3${"00".repeat(64)}`;
    expect(redact({ approveTx: { data: approve } }, API_KEY)).toEqual({ approveTx: { data: approve } });
    expect(redact(`0xdeadbeef${"00".repeat(64)}`, API_KEY)).toBe(REDACTED);
  });

  it("redacts any value under a key that names a signature, and keeps typed data readable", () => {
    const typed = '{"primaryType":"Order","message":{"nonce":"1"}}';
    expect(redact({ userSignature: "0xaaaa", evmOrderTypedData: typed }, API_KEY)).toEqual({
      userSignature: REDACTED,
      evmOrderTypedData: typed,
    });
  });

  it("passes numbers, booleans and null through", () => {
    expect(redact({ n: 1, b: true, z: null }, API_KEY)).toEqual({ n: 1, b: true, z: null });
  });
});
