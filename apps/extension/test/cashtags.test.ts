// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTagPattern, observeCashtags, unwrapTags, wrapTags } from "../src/x/cashtags";
import { TAG_ATTR } from "../src/x/xSelectors";

const UNDERLINE = "rgb(255, 176, 32)";
const pattern = (symbols: string[]) => {
  const p = buildTagPattern(symbols);
  if (!p) throw new Error("no pattern");
  return p;
};

function block(html: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-testid", "tweetText");
  el.innerHTML = html;
  return el;
}

const tags = (el: Element): string[] => [...el.querySelectorAll(`[${TAG_ATTR}]`)].map((s) => s.getAttribute(TAG_ATTR) ?? "");

describe("buildTagPattern", () => {
  it("is null with no usable symbols and ignores anything that is not a plain ticker", () => {
    expect(buildTagPattern([])).toBeNull();
    expect(buildTagPattern(["(a|b)", "$$"])).toBeNull();
  });
});

describe("wrapTags", () => {
  it("highlights only allowlisted tags (FR-X-01): $ETH yes, $FAKE no", () => {
    const el = block("gm $ETH and $FAKE are here");
    expect(wrapTags(el, { pattern: pattern(["ETH"]), underline: UNDERLINE })).toBe(1);
    expect(tags(el)).toEqual(["ETH"]);
    expect(el.textContent).toBe("gm $ETH and $FAKE are here");
  });

  it("is case-insensitive and stores the upper-case symbol", () => {
    const el = block("look at $eth and $Pepe");
    wrapTags(el, { pattern: pattern(["ETH", "PEPE"]), underline: UNDERLINE });
    expect(tags(el)).toEqual(["ETH", "PEPE"]);
  });

  it.each([["$ETHEREUM"], ["US$ETH"], ["$$ETH"], ["$ETH_x"], ["$ETH1"], ["price$ETH"]])("does not match inside %s", (text) => {
    const el = block(`x ${text} y`);
    expect(wrapTags(el, { pattern: pattern(["ETH"]), underline: UNDERLINE })).toBe(0);
  });

  it("matches next to punctuation and line ends", () => {
    const el = block("($ETH), $ETH. $ETH!");
    expect(wrapTags(el, { pattern: pattern(["ETH"]), underline: UNDERLINE })).toBe(3);
  });

  it("wraps tags that X already made links, keeping the link", () => {
    const el = block('hi <a href="/search?q=%24ETH">$ETH</a> there');
    wrapTags(el, { pattern: pattern(["ETH"]), underline: UNDERLINE });
    const link = el.querySelector("a");
    expect(link?.querySelector(`[${TAG_ATTR}]`)?.textContent).toBe("$ETH");
    expect(link?.getAttribute("href")).toBe("/search?q=%24ETH");
  });

  it("never touches what the user is typing", () => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = '<div contenteditable="true">$ETH draft</div><textarea>$ETH</textarea><div role="textbox">$ETH</div>';
    expect(wrapTags(wrapper, { pattern: pattern(["ETH"]), underline: UNDERLINE })).toBe(0);
  });

  it("is idempotent: running twice wraps once", () => {
    const el = block("$ETH");
    wrapTags(el, { pattern: pattern(["ETH"]), underline: UNDERLINE });
    expect(wrapTags(el, { pattern: pattern(["ETH"]), underline: UNDERLINE })).toBe(0);
    expect(tags(el)).toEqual(["ETH"]);
  });

  it("uses the supplied colour and sets no class, id or global style", () => {
    const el = block("$ETH");
    wrapTags(el, { pattern: pattern(["ETH"]), underline: UNDERLINE });
    const span = el.querySelector<HTMLElement>(`[${TAG_ATTR}]`);
    expect(span?.style.borderBottom).toContain(UNDERLINE);
    expect(span?.className).toBe("");
    expect(document.head.querySelectorAll("style").length).toBe(0);
  });
});

describe("unwrapTags", () => {
  it("restores the original text", () => {
    const el = block("gm $ETH and $BTC");
    wrapTags(el, { pattern: pattern(["ETH", "BTC"]), underline: UNDERLINE });
    unwrapTags(el);
    expect(tags(el)).toEqual([]);
    expect(el.textContent).toBe("gm $ETH and $BTC");
  });
});

describe("observeCashtags", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement("main");
    document.body.append(root);
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0) as unknown as number);
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  });
  afterEach(() => {
    root.remove();
    vi.unstubAllGlobals();
  });

  const settle = () => new Promise((r) => setTimeout(r, 20));

  it("handles posts present at start and posts added later (infinite scroll)", async () => {
    root.append(block("first $ETH"));
    const obs = observeCashtags(root, { pattern: pattern(["ETH"]), underline: UNDERLINE });
    expect(tags(root)).toEqual(["ETH"]);
    const article = document.createElement("article");
    article.append(block("later $ETH"));
    root.append(article);
    await settle();
    expect(tags(root)).toEqual(["ETH", "ETH"]);
    obs.stop();
  });

  it("handles text added inside an existing post", async () => {
    const post = block("");
    root.append(post);
    const obs = observeCashtags(root, { pattern: pattern(["BTC"]), underline: UNDERLINE });
    post.append(document.createTextNode("now $BTC"));
    await settle();
    expect(tags(root)).toEqual(["BTC"]);
    obs.stop();
  });

  it("ignores text outside post bodies", async () => {
    const obs = observeCashtags(root, { pattern: pattern(["ETH"]), underline: UNDERLINE });
    const nav = document.createElement("nav");
    nav.textContent = "$ETH in the sidebar";
    root.append(nav);
    await settle();
    expect(tags(root)).toEqual([]);
    obs.stop();
  });

  it("stop() restores the page and ends observation", async () => {
    root.append(block("a $ETH"));
    const obs = observeCashtags(root, { pattern: pattern(["ETH"]), underline: UNDERLINE });
    obs.stop();
    expect(tags(root)).toEqual([]);
    root.append(block("b $ETH"));
    await settle();
    expect(tags(root)).toEqual([]);
  });
});
