// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountShadow } from "../src/content/mount";

afterEach(() => {
  document.body.innerHTML = "";
  document.getElementById("t-overlay")?.remove();
});

function fire(target: EventTarget, event: Event): void {
  target.dispatchEvent(event);
}

describe("mountShadow", () => {
  it("puts the design tokens and utilities inside the shadow root, and writes no style into the page (FR-X-04)", () => {
    const before = document.querySelectorAll("style, link[rel=stylesheet]").length;
    const { host } = mountShadow("t-overlay");
    expect(host.shadowRoot?.querySelector("style")?.textContent).toContain("--px-amber");
    expect(document.querySelectorAll("style, link[rel=stylesheet]").length).toBe(before);
  });

  it("applies the dark theme class to the overlay root only, and keeps bet boxes on the default paper theme", () => {
    const overlay = mountShadow("t-overlay", { className: "px-root px-theme-dark" });
    expect(overlay.root.classList.contains("px-theme-dark")).toBe(true);
    expect(overlay.host.shadowRoot?.querySelector("style")?.textContent).toContain(".px-theme-dark");
    const box = mountShadow("t-overlay-box", { inline: true });
    expect(box.root.className).toBe("px-root");
  });

  it("replaces an earlier mount with the same id instead of duplicating it", () => {
    mountShadow("t-overlay");
    mountShadow("t-overlay");
    expect(document.querySelectorAll("#t-overlay").length).toBe(1);
  });

  it("key presses inside our UI never reach x.com's document-level shortcuts", () => {
    const { host, root } = mountShadow("t-overlay");
    const page = vi.fn();
    document.addEventListener("keydown", page);
    const input = document.createElement("input");
    root.append(input);
    fire(input, new KeyboardEvent("keydown", { key: "j", bubbles: true, composed: true }));
    expect(page).not.toHaveBeenCalled();
    document.removeEventListener("keydown", page);
    host.remove();
  });

  it("Escape inside our UI is handed to us, not to the page", () => {
    const onEscape = vi.fn();
    const { host, root } = mountShadow("t-overlay", { onEscape });
    const page = vi.fn();
    document.addEventListener("keydown", page);
    const input = document.createElement("input");
    root.append(input);
    fire(input, new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(page).not.toHaveBeenCalled();
    document.removeEventListener("keydown", page);
    host.remove();
  });

  it("a click inside an inline bet box does not reach the post's own click handler (it would open the post)", () => {
    const article = document.createElement("article");
    const postClick = vi.fn();
    article.addEventListener("click", postClick);
    document.body.append(article);
    const { host, root } = mountShadow("t-overlay", { inline: true });
    article.append(host);
    const button = document.createElement("button");
    root.append(button);
    fire(button, new MouseEvent("click", { bubbles: true, composed: true }));
    expect(postClick).not.toHaveBeenCalled();
    fire(article, new MouseEvent("click", { bubbles: true }));
    expect(postClick).toHaveBeenCalledTimes(1);
  });

  it("an inline box is in flow and is not attached to the page by itself", () => {
    const { host } = mountShadow("t-overlay", { inline: true });
    expect(host.isConnected).toBe(false);
    expect(host.style.display).toBe("block");
  });
});
