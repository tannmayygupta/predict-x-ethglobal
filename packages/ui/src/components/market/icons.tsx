/**
 * Inline SVG icons. x.com's CSP blocks remote images, so token and chain artwork ships in the bundle. Hard-coded
 * colours are allowed here only because this is brand artwork. No contract addresses live in this module.
 */
import type { ReactNode } from "react";

const BRAND = { ETH: "#627EEA", BTC: "#F7931A", BASE: "#0052FF" } as const;

function EthGlyph() {
  return (
    <g fill="#FFFFFF">
      <path d="M24 9 15.5 24.2 24 29.2l8.5-5z" opacity="0.9" />
      <path d="M24 9v20.2l8.5-5z" opacity="0.6" />
      <path d="m24 31.4-8.5-5L24 39l8.5-12.6z" opacity="0.9" />
    </g>
  );
}

function BtcGlyph() {
  return (
    <text x="24" y="32" textAnchor="middle" fontSize="24" fontWeight="700" fill="#FFFFFF" fontFamily="system-ui, sans-serif">
      {"₿"}
    </text>
  );
}

const GLYPHS: Record<string, { fill: string; glyph: ReactNode }> = {
  ETH: { fill: BRAND.ETH, glyph: <EthGlyph /> },
  BTC: { fill: BRAND.BTC, glyph: <BtcGlyph /> },
};

/** Token icon keyed by symbol; unknown tokens get a neutral monogram so a new listing never shows a broken image. */
export function TokenIcon({ symbol, size = 48 }: { symbol: string; size?: number }) {
  const known = GLYPHS[symbol.toUpperCase()];
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={symbol} className="shrink-0">
      <circle cx="24" cy="24" r="24" fill={known ? known.fill : "var(--px-ink-3)"} />
      {known ? (
        known.glyph
      ) : (
        <text x="24" y="31" textAnchor="middle" fontSize="20" fontWeight="600" fill="var(--px-text)" fontFamily="var(--px-font-body)">
          {symbol.slice(0, 1).toUpperCase()}
        </text>
      )}
    </svg>
  );
}

/** 20px round chain badge, ringed by the surface colour so it cuts into the token circle. */
export function ChainBadge({ chain, size = 20 }: { chain: "base"; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      role="img"
      aria-label={chain === "base" ? "Base" : chain}
      className="shrink-0 rounded-full"
      style={{ boxShadow: "0 0 0 2px var(--px-ink)" }}
    >
      <circle cx="10" cy="10" r="10" fill={BRAND.BASE} />
      {/* Base mark: the blue disc with a white bar cut in from the right. */}
      <rect x="9.2" y="8.8" width="10.8" height="2.4" fill="#FFFFFF" />
    </svg>
  );
}

/** The PredictX mark, derived from the product logo (rising line with an end dot), in the accent colour. */
export function PredictXMark({ width = 28, height = 25 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="9 16 47 33" fill="none" aria-hidden className="shrink-0">
      <path d="M14 44 26 32l9 7 15-17" stroke="var(--px-amber)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="50" cy="22" r="4.5" fill="var(--px-amber)" />
    </svg>
  );
}

export function ShieldCheck({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 1.5 2.5 3.6v4c0 3.2 2.3 5.6 5.5 6.9 3.2-1.3 5.5-3.7 5.5-6.9v-4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="m5.6 8 1.8 1.8 3-3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Chevron({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function KebabDots() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="8" cy="3" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="8" cy="13" r="1.4" />
    </svg>
  );
}
