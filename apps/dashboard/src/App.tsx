import { Route, Routes } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { ToastProvider } from "./components/Toast";
import { Faucet } from "./pages/Faucet";
import { Home } from "./pages/Home";
import { PoolPage } from "./pages/PoolPage";

export function App() {
  return (
    <ToastProvider>
      <div className="min-h-screen min-[800px]:grid min-[800px]:grid-cols-[240px_minmax(0,1fr)]">
        <Sidebar />
        <div className="min-w-0">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/pool/:id" element={<PoolPage />} />
            <Route path="/faucet" element={<Faucet />} />
            <Route path="*" element={<main className="mx-auto max-w-[640px] px-4 py-8"><p>Page not found.</p></main>} />
          </Routes>
        </div>
      </div>
    </ToastProvider>
  );
}
