import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { CHART_HEIGHT, GUTTER_TAG_HEIGHT, gutterLabelsCollide, gutterWidth, linePath, nearestIndex, projectChart, timeTicks } from "../../chart";
import { COPY } from "../../copy";
import { formatUsdPrice } from "../../view";
import type { ChartView } from "../../react/useMarketChart";
import { Button, Skeleton, cx } from "../primitives";

/** Used for tick collision until the plot has been measured (jsdom never measures). */
const FALLBACK_PLOT_WIDTH_PX = 358;
const RANGE_LABEL = { "24h": "last 24 hours", "7d": "last 7 days" } as const;

export interface ScrubPoint {
  t: number;
  price: string;
}

export interface PriceChartProps {
  view: ChartView;
  /** Colours the line: up (lime in the dark theme) or down. */
  up: boolean;
  /** The live price, so the tag reads exactly like the header; the chart's last point is rounded to 7 digits. */
  currentPrice?: string | null;
  onScrub?(point: ScrubPoint | null): void;
}

/** Keeps a gutter label's whole box inside the plot height, whatever fraction the price maps to. */
const clampedTop = (fraction: number, heightPx: number): string =>
  `clamp(0px, calc(${fraction * 100}% - ${heightPx / 2}px), calc(100% - ${heightPx}px))`;
const LABEL_HEIGHT_PX = 16;

/**
 * Dependency-free price chart. The line is an SVG stretched with preserveAspectRatio none (non-scaling stroke keeps
 * it 2px); everything that must not stretch, such as the dot and the labels, is plain HTML positioned in percent.
 */
export function PriceChart({ view, up, currentPrice, onScrub }: PriceChartProps) {
  const { chart, loading, error, retry } = view;
  const plot = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const projection = useMemo(() => (chart ? projectChart(chart) : null), [chart]);
  const [plotWidth, setPlotWidth] = useState(FALLBACK_PLOT_WIDTH_PX);
  const ticks = useMemo(() => (chart && projection ? timeTicks(projection.points, chart.range, { plotWidthPx: plotWidth }) : []), [chart, projection, plotWidth]);
  const hasPlot = chart !== null && projection !== null;

  // Measure the real plot so tick collision follows the card width and the price-tag gutter.
  useEffect(() => {
    const el = plot.current;
    if (!el) return;
    const measure = (): void => { if (el.clientWidth > 0) setPlotWidth(el.clientWidth); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasPlot]);

  if (!chart || !projection) {
    if (loading) return <Skeleton className="h-[108px] w-full" />;
    if (error) {
      return (
        <div role="alert" className="flex h-[108px] items-center justify-between gap-3 text-14 text-no">
          <span>{COPY.chart_error}</span>
          <Button size="sm" variant="secondary" onClick={retry}>Try again</Button>
        </div>
      );
    }
    return <div className="flex h-[108px] items-center text-14 text-mute">{COPY.no_chart_data}</div>;
  }

  const color = up ? "var(--px-up)" : "var(--px-down)";
  const last = projection.points[projection.points.length - 1];
  const openLabel = formatUsdPrice(chart.openUsd);
  const lastLabel = last ? formatUsdPrice(currentPrice ?? last.price) : "";
  const gutter = gutterWidth([openLabel, lastLabel]);
  const hideOpen = last !== undefined && gutterLabelsCollide(projection.openY, projection.lastY);
  const lastIndex = projection.points.length - 1;
  const shown = active !== null ? projection.points[active] : undefined;

  const move = (event: PointerEvent<HTMLDivElement>): void => {
    const box = plot.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const index = nearestIndex(projection.points, fraction);
    setActive(index);
    const point = projection.points[index];
    if (point) onScrub?.({ t: point.t, price: point.price });
  };
  const leave = (): void => {
    setActive(null);
    onScrub?.(null);
  };
  const select = (index: number): void => {
    const clamped = Math.min(lastIndex, Math.max(0, index));
    setActive(clamped);
    const point = projection.points[clamped];
    if (point) onScrub?.({ t: point.t, price: point.price });
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>): void => {
    const from = active ?? lastIndex;
    if (event.key === "ArrowLeft") select(from - 1);
    else if (event.key === "ArrowRight") select(from + 1);
    else if (event.key === "Home") select(0);
    else if (event.key === "End") select(lastIndex);
    else if (event.key === "Escape" && active !== null) {
      // Ends the scrub only; with nothing to end the key goes on to close the card.
      event.stopPropagation();
      leave();
      return;
    } else return;
    event.preventDefault();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex" style={{ height: CHART_HEIGHT }}>
        <div
          ref={plot}
          data-testid="chart-plot"
          className="relative min-w-0 flex-1 cursor-crosshair touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber"
          role="slider"
          tabIndex={0}
          aria-label={`${chart.symbol} price scrub`}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={lastIndex}
          aria-valuenow={active ?? lastIndex}
          aria-valuetext={shown ? formatUsdPrice(shown.price) : lastLabel}
          onPointerMove={move}
          onPointerLeave={leave}
          onKeyDown={keys}
          onBlur={leave}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" role="img" aria-label={`${chart.symbol} price, ${RANGE_LABEL[chart.range]}`}>
            <line
              x1="0" x2="100" y1={projection.openY * 100} y2={projection.openY * 100}
              stroke="var(--px-rule)" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke"
            />
            <path d={linePath(projection.points)} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {shown ? (
            <>
              <div aria-hidden className="absolute top-0 h-full border-l border-mute" style={{ left: `${shown.x * 100}%` }} />
              <div
                aria-hidden
                className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, background: color }}
              />
            </>
          ) : null}
        </div>
        <div className="relative shrink-0 overflow-hidden" style={{ width: gutter }}>
          {hideOpen ? null : (
            <span
              data-testid="open-price-label"
              className="px-tnum absolute left-2 whitespace-nowrap text-12 text-mute"
              style={{ top: clampedTop(projection.openY, LABEL_HEIGHT_PX), height: LABEL_HEIGHT_PX, lineHeight: `${LABEL_HEIGHT_PX}px` }}
            >
              {openLabel}
            </span>
          )}
          {last ? (
            <span
              data-testid="last-price-tag"
              className={cx("px-tnum absolute left-2 whitespace-nowrap rounded-input bg-amber px-1 text-12 font-medium text-amber-ink")}
              style={{ top: clampedTop(projection.lastY, GUTTER_TAG_HEIGHT), height: GUTTER_TAG_HEIGHT, lineHeight: `${GUTTER_TAG_HEIGHT}px` }}
            >
              {lastLabel}
            </span>
          ) : null}
        </div>
      </div>
      <div className="relative h-4" style={{ marginRight: gutter }} aria-hidden>
        {ticks.map((tick) => (
          <span
            key={tick.label + tick.x}
            className="absolute whitespace-nowrap text-12 text-mute"
            style={tick.anchor === "end" ? { right: 0 } : { left: `${tick.x * 100}%`, transform: "translateX(-50%)" }}
          >
            {tick.label}
          </span>
        ))}
      </div>
      {view.stale ? <span role="status" className="text-12 text-mute">{COPY.chart_delayed}</span> : null}
    </div>
  );
}
