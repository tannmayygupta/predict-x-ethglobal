import type { Pool } from "@predictx/shared";
import { Button, COPY, Countdown, Notice, OddsBar, Skeleton, StatusBadge, effectiveStatus, loadError, poolSize, useNow, usePools } from "@predictx/ui";
import { Link } from "react-router-dom";
import { api } from "../services";

function PoolCard({ pool }: { pool: Pool }) {
  const now = useNow();
  const status = effectiveStatus(pool, now);
  return (
    <Link to={`/pool/${pool.id}`} className="px-slip block text-text no-underline" aria-label={`Pool ${pool.id}: ${pool.question}`}>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <span className="text-12 text-mute">Pool #{pool.id}</span>
          <StatusBadge pool={pool} />
        </div>
        <p className="line-clamp-2 font-display text-16 font-semibold">{pool.question}</p>
        <div className="flex justify-between text-13 text-mute">
          <span>{status === "open" ? <>Closes in <Countdown resolveTime={pool.resolveTime} /></> : status === "resolved" ? (pool.outcome === "yes" ? COPY.result_yes : COPY.result_no) : "Closed"}</span>
          <span>Pool {poolSize(pool.yesTotal, pool.noTotal)} USDC</span>
        </div>
      </div>
      <div className="px-slip__tear" />
      <div className="p-4">
        <OddsBar yesTotal={pool.yesTotal} noTotal={pool.noTotal} />
      </div>
    </Link>
  );
}

/** D1: the latest 20 pools straight from the backend, refreshed every 10 s. */
export function Home() {
  const { pools, error, loading, reload } = usePools(api);
  return (
    <main className="mx-auto max-w-[960px] px-4 py-8">
      <h1 className="mb-6 font-display text-28 font-bold">Latest predictions</h1>
      {loading ? (
        <div className="grid grid-cols-1 gap-4 min-[800px]:grid-cols-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[150px]" />)}
        </div>
      ) : error && !pools ? (
        <Notice kind="error" action={<Button size="sm" variant="secondary" onClick={reload}>Try again</Button>}>{loadError("predictions")}</Notice>
      ) : pools && pools.length === 0 ? (
        <p className="text-14 text-mute">{COPY.empty_pools}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 min-[800px]:grid-cols-2">{pools?.map((p) => <PoolCard key={p.id} pool={p} />)}</div>
      )}
    </main>
  );
}
