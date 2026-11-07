import { CHAINS, type Token } from "@predictx/shared";
import { COPY } from "../../copy";
import { ChainBadge, Chevron, PredictXMark, ShieldCheck, TokenIcon } from "./icons";
import { KebabMenu, type KebabMenuProps } from "./KebabMenu";

export interface CardHeaderProps {
  token: Token;
  verified: boolean;
  onPredict(): void;
  menu: KebabMenuProps;
}

/** 48px row: token icon with chain badge, symbol + Verified pill, name + "Predict this price", mark and menu. */
export function CardHeader({ token, verified, onPredict, menu }: CardHeaderProps) {
  // Only a token that lives on Base gets the Base badge; BTC is on bitcoin and must not.
  const onBase = token.network === "base" && (token.flashChainId === null || token.flashChainId === CHAINS.BASE_MAINNET.id);
  return (
    <div className="flex h-12 items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <div className="relative h-12 w-12 shrink-0">
          <TokenIcon symbol={token.symbol} />
          {onBase ? (
            <span className="absolute -bottom-0.5 -right-0.5 flex">
              <ChainBadge chain="base" />
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-16 font-semibold text-text">{token.symbol}</span>
            {verified ? (
              <span title={COPY.verified_hint} className="inline-flex h-[18px] items-center gap-1 rounded-[4px] border border-up-soft bg-ink2 px-1.5 text-12 font-medium text-up">
                <ShieldCheck />
                {COPY.verified}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-14">
            <span className="max-w-[24ch] truncate text-mute">{token.name}<span aria-hidden>{" ·"}</span></span>
            <button
              type="button"
              onClick={onPredict}
              className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap border-0 bg-transparent p-0 text-14 text-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber"
            >
              {COPY.predict_this_price}
              <Chevron />
            </button>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <PredictXMark />
        <KebabMenu {...menu} />
      </div>
    </div>
  );
}
