/** Relative luminance (0..1) of a CSS `rgb()`/`rgba()` colour, or null when it cannot be read. */
export function luminanceOf(color: string): number | null {
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(color.trim());
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((part) => {
    const c = Number(part) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  if (r === undefined || g === undefined || b === undefined) return null;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Below this the page reads as dark (X "Dim" and "Lights out"); mid-greys still take the light-page colour. */
const DARK_PAGE_LUMINANCE = 0.18;

/** Cobalt on a light page, lime on a dark one; an unreadable background counts as light. */
export function pickUnderline(background: string, onLight: string, onDark: string): string {
  const lum = luminanceOf(background);
  return lum !== null && lum < DARK_PAGE_LUMINANCE ? onDark : onLight;
}
