import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  size?: "md" | "lg" | "xl";
  children: ReactNode;
  footer?: ReactNode;
  dismissable?: boolean;
};

export function Dialog({ open, onClose, title, description, size = "md", children, footer, dismissable = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const lastFocus = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement as HTMLElement;
    const frame = requestAnimationFrame(() => {
      const root = ref.current;
      const target =
        root?.querySelector<HTMLElement>("[data-autofocus]") ??
        root?.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not(.dialog-x):not([disabled])");
      target?.focus();
    });
    function onKey(e: KeyboardEvent) {
      // Only the top-most dialog answers the keyboard.
      const dialogs = document.querySelectorAll(".dialog");
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (dismissable) closeRef.current();
        return;
      }
      if (e.key === "Tab" && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(
          (el) => !el.hasAttribute("disabled"),
        );
        if (!items.length) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey, true);
      lastFocus.current?.focus?.();
    };
  }, [open, dismissable]);

  if (!open) return null;
  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && dismissable && onClose()}>
      <div
        ref={ref}
        className={`dialog${size === "lg" ? " dialog-lg" : size === "xl" ? " dialog-xl" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dialog-head">
          <div className="grow">
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          {dismissable ? (
            <button type="button" className="btn btn-ghost btn-icon btn-sm dialog-x" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          ) : null}
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
