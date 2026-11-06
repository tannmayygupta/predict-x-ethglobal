import { createRoot } from "react-dom/client";
import { buildTagPattern, observeCashtags } from "../x/cashtags";
import { attachHoverEvents } from "../x/hoverEvents";
import { createHoverStore } from "../x/hoverStore";
import { loadFonts } from "./fonts";
import { mountShadow } from "./mount";
import { Overlay } from "./Overlay";
import { loadTokens } from "./tokens";
import { wallet } from "./wallet";

const { host, root } = mountShadow("predictx-overlay");
const hover = createHoverStore();

void loadFonts();
void wallet.restore(); // picks up an already-approved account without prompting
attachHoverEvents(hover);
createRoot(root).render(<Overlay hover={hover} />);

// The allowlist comes from the backend (GET /tokens). Until it answers there is nothing to highlight.
void loadTokens().then((tokens) => {
  const pattern = buildTagPattern(tokens.map((t) => t.symbol));
  // The underline colour is read from the design tokens, which are defined on the shadow host.
  const underline = getComputedStyle(host).getPropertyValue("--px-amber").trim();
  if (pattern && underline) observeCashtags(document.body, { pattern, underline });
});
