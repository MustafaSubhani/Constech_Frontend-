import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Dialog } from "./Dialog";

type Options = {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  tone?: "default" | "danger";
  reasonLabel?: string;
};
type Result = { ok: boolean; reason: string };

const Ctx = createContext<((o: Options) => Promise<Result>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [reason, setReason] = useState("");
  const resolver = useRef<((r: Result) => void) | null>(null);

  const confirm = useCallback((o: Options) => {
    setOptions(o);
    setReason("");
    return new Promise<Result>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = (ok: boolean) => {
    resolver.current?.({ ok, reason: reason.trim() });
    resolver.current = null;
    setOptions(null);
  };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Dialog
        open={Boolean(options)}
        onClose={() => finish(false)}
        title={options?.title ?? ""}
        description={options?.message}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => finish(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={`btn ${options?.tone === "danger" ? "btn-danger-solid" : "btn-primary"}`}
              onClick={() => finish(true)}
              data-autofocus={options?.reasonLabel ? undefined : true}
            >
              {options?.confirmLabel ?? "Confirm"}
            </button>
          </>
        }
      >
        {options?.reasonLabel ? (
          <label className="field">
            <span className="field-label">{options.reasonLabel}</span>
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Optional, kept in the audit trail"
              data-autofocus
              onKeyDown={(e) => e.key === "Enter" && finish(true)}
            />
          </label>
        ) : null}
      </Dialog>
    </Ctx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("ConfirmProvider missing");
  return ctx;
}
