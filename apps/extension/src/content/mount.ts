import tokensCss from "@predictx/shared/src/design-tokens.css?inline";
import overlayCss from "./overlay.css?inline";

export interface Mounted {
  host: HTMLElement;
  root: HTMLElement;
}

export interface MountOptions {
  className?: string;
  /** In-flow block (a bet box under a post) instead of the fixed zero-size anchor used by the overlay. */
  inline?: boolean;
  onEscape?: () => void;
}

const KEY_EVENTS = ["keydown", "keyup", "keypress"] as const;
const POINTER_EVENTS = ["click", "dblclick", "mousedown", "pointerdown", "touchstart"] as const;

/**
 * x.com listens on the whole document for keys ("j", "k", "n", "/" are shortcuts) and treats a click anywhere in a
 * post as "open this post". Typing an amount or pressing Bet inside our UI must do neither, so events that start
 * in our shadow root stop at our host. Escape is handed to us first.
 */
function isolate(host: HTMLElement, { inline, onEscape }: MountOptions): void {
  for (const type of KEY_EVENTS) {
    host.addEventListener(type, (event) => {
      event.stopPropagation();
      if (type === "keydown" && (event as KeyboardEvent).key === "Escape") onEscape?.();
    });
  }
  if (!inline) return;
  for (const type of POINTER_EVENTS) host.addEventListener(type, (event) => event.stopPropagation());
}

/**
 * One shadow root per mount point (RULES 5.1). The host element is ours and carries no styling beyond its box; the
 * design tokens and utilities are adopted inside the shadow root only.
 */
export function mountShadow(id: string, options: MountOptions = {}): Mounted {
  document.getElementById(id)?.remove();
  const host = document.createElement("div");
  host.id = id;
  host.style.cssText = options.inline
    ? "all:initial;display:block;max-width:520px;margin:12px 0;"
    : "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483000;";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `${tokensCss}\n${overlayCss}`;
  const root = document.createElement("div");
  root.className = options.className ?? "px-root";
  shadow.append(style, root);
  isolate(host, options);
  if (!options.inline) document.documentElement.append(host);
  return { host, root };
}
