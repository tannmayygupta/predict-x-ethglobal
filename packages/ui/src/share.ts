/** The X composer. A draft opens in a new tab; the user reviews it and presses Post. */
export const X_COMPOSER_URL = "https://x.com/intent/post";

export function openComposer(text: string): void {
  window.open(`${X_COMPOSER_URL}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
}
