import { Button, COPY, Notice, PoolSlip, Skeleton, loadError, useWallet, usePoolData } from "@predictx/ui";
import { api } from "./api";
import { dashboardUrl } from "../config";
import { chain, wallet } from "./wallet";

/** A6: the Odds Slip under a post. Live pool data, real bets; every state comes from the shared slip. */
export function BetBox({ poolId, background }: { poolId: number; background: string }) {
  const account = useWallet(wallet);
  const data = usePoolData({ api, chain, poolId, address: account.address });

  if (data.error?.code === "NOT_FOUND") return <Notice kind="info">{COPY.pool_not_found}</Notice>;
  if (!data.pool) {
    return data.error ? (
      <Notice kind="error" action={<Button size="sm" variant="secondary" onClick={data.refresh}>Try again</Button>}>
        {loadError("this pool")}
      </Notice>
    ) : (
      <div className="flex flex-col gap-2 rounded-card border border-rule bg-ink p-4" aria-busy="true">
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-[10px] w-full" />
      </div>
    );
  }
  return (
    <PoolSlip
      pool={data.pool}
      position={data.position}
      controller={wallet}
      chain={chain}
      faucetUrl={`${dashboardUrl.replace(/\/+$/, "")}/faucet`}
      background={background}
      onChanged={data.refresh}
    />
  );
}
