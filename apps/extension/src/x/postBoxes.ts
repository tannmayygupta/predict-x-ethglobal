import { extractPoolId } from "@predictx/shared";
import { X } from "./xSelectors";

export interface PostBoxHandle {
  /** False once x.com's own re-render has dropped our box from the page. */
  isConnected(): boolean;
  unmount(): void;
}

export interface PostBoxOptions {
  mount(poolId: number, textBlock: Element): PostBoxHandle;
}

export interface PostBoxObserver {
  stop(): void;
}

const SCAN_DEBOUNCE_MS = 200;
/** A real pool id is a small counter; refuse absurd numbers a tweet could contain. */
const MAX_POOL_ID = 1_000_000_000;

interface Entry {
  poolId: number;
  handle: PostBoxHandle;
}

/**
 * Keeps exactly one bet box under every post whose text carries `PX#<id>` or a `/pool/<id>` link (FR-P-04). Post
 * text is untrusted: only the digits are read, never the words. x.com re-renders freely, so every scan re-checks
 * that each box is still on the page and re-creates it if not, and removes boxes whose post has scrolled away.
 */
export function observePostBoxes(root: Element, options: PostBoxOptions): PostBoxObserver {
  const mounted = new Map<Element, Entry>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function drop(block: Element): void {
    mounted.get(block)?.handle.unmount();
    mounted.delete(block);
  }

  function scan(): void {
    timer = undefined;
    if (stopped) return;
    for (const block of [...mounted.keys()]) if (!block.isConnected) drop(block);
    for (const block of root.querySelectorAll(X.tweetText)) {
      const id = extractPoolId(block.textContent ?? "");
      const valid = id !== null && id < MAX_POOL_ID;
      const existing = mounted.get(block);
      if (!valid) {
        if (existing) drop(block);
        continue;
      }
      if (existing && existing.poolId === id && existing.handle.isConnected()) continue;
      drop(block);
      mounted.set(block, { poolId: id, handle: options.mount(id, block) });
    }
  }

  const schedule = (): void => {
    if (!timer && !stopped) timer = setTimeout(scan, SCAN_DEBOUNCE_MS);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  scan();

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      observer.disconnect();
      for (const block of [...mounted.keys()]) drop(block);
    },
  };
}

/** The colour actually painted behind a post, so the slip's tear-line notches look cut out of it. */
export function backgroundBehind(element: Element): string {
  for (let el: Element | null = element; el; el = el.parentElement) {
    const color = getComputedStyle(el).backgroundColor;
    if (color && color !== "transparent" && !/^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)$/.test(color)) return color;
  }
  return "";
}
