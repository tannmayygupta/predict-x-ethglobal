import { buildTweetText } from "@predictx/shared";
import { useMemo, useState } from "react";
import { COPY } from "../copy";
import { openComposer } from "../share";
import type { PostablePool } from "../created";
import { Button, Notice } from "./primitives";

const COPIED_MS = 1500;

/** A5: the pool exists onchain. The text is exactly buildTweetText; the user presses Post in the X composer. */
export function PostStep({ pool, onDone }: { pool: PostablePool; onDone(): void }) {
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => {
    try {
      return buildTweetText({ id: pool.id, question: pool.question, dashboardUrl: pool.dashboardUrl });
    } catch {
      return null;
    }
  }, [pool]);

  const post = (): void => {
    if (text) openComposer(text);
  };
  const copyLink = (): void => {
    navigator.clipboard.writeText(pool.dashboardUrl).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPIED_MS);
      },
      () => setCopied(false),
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="m-0 font-display text-20 font-bold text-yes">{COPY.created}</h3>
      <p className="m-0 text-14 text-mute">Pool #{pool.id} is live on Base Sepolia.</p>
      {text ? <p className="m-0 text-12 text-mute">Opens a draft on X. You can edit it there before you press Post.</p> : null}
      {text ? (
        <pre className="m-0 select-text whitespace-pre-wrap rounded-input border border-rule bg-ink2 p-3 font-body text-13 text-text">{text}</pre>
      ) : (
        <Notice kind="warn">The post text is too long to send. Copy the link instead.</Notice>
      )}
      <Button disabled={!text} onClick={post}>{COPY.post_to_x}</Button>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={copyLink}>{copied ? "Copied" : "Copy link"}</Button>
        <a
          href={pool.dashboardUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex h-8 items-center rounded-button border border-rule bg-ink2 px-3 text-14 font-semibold text-text no-underline"
        >
          Open pool page
        </a>
        <Button variant="ghost" size="sm" onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}
