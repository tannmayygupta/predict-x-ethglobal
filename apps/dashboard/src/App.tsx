import { Route, Routes } from "react-router-dom";
import { ToastProvider } from "./components/Toast";
import { TopBar } from "./components/TopBar";
import { Faucet } from "./pages/Faucet";
import { Home } from "./pages/Home";
import { PoolPage } from "./pages/PoolPage";

export function App() {
  return (
    <ToastProvider>
      <TopBar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/pool/:id" element={<PoolPage />} />
        <Route path="/faucet" element={<Faucet />} />
        <Route path="*" element={<main className="mx-auto max-w-[640px] px-4 py-8"><p>Page not found.</p></main>} />
      </Routes>
    </ToastProvider>
  );
}
