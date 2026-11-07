/**
 * Pure chart maths for the price chart: projection, tick labels, nearest-point lookup. Prices stay strings; Number
 * is used only to turn a price into a pixel position.
 */
import type { ChartRange, MarketChart } from "@predictx/shared";

export const CHART_HEIGHT = 108;
export const CHART_GUTTER = 74;
/** Tag padding (4px each side), the 8px offset from the plot and a 4px right margin so the tag never touches the card edge. */
const TAG_CHROME_PX = 20;
export const GUTTER_TAG_HEIGHT = 18;
const TAG_GAP_PX = 2;
/** Fraction of the plot kept empty above and below the line so the stroke and tag are not clipped. */
const PAD = 0.08;
const SIX_HOURS = 6 * 3600;
const ONE_DAY = 24 * 3600;
/** Rough width of one 12px label character, used only to decide which labels would overlap. */
const LABEL_CHAR_PX = 7.2;
const LABEL_GAP_PX = 8;

export interface Plotted {
  t: number;
  price: string;
  /** Horizontal position as a fraction of the plot width, 0..1. */
  x: number;
  /** Vertical position as a fraction of the plot height, 0 (top) .. 1 (bottom). */
  y: number;
}

export interface Projection {
  points: Plotted[];
  /** Fraction (0 top .. 1 bottom) of any price, on the same scale as the line. */
  yOf(price: string): number;
  openY: number;
  lastY: number;
}

export function projectChart(chart: Pick<MarketChart, "points" | "openUsd">): Projection {
  const { points, openUsd } = chart;
  const prices = points.map(([, p]) => Number(p));
  const open = Number(openUsd);
  const lo = Math.min(open, ...prices);
  const hi = Math.max(open, ...prices);
  const span = hi - lo;
  const yOf = (price: string): number => {
    // A flat series would divide by zero; draw it through the middle.
    if (span === 0) return 0.5;
    return PAD + (1 - (Number(price) - lo) / span) * (1 - 2 * PAD);
  };
  const first = points[0]?.[0] ?? 0;
  const last = points[points.length - 1]?.[0] ?? first;
  const width = last - first;
  const plotted = points.map(([t, price]): Plotted => ({ t, price, x: width === 0 ? 0 : (t - first) / width, y: yOf(price) }));
  return { points: plotted, yOf, openY: yOf(openUsd), lastY: plotted[plotted.length - 1]?.y ?? 0.5 };
}

/** SVG path in a 0..100 by 0..100 viewBox (the SVG is stretched with preserveAspectRatio none). */
export function linePath(points: Plotted[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${(p.x * 100).toFixed(3)} ${(p.y * 100).toFixed(3)}`).join(" ");
}

/** Index of the point whose x is closest to `fraction` (0..1). */
export function nearestIndex(points: Plotted[], fraction: number): number {
  let best = 0;
  let bestDistance = Infinity;
  points.forEach((p, i) => {
    const d = Math.abs(p.x - fraction);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  return best;
}

export interface Tick {
  /** Fraction of the plot width, 0..1. */
  x: number;
  label: string;
  /** "now" is right-anchored so it never spills past the plot edge. */
  anchor: "center" | "end";
}

export interface TickOptions {
  /** IANA zone for labels; undefined means the viewer's local zone. */
  timeZone?: string;
  /** Plot width in px, only used to decide which labels would collide. */
  plotWidthPx: number;
}

function format(t: number, options: Intl.DateTimeFormatOptions, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat("en-US", { ...options, ...(timeZone ? { timeZone } : {}) }).format(new Date(t * 1000));
}

/**
 * Labels at UTC 6-hour boundaries (24h) or UTC midnights (7d), shown in local time, plus a right-anchored "now".
 * A label that would overlap its neighbour is dropped; "now" always wins over the boundary next to it.
 */
export function timeTicks(points: Plotted[], range: ChartRange, options: TickOptions): Tick[] {
  const first = points[0]?.t;
  const last = points[points.length - 1]?.t;
  if (first === undefined || last === undefined || last <= first) return [];
  const step = range === "24h" ? SIX_HOURS : ONE_DAY;
  const shape: Intl.DateTimeFormatOptions = range === "24h" ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" };
  const now: Tick = { x: 1, label: "now", anchor: "end" };
  const nowLeft = 1 - (now.label.length * LABEL_CHAR_PX) / options.plotWidthPx;
  const gap = LABEL_GAP_PX / options.plotWidthPx;
  const kept: Tick[] = [];
  let prevRight = -Infinity;
  for (let t = Math.ceil(first / step) * step; t <= last; t += step) {
    const label = format(t, shape, options.timeZone);
    const x = (t - first) / (last - first);
    const half = (label.length * LABEL_CHAR_PX) / 2 / options.plotWidthPx;
    if (x - half < 0 || x - half - gap < prevRight || x + half + gap > nowLeft) continue;
    kept.push({ x, label, anchor: "center" });
    prevRight = x + half;
  }
  return [...kept, now];
}

/** Time under the cursor while scrubbing: "5:30 AM" (24h) or "Nov 3, 5 AM" (7d). */
export function scrubLabel(t: number, range: ChartRange, timeZone?: string): string {
  const shape: Intl.DateTimeFormatOptions =
    range === "24h" ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric" };
  return format(t, shape, timeZone);
}

/** Gutter wide enough for the longest price label (by character count), never narrower than the default. */
export function gutterWidth(labels: string[]): number {
  const longest = Math.max(0, ...labels.map((l) => l.length));
  return Math.max(CHART_GUTTER, Math.ceil(longest * LABEL_CHAR_PX) + TAG_CHROME_PX);
}

/** True when two gutter labels at these fractional heights would touch, so the open label should be hidden. */
export function gutterLabelsCollide(openY: number, lastY: number, heightPx: number = CHART_HEIGHT): boolean {
  return Math.abs(openY - lastY) * heightPx < GUTTER_TAG_HEIGHT + TAG_GAP_PX;
}
