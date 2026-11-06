import { CHAINS, buildTweetText, formatUsdc, type Pool, type Position } from "@predictx/shared";
import { AddressChip, Button, COPY, Notice, PoolSlip, Skeleton, StatusBadge, loadError, shortAddress, useWallet, usePoolData, type SlipEvent } from "@predictx/ui";
import { useParams } from "react-router-dom";
import { useToast } from "../components/Toast";
import { api, chain, dashboardUrl, wallet } from "../services";

const COMPOSER_URL = "https://x.com/intent/post";
const DONE: Record<SlipEvent, string> = { bet: "Bet placed", claim: "Claimed", refund: "Refunded" };

function postToX(pool: Pool): void {
  try {
    const text = buildTweetText({ id: pool.id, question: pool.question, dashboardUrl: pool.dashboardUrl });
    window.open(`${COMPOSER_URL}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  } catch {
    window.open(pool.dashboardUrl, "_blank", "noopener,noreferrer");
  }
}

function PositionPanel({ position }: { position: Position }) {
  return (
    <section aria-label="Your position" className="flex flex-col gap-2">
      <h2 className="font-display text-16 font-semibold">Your position</h2>
      <div className="flex flex-wrap gap-6 text-14">
        <span>YES <b className="font-display">{formatUsdc(position.yesStake)} USDC</b></span>
        <span>NO <b className="font-display">{formatUsdc(position.noStake)} USDC</b></span>
        <span>Claimable <b className="font-display">{formatUsdc(position.claimable)} USDC</b></span>
      </div>
    </section>
  );
}

function Details({ pool }: { pool: Pool }) {
  const date = new Date(pool.resolveTime * 1000).toUTCString().replace(" GMT", " UTC");
  return (
    <section aria-label="Details" className="flex flex-col gap-2">
      <h2 className="font-display text-16 font-semibold">Details</h2>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-13 text-mute">
        <dt>Resolves</dt><dd className="m-0 text-text">{date}</dd>
        <dt>Fee</dt><dd className="m-0 text-text">{pool.feeBps / 100}%</dd>
        <dt>Creator</dt><dd className="m-0 text-text">{shortAddress(pool.creator)}</dd>
        <dt>Contract</dt><dd className="m-0"><AddressChip address={pool.contract} explorer={CHAINS.BASE_SEPOLIA.explorer} /></dd>
        <dt>Question source</dt><dd className="m-0 text-text">CoinGecko</dd>
      </dl>
    </section>
  );
}

/** D2: everything the bet box shows, plus the result, my position and claim or refund. */
export function PoolPage() {
  const params = useParams();
  const id = /^\d+$/.test(params.id ?? "") ? Number(params.id) : null;
  const account = useWallet(wallet);
  const toast = useToast();
  const data = usePoolData({ api, chain, poolId: id ?? -1, address: account.address });

  if (id === null || data.error?.code === "NOT_FOUND") {
    return <main className="mx-auto max-w-[640px] px-4 py-8"><p className="text-14">{COPY.pool_not_found}</p></main>;
  }
  if (!data.pool) {
    return (
      <main className="mx-auto flex max-w-[640px] flex-col gap-4 px-4 py-8" aria-busy={data.loading}>
        {data.error ? (
          <Notice kind="error" action={<Button size="sm" variant="secondary" onClick={data.refresh}>Try again</Button>}>{loadError("this pool")}</Notice>
        ) : (
          <><Skeleton className="h-8 w-48" /><Skeleton className="h-[260px]" /></>
        )}
      </main>
    );
  }
  const { pool, position } = data;
  return (
    <main className="mx-auto flex max-w-[640px] flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-20 font-bold">Pool #{pool.id}</h1>
          <StatusBadge pool={pool} />
        </div>
        <p className="font-display text-28 font-bold">{pool.question}</p>
      </header>
      <PoolSlip
        pool={pool}
        position={position}
        controller={wallet}
        chain={chain}
        faucetUrl={`${dashboardUrl.replace(/\/+$/, "")}/faucet`}
        onChanged={(event) => { data.refresh(); toast(DONE[event]); }}
      />
      {position ? <PositionPanel position={position} /> : null}
      <Details pool={pool} />
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => void navigator.clipboard.writeText(window.location.href).then(() => toast("Link copied"))}>Copy link</Button>
        <Button variant="secondary" size="sm" onClick={() => postToX(pool)}>{COPY.post_to_x}</Button>
      </div>
    </main>
  );
}
