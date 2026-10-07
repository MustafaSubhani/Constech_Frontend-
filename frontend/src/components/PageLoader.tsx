import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { ConstechLoader } from "./ConstechLoader";

type LoaderCtx = { show: (status?: string) => void; hide: () => void };

const Ctx = createContext<LoaderCtx | null>(null);

export function PageLoaderProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [out, setOut] = useState(false);
  const [status, setStatus] = useState("");
  const timer = useRef(0);

  const show = useCallback((text?: string) => {
    window.clearTimeout(timer.current);
    setStatus(text ?? "");
    setOut(false);
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setOut(true);
    timer.current = window.setTimeout(() => {
      setVisible(false);
      setOut(false);
    }, 280);
  }, []);

  const value = useMemo(() => ({ show, hide }), [show, hide]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <ConstechLoader active={visible} exiting={out} status={status} />
    </Ctx.Provider>
  );
}

export function usePageLoader() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("PageLoaderProvider missing");
  return ctx;
}
