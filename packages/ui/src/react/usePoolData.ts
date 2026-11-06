import type { Pool, Position } from "@predictx/shared";
import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import type { ApiClient, ApiClientError } from "../api";
import { readPoolFresh, readPositionFresh, type ChainClients } from "../chain";
import { startPolling, type Poller } from "../poll";

/** UI_REFERENCE section 6: pools refresh every 10 s, and right after any transaction. */
export const POOL_REFRESH_MS = 10_000;
/** The backend caches pool reads for 10 s, so for a while after a transaction the chain itself is read. */
const CHAIN_MODE_MS = 20_000;

export interface PoolData {
  pool: Pool | null;
  position: Position | null;
  error: ApiClientError | null;
  loading: boolean;
  /** Call after a transaction: reads the chain directly so the screen reflects the new state at once (D-T6). */
  refresh(): void;
}

interface Snapshot {
  pool: Pool;
  position: Position | null;
}

export function usePoolData(opts: { api: ApiClient; chain: ChainClients; poolId: number; address: Address | null }): PoolData {
  const { api, chain, poolId, address } = opts;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [loading, setLoading] = useState(true);
  const chainUntil = useRef(0);
  const poller = useRef<Poller | null>(null);

  useEffect(() => {
    setLoading(true);
    setSnapshot(null);
    const read = async (): Promise<Snapshot> => {
      if (Date.now() < chainUntil.current) {
        const [pool, position] = await Promise.all([readPoolFresh(chain, poolId), address ? readPositionFresh(chain, poolId, address) : null]);
        return { pool, position };
      }
      const [pool, position] = await Promise.all([api.pool(poolId), address ? api.position(poolId, address) : null]);
      return { pool, position };
    };
    const p = startPolling(read, POOL_REFRESH_MS, {
      onData: (value) => {
        setSnapshot(value);
        setError(null);
        setLoading(false);
      },
      onError: (err) => {
        setError(err as ApiClientError);
        setLoading(false);
      },
    });
    poller.current = p;
    return () => {
      p.stop();
      poller.current = null;
    };
  }, [api, chain, poolId, address]);

  return {
    pool: snapshot?.pool ?? null,
    position: snapshot?.position ?? null,
    error,
    loading,
    refresh() {
      chainUntil.current = Date.now() + CHAIN_MODE_MS;
      poller.current?.refresh();
    },
  };
}

export interface PoolList {
  pools: Pool[] | null;
  error: ApiClientError | null;
  loading: boolean;
  reload(): void;
}

export function usePools(api: ApiClient): PoolList {
  const [pools, setPools] = useState<Pool[] | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const p = startPolling(() => api.pools(), POOL_REFRESH_MS, {
      onData: (list) => {
        setPools(list);
        setError(null);
        setLoading(false);
      },
      onError: (err) => {
        setError(err as ApiClientError);
        setLoading(false);
      },
    });
    return p.stop;
  }, [api, attempt]);

  return { pools, error, loading, reload: () => setAttempt((n) => n + 1) };
}
