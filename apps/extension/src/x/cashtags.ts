import { TAG_ATTR, X } from "./xSelectors";

/** `$ETH` but not `$ETHEREUM`, `US$ETH`, `$$ETH` or `$ETH_`. Built from the allowlist, never from page text. */
export function buildTagPattern(symbols: Iterable<string>): RegExp | null {
  const escaped = [...symbols].filter((s) => /^[A-Za-z0-9]{1,12}$/.test(s)).map((s) => s.toUpperCase());
  if (escaped.length === 0) return null;
  return new RegExp(`(?<![A-Za-z0-9_$])\\$(${escaped.join("|")})(?![A-Za-z0-9_])`, "gi");
}

export interface WrapOptions {
  pattern: RegExp;
  /** Underline colour, read from the design tokens at runtime (no colour is hard-coded here). */
  underline: string;
}

function textNodesToWrap(container: Element, pattern: RegExp): Text[] {
  const found: Text[] = [];
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest(`[${TAG_ATTR}], ${X.editable}`)) return NodeFilter.FILTER_REJECT;
      pattern.lastIndex = 0;
      return pattern.test(node.nodeValue ?? "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) found.push(node as Text);
  return found;
}

/**
 * Wraps allowlisted cashtags inside `container` in a hover target, touching nothing else. Text the user is typing
 * (composer, inputs) is skipped, already-wrapped tags are skipped, and the visible text is unchanged.
 * Returns how many tags were wrapped.
 */
export function wrapTags(container: Element, { pattern, underline }: WrapOptions): number {
  const doc = container.ownerDocument;
  let wrapped = 0;
  for (const node of textNodesToWrap(container, pattern)) {
    const text = node.nodeValue ?? "";
    const fragment = doc.createDocumentFragment();
    let last = 0;
    pattern.lastIndex = 0;
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      const start = match.index ?? 0;
      if (start > last) fragment.append(doc.createTextNode(text.slice(last, start)));
      const span = doc.createElement("span");
      span.setAttribute(TAG_ATTR, (match[1] ?? "").toUpperCase());
      span.style.borderBottom = `1.5px solid ${underline}`;
      span.textContent = match[0];
      fragment.append(span);
      last = start + match[0].length;
      wrapped += 1;
    }
    if (last < text.length) fragment.append(doc.createTextNode(text.slice(last)));
    node.replaceWith(fragment);
  }
  return wrapped;
}

/** Puts every wrapped tag back to plain text, leaving the page as it was. */
export function unwrapTags(root: ParentNode): void {
  for (const span of root.querySelectorAll(`[${TAG_ATTR}]`)) span.replaceWith(span.ownerDocument.createTextNode(span.textContent ?? ""));
}

export function textBlocksIn(node: Node): Element[] {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!element) return [];
  const enclosing = element.closest(X.tweetText);
  if (enclosing) return [enclosing];
  return [...element.querySelectorAll(X.tweetText)];
}

export interface CashtagObserver {
  stop(): void;
}

/**
 * Highlights allowlisted cashtags in posts as they appear (initial page, infinite scroll, navigation). Work is
 * batched into one animation frame. If anything here throws, it stops and restores the page rather than risk
 * disturbing x.com: a missing underline is acceptable, a broken timeline is not.
 */
export function observeCashtags(root: Element, options: WrapOptions): CashtagObserver {
  const queue = new Set<Element>();
  let scheduled = 0;
  let stopped = false;

  const flush = (): void => {
    scheduled = 0;
    if (stopped) return;
    const blocks = [...queue];
    queue.clear();
    try {
      for (const block of blocks) if (block.isConnected) wrapTags(block, options);
    } catch {
      stop();
    }
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) for (const added of mutation.addedNodes) for (const block of textBlocksIn(added)) queue.add(block);
    if (queue.size > 0 && scheduled === 0) scheduled = window.requestAnimationFrame(flush);
  });

  function stop(): void {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    if (scheduled) window.cancelAnimationFrame(scheduled);
    unwrapTags(root);
  }

  for (const block of textBlocksIn(root)) queue.add(block);
  observer.observe(root, { childList: true, subtree: true });
  flush();
  return { stop };
}
