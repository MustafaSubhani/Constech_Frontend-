import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  placement?: "up" | "down";
  width?: number;
};

export function Menu({ trigger, children, align = "right", placement = "down", width }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        // The open menu owns the arrow keys; page shortcuts (row selection) must not see them.
        e.stopPropagation();
        e.preventDefault();
        const items = [...(ref.current?.querySelectorAll<HTMLElement>("button.menu-item:not(:disabled)") ?? [])];
        if (!items.length) return;
        const idx = items.indexOf(document.activeElement as HTMLElement);
        const next = e.key === "ArrowDown" ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
        items[next]!.focus();
      }
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div className="menu-anchor" ref={ref}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open ? (
        <div
          className={`menu${align === "left" ? " align-left" : ""}${placement === "up" ? " drop-up" : ""}`}
          role="menu"
          style={width ? { minWidth: width } : undefined}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
