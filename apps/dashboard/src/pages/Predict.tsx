import { CreatePrediction, Notice, Skeleton, useTokens } from "@predictx/ui";
import { PageShell } from "../components/PageShell";
import { api } from "../services";

const STEPS = [
  ["Build", "Pick a token, a direction, a strike price and a close time. The question is written for you."],
  ["Sign", "Confirm one transaction in MetaMask on Base Sepolia. It uses test USDC only."],
  ["Post to X", "A ready draft opens on X with the question and the pool link. Review it and press Post."],
] as const;

/** Create a pool from the website. Same form, same chain call and same X draft as the extension. */
export function Predict() {
  const tokens = useTokens(api);
  return (
    <PageShell title="Predict" lead="Put a number on your take, then post it to X so others can bet against you." width={960}>
      <div className="flex flex-col gap-6 min-[800px]:flex-row min-[800px]:items-start">
        <section aria-label="New prediction" className="w-full rounded-card border border-rule bg-ink p-5 shadow-card min-[800px]:max-w-[420px]">
          {tokens.length > 0 ? (
            <CreatePrediction tokens={tokens} initialSymbol={null} onDone={() => undefined} />
          ) : (
            <div className="flex flex-col gap-3" aria-busy="true">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-10" />
              <Notice kind="info">Connecting to the PredictX server...</Notice>
            </div>
          )}
        </section>
        <ol className="m-0 flex list-none flex-col gap-4 p-0 min-[800px]:flex-1">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink2 font-display text-14 font-bold text-amber">{i + 1}</span>
              <div className="flex flex-col gap-1">
                <span className="font-semibold">{title}</span>
                <span className="text-13 text-mute">{text}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </PageShell>
  );
}
