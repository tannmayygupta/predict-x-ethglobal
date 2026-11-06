import { Outlet, Route, Routes } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { ToastProvider } from "./components/Toast";
import { Faucet } from "./pages/Faucet";
import { Home } from "./pages/Home";
import { Insight } from "./pages/Insight";
import { Landing } from "./pages/Landing";
import { Playground } from "./pages/Playground";
import { PoolPage } from "./pages/PoolPage";
import { Predict } from "./pages/Predict";
import { Swap } from "./pages/Swap";

/** Every app screen sits in the left-sidebar layout; the landing page is outside it. */
function AppLayout() {
  return (
    <div className="min-h-screen min-[800px]:grid min-[800px]:grid-cols-[240px_minmax(0,1fr)]">
      <Sidebar />
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route element={<AppLayout />}>
          <Route path="/pools" element={<Home />} />
          <Route path="/pool/:id" element={<PoolPage />} />
          <Route path="/predict" element={<Predict />} />
          <Route path="/swap" element={<Swap />} />
          <Route path="/ai" element={<Insight />} />
          <Route path="/playground" element={<Playground />} />
          <Route path="/faucet" element={<Faucet />} />
          <Route path="*" element={<main className="mx-auto max-w-[640px] px-4 py-8"><p>Page not found.</p></main>} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
