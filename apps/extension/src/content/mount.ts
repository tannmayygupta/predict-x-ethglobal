import tokensCss from "@predictx/shared/src/design-tokens.css?inline";
import overlayCss from "./overlay.css?inline";

export interface Mounted {
  host: HTMLElement;
  root: HTMLElement;
}

/**
 * One shadow root per mount point (RULES 5.1). The host element is ours and carries no styling beyond being
 * a zero-size fixed anchor; the design tokens and utilities are adopted inside the shadow root only.
 */
export function mountShadow(id: string, className = "px-root"): Mounted {
  document.getElementById(id)?.remove();
  const host = document.createElement("div");
  host.id = id;
  host.style.cssText = "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483000;";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `${tokensCss}\n${overlayCss}`;
  const root = document.createElement("div");
  root.className = className;
  shadow.append(style, root);
  document.documentElement.append(host);
  return { host, root };
}
