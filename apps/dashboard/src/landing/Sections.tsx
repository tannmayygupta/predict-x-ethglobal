import { Link } from "react-router-dom";
import { BTN_PRIMARY, CARD, EYEBROW, SECTION } from "./styles";

const STEPS = [
  { n: "01", title: "Create", body: "Pick a token, above or below, a strike price and a close time. The question is built for you, word for word." },
  { n: "02", title: "Post to X", body: "One click opens a ready draft on X with the question and the pool link. You review it and press post." },
  { n: "03", title: "Bet under the tweet", body: "Anyone with the extension sees a live bet box under the post and stakes test USDC on YES or NO." },
  { n: "04", title: "Settle and claim", body: "At close, a Chainlink CRE workflow fetches the price and reports the outcome on-chain. Winners claim their share." },
];

const FEATURES = [
  { title: "Hover cards on $TOKEN", body: "Hover any cashtag on X for the live price, an AI tip and a Flash swap quote." },
  { title: "Bet box under posts", body: "Posts that carry a pool show odds, a countdown and the stake form in place." },
  { title: "Exact approvals", body: "Every bet approves exactly its own amount. Never an unlimited allowance." },
  { title: "No admin outcome", body: "Nobody can set a result or move funds. Only the Chainlink forwarder can settle." },
];

const SETTLE_STEPS = [
  { label: "1. Cron trigger", body: "Finds pools past their close time" },
  { label: "2. CoinGecko price", body: "One source. If it fails, the pool waits." },
  { label: "3. Report on-chain", body: "The forwarder delivers the outcome" },
];

export function HowItWorks() {
  return (
    <section id="how" className={SECTION}>
      <div className={EYEBROW}>How it works</div>
      <h2 className="mb-10 mt-3 max-w-[640px] font-display text-40 font-bold">From hot take to settled payout in four steps.</h2>
      <ol className="m-0 grid list-none grid-cols-1 gap-4 p-0 min-[800px]:grid-cols-2 min-[1100px]:grid-cols-4">
        {STEPS.map((s) => (
          <li key={s.n} className={`${CARD} flex flex-col gap-3 p-6`}>
            <span className="font-display text-28 font-bold text-amber">{s.n}</span>
            <span className="text-16 font-semibold">{s.title}</span>
            <span className="text-14 text-mute">{s.body}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Numbers match docs/RULES.md: pool $100, 2% fee = $2, $98 to winners, $30 of the $60 winning side = half = $49. */
function PayoutExample() {
  return (
    <div className={`${CARD} flex flex-col gap-4 p-7`}>
      <div className={EYEBROW}>A payout, worked out</div>
      <div className="flex h-2 overflow-hidden rounded-full bg-ink2" aria-hidden="true">
        <div className="w-[60%] bg-yes" /><div className="w-[40%] bg-no" />
      </div>
      <div className="flex justify-between text-14 font-semibold"><span className="text-yes">YES $60</span><span className="text-no">NO $40</span></div>
      <p className="m-0 text-14 text-mute">
        The pool is $100. YES wins and the 2% fee ($2) comes off the total, leaving $98 for the winners.
        A $30 YES stake is half of the $60 winning side, so it pays out $49.
      </p>
    </div>
  );
}

export function Features() {
  return (
    <section id="features" className={`${SECTION} grid grid-cols-1 gap-6 min-[1000px]:grid-cols-[3fr_2fr]`}>
      <div className="grid min-w-0 grid-cols-1 gap-4 min-[600px]:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.title} className={`${CARD} p-6`}>
            <h3 className="m-0 mb-2 text-16 font-semibold">{f.title}</h3>
            <p className="m-0 text-14 text-mute">{f.body}</p>
          </div>
        ))}
      </div>
      <PayoutExample />
    </section>
  );
}

export function Settlement() {
  return (
    <section id="settle" className={SECTION}>
      <div className={`${CARD} flex flex-col gap-7 p-6 min-[800px]:p-10`}>
        <div>
          <div className={EYEBROW}>Settlement</div>
          <h2 className="mb-2 mt-3 font-display text-28 font-bold">Settled by a Chainlink CRE workflow.</h2>
          <p className="m-0 max-w-[680px] text-16 text-mute">
            The workflow is built and simulated: in this build it runs through the CRE simulator with the official CLI,
            not on Chainlink's network, so results are labelled as a simulation.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 min-[800px]:grid-cols-3">
          {SETTLE_STEPS.map((s) => (
            <div key={s.label} className="rounded-button bg-ink2 p-5">
              <div className="text-13 text-mute">{s.label}</div>
              <div className="mt-1.5 font-semibold">{s.body}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="mx-auto max-w-[1200px] px-4 pb-16 min-[800px]:px-8">
      <div className="flex flex-col items-center gap-5 rounded-card border border-rule px-4 py-12 text-center min-[800px]:px-8">
        <h2 className="m-0 font-display text-28 font-bold">Make your first prediction.</h2>
        <p className="m-0 max-w-[480px] text-16 text-mute">Get free test USDC, connect MetaMask on Base Sepolia and put a number on your take.</p>
        <Link to="/pools" className={BTN_PRIMARY}>Open dashboard</Link>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="mx-auto flex max-w-[1200px] flex-wrap justify-between gap-3 border-t border-rule px-4 pb-10 pt-6 text-13 text-mute min-[800px]:px-8">
      <span>PredictX, hackathon proof of concept</span>
      <span>Testnet only. Test USDC has no value.</span>
    </footer>
  );
}
