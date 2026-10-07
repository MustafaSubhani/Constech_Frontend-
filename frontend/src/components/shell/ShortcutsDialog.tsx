import { Dialog } from "../ui/Dialog";

const GROUPS: { title: string; items: { label: string; keys: string[] }[] }[] = [
  {
    title: "Everywhere",
    items: [
      { label: "Search and jump", keys: ["Ctrl", "K"] },
      { label: "This list", keys: ["?"] },
      { label: "Collapse the side bar", keys: ["["] },
      { label: "Close a panel or dialog", keys: ["Esc"] },
    ],
  },
  {
    title: "Inside a project",
    items: [
      { label: "Drawings", keys: ["Alt", "1"] },
      { label: "Bill comparison", keys: ["Alt", "2"] },
      { label: "Rates and estimate", keys: ["Alt", "3"] },
      { label: "Schedules and inputs", keys: ["Alt", "4"] },
      { label: "Pipeline", keys: ["Alt", "5"] },
    ],
  },
  {
    title: "Drawings",
    items: [
      { label: "Select tool", keys: ["V"] },
      { label: "Draw a box", keys: ["B"] },
      { label: "Edit the selected outline", keys: ["E"] },
      { label: "Fit sheet", keys: ["F"] },
      { label: "Zoom in / out", keys: ["+", "-"] },
      { label: "Pan", keys: ["Drag"] },
    ],
  },
  {
    title: "Bill comparison",
    items: [
      { label: "Next / previous line", keys: ["↓", "↑"] },
      { label: "Close the line panel", keys: ["Esc"] },
    ],
  },
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" size="lg">
      <div className="shortcut-grid">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            {g.items.map((item) => (
              <div className="shortcut-row" key={item.label}>
                <span>{item.label}</span>
                <span className="keys">
                  {item.keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  );
}
