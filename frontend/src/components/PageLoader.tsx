import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { ConstechLoader } from "./ConstechLoader";

type LoaderCtx = { show: () => void; hide: () => void };

const Ctx = createContext<LoaderCtx | null>(null);

export function PageLoaderProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [out, setOut] = useState(false);
  const started = useRef(0);
  const timer = useRef(0);

  const show = useCallback(() => {
    window.clearTimeout(timer.current);
    setOut(false);
    setVisible(true);
    started.current = performance.now();
  }, []);

  const hide = useCallback(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const min = reduced ? 120 : 550;
    const wait = Math.max(0, min - (performance.now() - started.current));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setOut(true);
      window.setTimeout(
        () => {
          setVisible(false);
          setOut(false);
        },
        reduced ? 0 : 280,
      );
    }, wait);
  }, []);

  const value = useMemo(() => ({ show, hide }), [show, hide]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <ConstechLoader active={visible} exiting={out} />
    </Ctx.Provider>
  );
}

export function usePageLoader() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("PageLoaderProvider missing");
  return ctx;
}
