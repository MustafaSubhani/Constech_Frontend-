import { useEffect } from "react";
import { CloseIcon } from "./Icons";

type Props = {
  open: boolean;
  onClose: () => void;
};

const SHORTCUTS = [
  { group: "Global Navigation", items: [
    { label: "Open Command Palette / Search", keys: ["Ctrl", "K"] },
    { label: "Show Keyboard Shortcuts Guide", keys: ["?"] },
    { label: "Close dialog / Deselect item", keys: ["Esc"] },
    { label: "Navigate to All Projects", keys: ["P"] },
  ]},
  { group: "Bill Comparison Tab", items: [
    { label: "Select Next Bill Line", keys: ["↓"] },
    { label: "Select Previous Bill Line", keys: ["↑"] },
    { label: "Close Traceability Panel", keys: ["Esc"] },
    { label: "Inspect Line Details", keys: ["Enter"] },
  ]},
  { group: "Drawings Tab", items: [
    { label: "Fit Sheet to Viewport", keys: ["F"] },
    { label: "Zoom In / Out", keys: ["Scroll / Wheel"] },
    { label: "Pan Canvas", keys: ["Drag Canvas"] },
    { label: "Deselect Shape Outline", keys: ["Esc"] },
  ]},
  { group: "Workspace Tabs", items: [
    { label: "Switch to Drawings Tab", keys: ["Alt", "1"] },
    { label: "Switch to Bill Tab", keys: ["Alt", "2"] },
    { label: "Switch to Rates Tab", keys: ["Alt", "3"] },
  ]},
];

export function ShortcutsModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="command-modal" style={{ maxWidth: 580 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>Keyboard Shortcuts</span>
            <span className="user-badge" style={{ background: "var(--purple-soft)", color: "var(--purple-deep)" }}>QS Speed Keys</span>
          </div>
          <button type="button" className="btn btn-ghost btn-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>

        <div style={{ padding: "16px 20px", maxHeight: "65vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
          {SHORTCUTS.map((section) => (
            <div key={section.group}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--muted)", marginBottom: 8 }}>
                {section.group}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {section.items.map((item) => (
                  <div key={item.label} className="shortcut-row">
                    <span style={{ color: "var(--ink)", fontWeight: 500 }}>{item.label}</span>
                    <div className="shortcut-kbd-group">
                      {item.keys.map((k, i) => (
                        <kbd key={i} className="shortcut-kbd">{k}</kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="command-footer">
          <span>Press <kbd style={{ background: "var(--surface)", border: "1px solid var(--line)", padding: "1px 5px", borderRadius: 3 }}>Esc</kbd> to exit anytime</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
