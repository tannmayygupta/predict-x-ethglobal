import { createRoot } from "react-dom/client";
import { loadFonts } from "./fonts";
import { mountShadow } from "./mount";
import { Overlay } from "./Overlay";
import { wallet } from "./wallet";

const { root } = mountShadow("predictx-overlay");
void loadFonts();
void wallet.restore(); // picks up an already-approved account without prompting
createRoot(root).render(<Overlay />);
