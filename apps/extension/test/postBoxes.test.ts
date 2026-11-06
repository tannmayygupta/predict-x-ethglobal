// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backgroundBehind, observePostBoxes, type PostBoxHandle } from "../src/x/postBoxes";

let root: HTMLElement;

function post(text: string): HTMLElement {
  const article = document.createElement("article");
  article.setAttribute("data-testid", "tweet");
  const block = document.createElement("div");
  block.setAttribute("data-testid", "tweetText");
  block.textContent = text;
  article.append(block);
  root.append(article);
  return block;
}

function setup() {
  const handles: Array<PostBoxHandle & { connected: boolean; unmounted: boolean; poolId: number }> = [];
  const mount = vi.fn((poolId: number) => {
    const handle = { connected: true, unmounted: false, poolId, isConnected() { return handle.connected; }, unmount() { handle.unmounted = true; } };
    handles.push(handle);
    return handle;
  });
  return { mount, handles };
}

const settle = () => vi.advanceTimersByTimeAsync(250);

beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement("main");
  document.body.append(root);
});
afterEach(() => {
  root.remove();
  vi.useRealTimers();
});

describe("observePostBoxes (FR-P-04)", () => {
  it("mounts a box for the PX# marker and for a /pool/ link, and for no other post", () => {
    post("Will $ETH be above $3000? Bet YES or NO: http://localhost:5173/pool/9 PX#9");
    post("see http://localhost:5173/pool/7");
    post("just chatting about $ETH");
    post("PX# with no number");
    const { mount } = setup();
    const obs = observePostBoxes(root, { mount });
    expect(mount.mock.calls.map((c) => c[0])).toEqual([9, 7]);
    obs.stop();
  });

  it("mounts once per post, however often the page changes", async () => {
    post("PX#3");
    const { mount } = setup();
    const obs = observePostBoxes(root, { mount });
    root.append(document.createElement("div"));
    await settle();
    root.append(document.createElement("div"));
    await settle();
    expect(mount).toHaveBeenCalledTimes(1);
    obs.stop();
  });

  it("picks up posts that scroll in later", async () => {
    const { mount } = setup();
    const obs = observePostBoxes(root, { mount });
    expect(mount).not.toHaveBeenCalled();
    post("PX#21");
    await settle();
    expect(mount.mock.calls.map((c) => c[0])).toEqual([21]);
    obs.stop();
  });

  it("recreates a box that x.com's re-render removed from the page", async () => {
    post("PX#5");
    const { mount, handles } = setup();
    const obs = observePostBoxes(root, { mount });
    handles[0]!.connected = false;
    root.append(document.createElement("span")); // any mutation triggers a scan
    await settle();
    expect(mount).toHaveBeenCalledTimes(2);
    expect(handles[0]!.unmounted).toBe(true);
    obs.stop();
  });

  it("unmounts the box when its post leaves the page", async () => {
    const block = post("PX#5");
    const { mount, handles } = setup();
    const obs = observePostBoxes(root, { mount });
    block.closest("article")?.remove();
    await settle();
    expect(handles[0]!.unmounted).toBe(true);
    obs.stop();
  });

  it("swaps the box when a post's text changes to a different pool", async () => {
    const block = post("PX#5");
    const { mount, handles } = setup();
    const obs = observePostBoxes(root, { mount });
    block.textContent = "PX#6";
    await settle();
    expect(handles.map((h) => h.poolId)).toEqual([5, 6]);
    expect(handles[0]!.unmounted).toBe(true);
    obs.stop();
  });

  it("refuses an absurd pool id", () => {
    post("PX#99999999999999");
    const { mount } = setup();
    observePostBoxes(root, { mount }).stop();
    expect(mount).not.toHaveBeenCalled();
  });

  it("treats post text as untrusted: markup in it is never interpreted and only digits are used", () => {
    post("<img src=x onerror=alert(1)> PX#12 <script>alert(2)</script>");
    const { mount } = setup();
    observePostBoxes(root, { mount }).stop();
    expect(mount.mock.calls.map((c) => c[0])).toEqual([12]);
    expect(root.querySelector("img, script")).toBeNull();
  });

  it("stop() unmounts everything and ends observation", async () => {
    post("PX#1");
    const { mount, handles } = setup();
    const obs = observePostBoxes(root, { mount });
    obs.stop();
    expect(handles[0]!.unmounted).toBe(true);
    post("PX#2");
    await settle();
    expect(mount).toHaveBeenCalledTimes(1);
  });
});

describe("backgroundBehind", () => {
  it("finds the first painted ancestor background", () => {
    root.style.backgroundColor = "rgb(0, 0, 0)";
    const block = post("x");
    expect(backgroundBehind(block)).toBe("rgb(0, 0, 0)");
  });
});
