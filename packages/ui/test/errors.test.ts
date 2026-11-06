import { describe, expect, it } from "vitest";
import { UiError, toUiError } from "../src/errors";

const nested = (inner: object) => Object.assign(new Error("outer"), { cause: Object.assign(new Error("mid"), { cause: inner }) });

describe("toUiError", () => {
  it("passes a UiError through untouched", () => {
    const e = new UiError("NEED_USDC", "x");
    expect(toUiError(e)).toBe(e);
  });
  it("recognises a wallet rejection by EIP-1193 code anywhere in the cause chain", () => {
    expect(toUiError(nested({ code: 4001 })).code).toBe("USER_REJECTED");
    expect(toUiError(nested({ name: "UserRejectedRequestError" })).code).toBe("USER_REJECTED");
  });
  it("explains a wallet 4100 (site not approved for the account or network) instead of showing the raw text", () => {
    const e = toUiError(nested({ code: 4100 }));
    expect(e.code).toBe("NOT_AUTHORIZED");
    expect(e.message).toContain("MetaMask has not approved this site");
    expect(toUiError(nested({ name: "UnauthorizedProviderError" })).code).toBe("NOT_AUTHORIZED");
  });
  it.each([
    ["StakingClosed", "POOL_CLOSED"],
    ["ResolveTimeTooSoon", "RESOLVE_TOO_SOON"],
    ["NothingToClaim", "NOTHING_TO_CLAIM"],
    ["AlreadyClaimed", "ALREADY_CLAIMED"],
    ["PoolNotFound", "POOL_NOT_FOUND"],
    ["ZeroAmount", "BAD_INPUT"],
  ])("maps the %s revert to %s", (errorName, code) => {
    expect(toUiError(nested({ data: { errorName } })).code).toBe(code);
  });
  it("maps insufficient gas funds", () => {
    expect(toUiError(nested({ name: "InsufficientFundsError" })).code).toBe("NO_GAS");
  });
  it("keeps the original error as the cause of a generic chain error and never throws on odd input", () => {
    const original = new Error("boom");
    const mapped = toUiError(original);
    expect(mapped.code).toBe("CHAIN_ERROR");
    expect(mapped.cause).toBe(original);
    expect(toUiError("a string").code).toBe("CHAIN_ERROR");
    expect(toUiError(null).code).toBe("CHAIN_ERROR");
  });
  it("survives a cause cycle", () => {
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(toUiError(a).code).toBe("CHAIN_ERROR");
  });
});
