import { Link } from "react-router-dom";
import { BTN_GHOST, BTN_PRIMARY } from "./styles";

/** Static example only: never fetched, so it cannot be mistaken for a live pool. */
function SampleSlip() {
  return (
    <div className="w-full max-w-[440px]">
      <p className="mb-2 text-center text-12 text-mute">Example pool, not live data</p>
      <div className="px-slip shadow-card">
        <div className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between text-13 text-mute">
            <span>Pool #4</span>
            <span className="rounded-full border border-yes px-3 py-0.5 font-semibold text-yes">Open</span>
          </div>
          <p className="m-0 font-display text-20 font-bold">Will $ETH be above $2,300 at 17:50 UTC on 6 Nov?</p>
          <div className="flex justify-between text-13 text-mute"><span>Closes in 02:41</span><span>Pool 100.00 USDC</span></div>
        </div>
        <div className="px-slip__tear" />
        <div className="flex flex-col gap-3 p-5">
          <div className="flex justify-between text-13 font-semibold"><span className="text-yes">YES 60%</span><span className="text-no">NO 40%</span></div>
          <div className="flex h-2 overflow-hidden rounded-full bg-ink2" aria-hidden="true">
            <div className="w-[60%] bg-yes" /><div className="w-[40%] bg-no" />
          </div>
          <div className="flex gap-3" aria-hidden="true">
            <span className="flex h-10 flex-1 items-center justify-center rounded-button border border-yes text-14 font-semibold text-yes">Bet YES</span>
            <span className="flex h-10 flex-1 items-center justify-center rounded-button border border-no text-14 font-semibold text-no">Bet NO</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-12 px-4 pb-16 pt-8 min-[800px]:grid-cols-2 min-[800px]:px-8 min-[800px]:pb-20 min-[800px]:pt-12">
      <div className="flex min-w-0 flex-col gap-6">
        <span className="inline-flex items-center gap-2 self-start rounded-full border border-rule px-3 py-1.5 text-13 text-mute">
          <span className="h-2 w-2 rounded-full bg-yes" aria-hidden="true" />
          Base Sepolia, test funds only
        </span>
        <h1 className="m-0 font-display font-bold" style={{ fontSize: 60, lineHeight: "64px", letterSpacing: "-0.02em" }}>
          Turn any crypto take on X into a bet.
        </h1>
        <p className="m-0 max-w-[520px] text-16 text-mute">
          Write a prediction like "$ETH above $3,000 by tonight", post it, and let your followers back YES or NO right under the tweet.
          When the clock runs out, the price decides. No referee, no admin.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link to="/pools" className={BTN_PRIMARY}>Open dashboard</Link>
          <a href="#how" className={BTN_GHOST}>See how it works</a>
        </div>
        <p className="m-0 text-13 text-mute">Test USDC has no value. Nothing here touches mainnet funds.</p>
      </div>
      <div className="flex min-w-0 justify-center"><SampleSlip /></div>
    </section>
  );
}
