import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

const TOAST_MS = 4_000;
type Show = (message: string) => void;
const ToastContext = createContext<Show>(() => undefined);

export const useToast = (): Show => useContext(ToastContext);

/** Bottom-centre confirmation that disappears after 4 s (UI_REFERENCE section 4). Dashboard only. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const show = useCallback<Show>((text) => setMessage(text), []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [message]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {message ? (
        <div role="status" className="fixed bottom-6 left-1/2 z-overlay -translate-x-1/2 rounded-button border border-rule bg-ink px-4 py-3 text-14 font-semibold text-text shadow-card">
          {message}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}
