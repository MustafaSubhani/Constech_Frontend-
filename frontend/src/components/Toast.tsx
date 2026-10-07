import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type ToastCtx = { show: (message: string) => void };

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(false);
  const show = useCallback((text: string) => {
    setMessage(text);
    setVisible(true);
    window.setTimeout(() => setVisible(false), 3200);
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className={`toast${visible ? " show" : ""}`} role="status">
        {message}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("ToastProvider missing");
  return ctx;
}
