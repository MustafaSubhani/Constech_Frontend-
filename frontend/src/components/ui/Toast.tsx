import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

type Tone = "success" | "error" | "info";
type ToastItem = { id: number; message: string; tone: Tone; action?: { label: string; run: () => void } };
type ToastApi = {
  show: (message: string, tone?: Tone, action?: ToastItem["action"]) => void;
  success: (message: string) => void;
  error: (message: string) => void;
};

const Ctx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (message: string, tone: Tone = "info", action?: ToastItem["action"]) => {
      const id = ++seq.current;
      setItems((list) => [...list.slice(-2), { id, message, tone, action }]);
      window.setTimeout(() => dismiss(id), tone === "error" ? 6000 : 3600);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({ show, success: (m) => show(m, "success"), error: (m) => show(m, "error") }),
    [show],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <span className="toast-icon">
              {t.tone === "success" ? <CheckCircle2 size={16} /> : t.tone === "error" ? <AlertCircle size={16} /> : <Info size={16} />}
            </span>
            <span className="toast-msg">{t.message}</span>
            {t.action ? (
              <button
                type="button"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            ) : null}
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("ToastProvider missing");
  return ctx;
}
