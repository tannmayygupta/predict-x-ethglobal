import displayUrl from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2?url";
import bodyUrl from "@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2?url";

/**
 * @font-face inside a shadow root does not work, and a <style> in x.com's head would break "no global styles".
 * The FontFace API registers the bundled fonts with the document without writing any CSS into the page. Family
 * names match design-tokens.css. If a font cannot load, the token stack falls back to system-ui.
 */
const FACES: Array<{ family: string; url: string }> = [
  { family: "Bricolage Grotesque Variable", url: displayUrl },
  { family: "Instrument Sans Variable", url: bodyUrl },
];

export async function loadFonts(): Promise<void> {
  await Promise.all(
    FACES.map(async ({ family, url }) => {
      if ([...document.fonts].some((f) => f.family === family)) return;
      try {
        const face = new FontFace(family, `url(${chrome.runtime.getURL(url)}) format("woff2")`, { weight: "200 800", style: "normal" });
        document.fonts.add(await face.load());
      } catch {
        /* fonts are cosmetic; the system stack in design-tokens.css takes over */
      }
    }),
  );
}
