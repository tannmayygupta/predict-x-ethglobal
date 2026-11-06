import type { HoverStore } from "./hoverStore";
import { TAG_ATTR } from "./xSelectors";

function tagOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(`[${TAG_ATTR}]`) : null;
}

/** Listens at the document, so tags added later need no listeners of their own. Returns a detach function. */
export function attachHoverEvents(store: HoverStore, doc: Document = document): () => void {
  const over = (event: MouseEvent): void => {
    const tag = tagOf(event.target);
    const symbol = tag?.getAttribute(TAG_ATTR);
    if (tag && symbol) store.enterTag(symbol, tag.getBoundingClientRect());
  };
  const out = (event: MouseEvent): void => {
    const tag = tagOf(event.target);
    // Moving between the pieces of one tag is not leaving it.
    if (tag && !(event.relatedTarget instanceof Node && tag.contains(event.relatedTarget))) store.leaveTag();
  };
  doc.addEventListener("mouseover", over);
  doc.addEventListener("mouseout", out);
  return () => {
    doc.removeEventListener("mouseover", over);
    doc.removeEventListener("mouseout", out);
  };
}
