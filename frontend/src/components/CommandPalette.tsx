import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import {
  BlueprintIcon,
  FileTextIcon,
  CoinsIcon,
  ZapIcon,
  DownloadIcon,
  CheckIcon,
} from "./Icons";

type Props = {
  open: boolean;
  onClose: () => void;
  onOpenShortcuts?: () => void;
  onToggleTheme?: () => void;
};

type CommandItemData = {
  id: string;
  category: "Navigation" | "Sheets" | "Bill Lines" | "Projects" | "Actions";
  label: string;
  sublabel?: string;
  badge?: string;
  icon: React.ReactNode;
  action: () => void;
};

export function CommandPalette({ open, onClose, onOpenShortcuts, onToggleTheme }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Extract current projectId if inside a project
  const projectMatch = location.pathname.match(/^\/p\/([^/]+)/);
  const currentProjectId = projectMatch ? decodeURIComponent(projectMatch[1]) : null;

  // Load projects list
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.getProjects(),
    enabled: open,
  });

  // Load current project detail if in project
  const currentProjectQuery = useQuery({
    queryKey: ["project", currentProjectId, "catalog"],
    queryFn: () => (currentProjectId ? api.getProject(currentProjectId, true) : null),
    enabled: open && Boolean(currentProjectId),
  });

  const project = currentProjectQuery.data;

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Build items list
  const items = useMemo(() => {
    const list: CommandItemData[] = [];

    // Current Project Navigation Tabs
    if (currentProjectId) {
      list.push(
        {
          id: "nav-drawings",
          category: "Navigation",
          label: "Drawings & Takeoff Outlines",
          sublabel: "View CAD sheets and measured shapes",
          badge: "Tab 1",
          icon: <BlueprintIcon size={14} />,
          action: () => {
            navigate(`/p/${encodeURIComponent(currentProjectId)}`);
            onClose();
          },
        },
        {
          id: "nav-bill",
          category: "Navigation",
          label: "Bill Comparison & Traceability",
          sublabel: "Compare measured items against consultant bill",
          badge: "Tab 2",
          icon: <FileTextIcon size={14} />,
          action: () => {
            navigate(`/p/${encodeURIComponent(currentProjectId)}/bill`);
            onClose();
          },
        },
        {
          id: "nav-rates",
          category: "Navigation",
          label: "Rates & Estimation Bill",
          sublabel: "Input unit rates and calculate tender estimate",
          badge: "Tab 3",
          icon: <CoinsIcon size={14} />,
          action: () => {
            navigate(`/p/${encodeURIComponent(currentProjectId)}/rates`);
            onClose();
          },
        },
      );

      // Sheets in current project
      if (project?.sheets) {
        for (const sheet of project.sheets) {
          list.push({
            id: `sheet-${sheet.id}`,
            category: "Sheets",
            label: `${sheet.code} · ${sheet.title}`,
            sublabel: `${sheet.shapes?.length || 0} detected elements`,
            badge: "Sheet",
            icon: <BlueprintIcon size={14} />,
            action: () => {
              navigate(`/p/${encodeURIComponent(currentProjectId)}?sheet=${encodeURIComponent(sheet.id)}`);
              onClose();
            },
          });
        }
      }

      // Bill comparison items
      if (project?.comparison) {
        for (const row of project.comparison) {
          list.push({
            id: `bill-${row.id}`,
            category: "Bill Lines",
            label: row.label,
            sublabel: `${row.section} · ${row.ours != null ? row.ours : "—"} ${row.unit}`,
            badge: row.section,
            icon: <FileTextIcon size={14} />,
            action: () => {
              navigate(`/p/${encodeURIComponent(currentProjectId)}/bill`);
              onClose();
            },
          });
        }
      }
    }

    // Projects list
    if (projectsQuery.data) {
      for (const p of projectsQuery.data) {
        list.push({
          id: `proj-${p.id}`,
          category: "Projects",
          label: p.name,
          sublabel: `${p.place} · ${p.drawings} sheets`,
          badge: p.id === currentProjectId ? "Current" : "Project",
          icon: <BlueprintIcon size={14} />,
          action: () => {
            navigate(`/p/${encodeURIComponent(p.id)}`);
            onClose();
          },
        });
      }
    }

    // Global Actions
    list.push(
      {
        id: "act-shortcuts",
        category: "Actions",
        label: "Keyboard Shortcuts Guide",
        sublabel: "View all keyboard navigation shortcuts",
        badge: "?",
        icon: <ZapIcon size={14} />,
        action: () => {
          onClose();
          onOpenShortcuts?.();
        },
      },
      {
        id: "act-theme",
        category: "Actions",
        label: "Toggle Theme (Light / Dark)",
        sublabel: "Switch interface lighting mode",
        badge: "Theme",
        icon: <ZapIcon size={14} />,
        action: () => {
          onToggleTheme?.();
          onClose();
        },
      },
      {
        id: "act-all-projects",
        category: "Actions",
        label: "Go to All Projects Dashboard",
        sublabel: "Return to projects listing",
        badge: "Home",
        icon: <BlueprintIcon size={14} />,
        action: () => {
          navigate("/projects");
          onClose();
        },
      },
    );

    return list;
  }, [currentProjectId, project, projectsQuery.data, navigate, onClose, onOpenShortcuts, onToggleTheme]);

  // Filter items by query
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        (item.sublabel && item.sublabel.toLowerCase().includes(q)) ||
        item.category.toLowerCase().includes(q),
    );
  }, [items, query]);

  // Handle keyboard navigation in palette
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < filteredItems.length - 1 ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredItems.length - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          filteredItems[selectedIndex].action();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, filteredItems, selectedIndex, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="command-modal" onClick={(e) => e.stopPropagation()}>
        <div className="command-input-wrap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className="command-input"
            type="text"
            placeholder="Search sheets, bill items, projects, or actions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="topbar-search-kbd">ESC</kbd>
        </div>

        <div className="command-list">
          {filteredItems.length === 0 ? (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              No results found for "{query}".
            </div>
          ) : (
            filteredItems.slice(0, 30).map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`command-item${isSelected ? " focused" : ""}`}
                  onClick={() => item.action()}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div className="command-item-left">
                    <span className="command-item-icon">{item.icon}</span>
                    <span className="command-item-label">
                      {item.label}
                      {item.sublabel ? <span className="command-item-sub"> · {item.sublabel}</span> : null}
                    </span>
                  </div>
                  {item.badge ? <span className="command-item-badge">{item.badge}</span> : null}
                </button>
              );
            })
          )}
        </div>

        <div className="command-footer">
          <div className="command-hints">
            <span><kbd>↑</kbd> <kbd>↓</kbd> to navigate</span>
            <span><kbd>↵</kbd> to select</span>
            <span><kbd>esc</kbd> to dismiss</span>
          </div>
          <span>Constech Quick Jump</span>
        </div>
      </div>
    </div>
  );
}
