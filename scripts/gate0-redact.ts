/**
 * Secret scrubbing for the Gate 0 report (scripts/gate0-report.ts). Dependency-free so the backend's Vitest
 * suite can import it directly (apps/backend/test/gate0.redact.test.ts).
 */
const REDACTED = "[redacted]";
/** A 65-byte signature is 130 hex chars; any 0x-hex of 64 bytes or more is treated as one too. */
const SIGNATURE_HEX = /^0x[0-9a-fA-F]{128,}$/;
/**
 * ERC-20 approve(spender, amount) calldata (4-byte selector + two 32-byte words = 136 hex chars) is public data the
 * recorded fixtures must keep: Flash's quote carries it as steps.approveTx.data and the shared schema requires hex.
 */
const APPROVE_CALLDATA = /^0x095ea7b3[0-9a-fA-F]{128}$/;
const SIGNATURE_KEY = /signature/i;

/** Strips the key and anything that looks like, or is labelled as, a signature; typed data stays readable. */
export function redact(value: unknown, apiKey: string): unknown {
  if (typeof value === "string") {
    if (SIGNATURE_HEX.test(value) && !APPROVE_CALLDATA.test(value)) return REDACTED;
    // The key may be echoed inside an upstream message, so it is scrubbed wherever it appears.
    return apiKey.length > 0 ? value.split(apiKey).join(REDACTED) : value;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, apiKey));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, SIGNATURE_KEY.test(key) ? REDACTED : redact(item, apiKey)]),
    );
  }
  return value;
}
