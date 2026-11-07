import { AppProvider } from "@predictx/ui";
import { createRoot } from "react-dom/client";
import { buildTagPattern, observeCashtags } from "../x/cashtags";
import { attachHoverEvents } from "../x/hoverEvents";
import { createHoverStore } from "../x/hoverStore";
import { backgroundBehind, observePostBoxes } from "../x/postBoxes";
import { pickUnderline } from "../x/underline";
import { dashboardUrl } from "../config";
import { api } from "./api";
import { BetBox } from "./BetBox";
import { ESCAPE_EVENT } from "./events";
import { loadFonts } from "./fonts";
import { mountShadow } from "./mount";
import { Overlay } from "./Overlay";
import { loadTokens } from "./tokens";
import { chain, wallet } from "./wallet";

const { host, root } = mountShadow("predictx-overlay", { className: "px-root px-theme-dark", onEscape: () => window.dispatchEvent(new Event(ESCAPE_EVENT)) });
const hover = createHoverStore();

void loadFonts();
void wallet.restore(); // picks up an already-approved account without prompting
attachHoverEvents(hover);
createRoot(root).render(
  <AppProvider services={{ api, wallet, chain, dashboardUrl }}>
    <Overlay hover={hover} />
  </AppProvider>,
);

// Bet boxes under posts that carry PX#<id> or a /pool/<id> link. Each box gets its own shadow root.
let boxCount = 0;
observePostBoxes(document.body, {
  mount(poolId, textBlock) {
    const boxHost = mountShadow(`predictx-box-${(boxCount += 1)}`, { inline: true });
    textBlock.insertAdjacentElement("afterend", boxHost.host);
    const reactRoot = createRoot(boxHost.root);
    reactRoot.render(<BetBox poolId={poolId} background={backgroundBehind(textBlock)} />);
    return {
      isConnected: () => boxHost.host.isConnected,
      unmount() {
        reactRoot.unmount();
        boxHost.host.remove();
      },
    };
  },
});

// The allowlist comes from the backend (GET /tokens). Until it answers there is nothing to highlight.
void loadTokens().then((tokens) => {
  const pattern = buildTagPattern(tokens.map((t) => t.symbol));
  // Both underline colours come from the design tokens: the host carries the paper theme (cobalt), the overlay
  // root the dark one (lime). The page luminance behind the text decides which one stays readable.
  const cobalt = getComputedStyle(host).getPropertyValue("--px-amber").trim();
  const lime = getComputedStyle(root).getPropertyValue("--px-amber").trim();
  const underline = pickUnderline(backgroundBehind(document.body), cobalt, lime);
  if (pattern && cobalt && lime) observeCashtags(document.body, { pattern, underline });
});
