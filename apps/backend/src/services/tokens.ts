import { TokensResponse, type Token } from "@predictx/shared";
import tokensJson from "@predictx/shared/tokens.json";
import { unsupportedToken } from "../errors";

/** Parsed once at startup so a malformed allowlist fails the boot, never the first request. */
export const tokensResponse = TokensResponse.parse(tokensJson);
export const tokens: readonly Token[] = tokensResponse.tokens;

/** Cashtags on X are typed in any case ($eth, $Eth); the allowlist is canonical upper case. */
export function findToken(symbol: string): Token | undefined {
  const wanted = symbol.toUpperCase();
  return tokens.find((t) => t.symbol === wanted);
}

/** Routes call this: a symbol outside the allowlist is UNSUPPORTED_TOKEN per API_CONTRACT section 1. */
export function requireToken(symbol: string): Token {
  const token = findToken(symbol);
  if (!token) throw unsupportedToken(`Unsupported token: ${symbol}`);
  return token;
}
