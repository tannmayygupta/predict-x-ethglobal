import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { wallet } from "./services";
import "./styles.css";

void wallet.restore(); // picks up an already-approved account without prompting

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root");
createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
