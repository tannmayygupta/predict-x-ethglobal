import type { Pool } from "@predictx/shared";
import { readPoolFresh, type ChainClients } from "./chain";
import type { PreparedPool } from "./create";

/** What the post step needs; a full Pool satisfies it. */
export type PostablePool = Pick<Pool, "id" | "question" | "dashboardUrl">;

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 1_500;

export interface PostableOptions {
  attempts?: number;
  delayMs?: number;
  read?: (chain: ChainClients, id: number) => Promise<Pool>;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The pool is already onchain by the time this runs, so it must never fail: reading it back only supplies the post
 * text. An RPC node that is one block behind can answer "pool not found" for a moment, so it retries, and if the
 * chain still will not answer it falls back to the question and link we already know. Reporting a created pool as a
 * failure would invite the user to press Create again and pay for a duplicate.
 */
export async function postablePool(chain: ChainClients, poolId: number, prepared: PreparedPool, options: PostableOptions = {}): Promise<PostablePool> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const read = options.read ?? readPoolFresh;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await read(chain, poolId);
    } catch {
      if (attempt < attempts) await sleep(delayMs);
    }
  }
  return { id: poolId, question: prepared.question, dashboardUrl: `${chain.dashboardUrl.replace(/\/+$/, "")}/pool/${poolId}` };
}
