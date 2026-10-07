import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, FolderKanban, Keyboard, Layers, Monitor, Plus, ScanLine, Search, Settings } from "lucide-react";
import { api } from "../../api/client";
import type { Project } from "../../types";
import { updateSettings, getSettings } from "../../lib/settings";
import { PROJECT_TABS } from "./projectTabs";

type Item = {
  id: string;
  group: string;
  label: string;
  sub?: string;
  meta?: string;
  icon: ComponentType<{ size?: number }>;
  run: () => void;
};

type Props = { open: boolean; onClose: () => void; onShortcuts: () => void };

export function CommandPalette({ open, onClose, onShortcuts }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const match = location.pathname.match(/^\/p\/([^/]+)/);
  const projectId = match ? decodeURIComponent(match[1]!) : null;

  const projects = useQuery({ queryKey: ["projects"], queryFn: api.listProjects, enabled: open });
  const project = projectId ? qc.getQueryData<Project>(["project", projectId]) : undefined;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => {
      navigate(to);
      onClose();
    };
    const list: Item[] = [];
    if (projectId) {
      const base = `/p/${encodeURIComponent(projectId)}`;
      PROJECT_TABS.forEach((tab, i) =>
        list.push({ id: `tab-${tab.path}`, group: "This project", label: tab.label, icon: tab.icon, meta: `Alt ${i + 1}`, run: go(tab.path ? `${base}/${tab.path}` : base) }),
      );
      for (const sheet of project?.sheets ?? []) {
        if (!sheet.measurable) continue;
        list.push({
          id: `sheet-${sheet.id}`,
          group: "Sheets",
          label: sheet.code,
          sub: sheet.title,
          meta: `${sheet.shapes.length} outlines`,
          icon: Layers,
          run: go(`${base}?sheet=${encodeURIComponent(sheet.id)}`),
        });
      }
      for (const row of project?.comparison ?? []) {
        if (row.hidden) continue;
        list.push({
          id: `line-${row.id}`,
          group: "Bill lines",
          label: row.label,
          sub: row.section,
          meta: row.unit,
          icon: FileSpreadsheet,
          run: go(`${base}/bill?line=${encodeURIComponent(row.id)}`),
        });
      }
    }
    for (const p of projects.data ?? []) {
      if (p.id === projectId) continue;
      list.push({ id: `project-${p.id}`, group: "Projects", label: p.name, sub: p.place, icon: FolderKanban, run: go(`/p/${encodeURIComponent(p.id)}`) });
    }
    list.push(
      { id: "act-projects", group: "Go to", label: "All projects", icon: FolderKanban, run: go("/projects") },
      { id: "act-new", group: "Go to", label: "New project", icon: Plus, run: go("/projects?new=1") },
      { id: "act-quick", group: "Go to", label: "Quick takeoff", icon: ScanLine, run: go("/quick") },
      { id: "act-settings", group: "Go to", label: "Settings", icon: Settings, run: go("/settings") },
      {
        id: "act-theme",
        group: "Actions",
        label: "Switch theme",
        sub: "System, dark, light",
        icon: Monitor,
        run: () => {
          const t = getSettings().theme;
          updateSettings({ theme: t === "system" ? "dark" : t === "dark" ? "light" : "system" });
          onClose();
        },
      },
      {
        id: "act-keys",
        group: "Actions",
        label: "Keyboard shortcuts",
        icon: Keyboard,
        meta: "?",
        run: () => {
          onClose();
          onShortcuts();
        },
      },
    );
    return list;
  }, [projectId, project, projects.data, navigate, onClose, onShortcuts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.filter((i) => i.group !== "Bill lines" && i.group !== "Sheets").concat(items.filter((i) => i.group === "Sheets").slice(0, 6));
    const terms = q.split(/\s+/);
    return items.filter((i) => terms.every((t) => `${i.label} ${i.sub ?? ""} ${i.group}`.toLowerCase().includes(t))).slice(0, 60);
  }, [items, query]);

  useEffect(() => setIndex(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector(".palette-item.focused")?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!open) return null;

  let lastGroup = "";
  return createPortal(
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
        <div className="palette-input">
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sheets, bill lines, projects and actions"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                filtered[index]?.run();
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="empty-state" style={{ padding: 28 }}>
              <p>Nothing matches "{query}".</p>
            </div>
          ) : (
            filtered.map((item, i) => {
              const header = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              const Icon = item.icon;
              return (
                <div key={item.id}>
                  {header ? <div className="palette-group">{header}</div> : null}
                  <button
                    type="button"
                    className={`palette-item${i === index ? " focused" : ""}`}
                    onMouseMove={() => setIndex(i)}
                    onClick={item.run}
                  >
                    <Icon size={15} />
                    <span className="truncate">
                      {item.label}
                      {item.sub ? <span className="sub">{item.sub}</span> : null}
                    </span>
                    {item.meta ? <span className="meta">{item.meta}</span> : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
