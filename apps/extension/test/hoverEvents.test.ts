// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachHoverEvents } from "../src/x/hoverEvents";
import type { HoverStore } from "../src/x/hoverStore";
import { TAG_ATTR } from "../src/x/xSelectors";

function fakeStore() {
  return { enterTag: vi.fn(), leaveTag: vi.fn() } as unknown as HoverStore & { enterTag: ReturnType<typeof vi.fn>; leaveTag: ReturnType<typeof vi.fn> };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("hover events", () => {
  it("enters on a tag with its symbol and bounding box, and ignores everything else", () => {
    document.body.innerHTML = `<p id="plain">$ETH plain</p><p><span id="tag" ${TAG_ATTR}="ETH">$ETH</span></p>`;
    const store = fakeStore();
    const detach = attachHoverEvents(store);
    document.getElementById("plain")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(store.enterTag).not.toHaveBeenCalled();
    document.getElementById("tag")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(store.enterTag).toHaveBeenCalledWith("ETH", expect.objectContaining({ left: 0, top: 0 }));
    detach();
  });

  it("leaves when the pointer exits the tag, but not when it moves inside it", () => {
    document.body.innerHTML = `<span id="tag" ${TAG_ATTR}="BTC"><b id="inner">$BTC</b></span><div id="elsewhere"></div>`;
    const store = fakeStore();
    const detach = attachHoverEvents(store);
    const inner = document.getElementById("inner");
    const tag = document.getElementById("tag");
    inner?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: tag }));
    expect(store.leaveTag).not.toHaveBeenCalled();
    tag?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.getElementById("elsewhere") }));
    expect(store.leaveTag).toHaveBeenCalledTimes(1);
    detach();
  });

  it("stops listening after detach", () => {
    document.body.innerHTML = `<span id="tag" ${TAG_ATTR}="ETH">$ETH</span>`;
    const store = fakeStore();
    attachHoverEvents(store)();
    document.getElementById("tag")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(store.enterTag).not.toHaveBeenCalled();
  });
});
