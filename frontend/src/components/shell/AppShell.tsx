import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  ChevronRight,
  Download,
  FolderKanban,
  Layers,
  LogOut,
  Monitor,
  Moon,
  ScanLine,
  Search,
  Settings,
  Sparkles,
  Sun,
  UserRound,
} from "lucide-react";
import { api } from "../../api/client";
import type { PipelineStatus } from "../../types";
import { updateSettings, useSettings } from "../../lib/settings";
import { Logo } from "../brand/Logo";
import { Menu } from "../ui/Menu";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { ShellContext } from "./ShellContext";
import { ASSISTANT_TABS, PROJECT_TABS } from "./projectTabs";

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "QS"
  );
}

/** A dialog, palette or open menu owns the keyboard; page shortcuts wait. */
export function overlayOpen() {
  return Boolean(document.querySelector(".dialog-backdrop, .palette-backdrop"));
}

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const settings = useSettings();
  const user = useSyncExternalStore(api.onSession, () => sessionStorage.getItem("constech.takeoff.session"));
  const session = useMemo(() => (user ? api.session() : null), [user]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(() => localStorage.getItem("constech.assistant.open") === "1");

  const projectMatch = location.pathname.match(/^\/p\/([^/]+)(?:\/([^/]+))?/);
  const projectId = projectMatch ? decodeURIComponent(projectMatch[1]!) : null;
  const projectTab = projectMatch?.[2] ?? "";
  // The assistant works where it can read and change things: drawings, bill, rates and inputs.
  const assistantHere = Boolean(projectId) && ASSISTANT_TABS.has(projectTab);

  const summary = useQuery({
    queryKey: ["project", projectId, "summary"],
    queryFn: () => api.getProjectSummary(projectId!),
    enabled: Boolean(projectId),
  });
  const inputs = useQuery({
    queryKey: ["inputs", projectId],
    queryFn: () => api.getInputs(projectId!),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });
  const pipeline = useQuery<PipelineStatus>({
    queryKey: ["pipeline", projectId],
    queryFn: () => api.pipelineStatus(projectId!),
    enabled: false,
  });
  const running = pipeline.data?.job?.status === "running";
  const missingInputs = (inputs.data?.entries ?? []).filter((e) => e.status === "missing").length;

  useEffect(() => {
    try {
      localStorage.setItem("constech.assistant.open", assistantOpen ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }, [assistantOpen]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = e.target instanceof HTMLElement && e.target.matches("input, textarea, select, [contenteditable]");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        if (document.querySelector(".dialog-backdrop")) return;
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (typing || overlayOpen()) return;
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (e.altKey && projectId && /^[1-5]$/.test(e.key)) {
        e.preventDefault();
        const tab = PROJECT_TABS[Number(e.key) - 1]!;
        navigate(`/p/${encodeURIComponent(projectId)}${tab.path ? `/${tab.path}` : ""}`);
      } else if (e.altKey && e.key.toLowerCase() === "a" && assistantHere) {
        e.preventDefault();
        setAssistantOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, projectId, assistantHere]);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const shell = useMemo(
    () => ({ assistantOpen: assistantOpen && assistantHere, setAssistantOpen, openPalette, assistantAvailable: assistantHere }),
    [assistantOpen, assistantHere, openPalette],
  );

  const crumbs = useMemo(() => {
    const list: { label: string; to?: string }[] = [];
    const path = location.pathname;
    if (projectId) {
      list.push({ label: "Projects", to: "/projects" });
      list.push({ label: summary.data?.name ?? projectId, to: `/p/${encodeURIComponent(projectId)}` });
      const tab = PROJECT_TABS.find((t) => t.path === projectTab);
      list.push({ label: tab?.label ?? "Drawings" });
    } else if (path.startsWith("/quick")) list.push({ label: "Quick takeoff" });
    else if (path.startsWith("/exports")) list.push({ label: "Exports" });
    else if (path.startsWith("/settings")) list.push({ label: "Settings" });
    else list.push({ label: "Projects" });
    return list;
  }, [location.pathname, projectId, projectTab, summary.data?.name]);

  const ThemeIcon = settings.theme === "dark" ? Moon : settings.theme === "light" ? Sun : Monitor;
  const base = projectId ? `/p/${encodeURIComponent(projectId)}` : "";

  return (
    <ShellContext.Provider value={shell}>
      <div className="app">
        {/* The rail is a slim icon bar; hovering or tabbing into it opens it over the page. */}
        <aside className="rail" aria-label="Main navigation">
          <div className="rail-panel">
            <div className="rail-brand">
              <button type="button" className="brand-link" onClick={() => navigate("/projects")} aria-label="All projects">
                <span className="brand-mark">
                  <Logo variant="mark" height={26} />
                </span>
                <span className="brand-full">
                  <Logo height={24} />
                </span>
              </button>
            </div>
            <nav className="rail-scroll">
              <div className="rail-group">
                <div className="rail-label">Workspace</div>
                <RailLink to="/projects" icon={FolderKanban} label="Projects" end={false} active={!projectId && location.pathname.startsWith("/projects")} />
                <RailLink to="/quick" icon={ScanLine} label="Quick takeoff" />
                <RailLink to="/exports" icon={Download} label="Exports" />
              </div>
              {projectId ? (
                <div className="rail-group rail-project" key={projectId}>
                  <div className="rail-project-head" title={summary.data?.name}>
                    <span className="project-dot">{initials(summary.data?.name ?? projectId)}</span>
                    <span className="project-meta">
                      <span className="name">{summary.data?.name ?? projectId}</span>
                      <span className="place">{summary.data?.place || "Project"}</span>
                    </span>
                  </div>
                  {PROJECT_TABS.map((tab) => (
                    <RailLink
                      key={tab.path}
                      to={tab.path ? `${base}/${tab.path}` : base}
                      end={!tab.path}
                      icon={tab.icon}
                      label={tab.label}
                      badge={tab.path === "inputs" && missingInputs ? missingInputs : undefined}
                      pulse={tab.path === "pipeline" && running}
                    />
                  ))}
                </div>
              ) : null}
            </nav>
            <div className="rail-foot">
              <RailLink to="/settings" icon={Settings} label="Settings" />
              <Menu
                align="left"
                placement="up"
                width={240}
                trigger={({ open, toggle }) => (
                  <button type="button" className="rail-user" onClick={toggle} aria-label="Account menu" aria-haspopup="menu" aria-expanded={open}>
                    <span className="avatar">{initials(session?.name ?? "")}</span>
                    <span className="who">
                      <strong>{session?.name || "Quantity surveyor"}</strong>
                      <span>{session?.email ?? ""}</span>
                    </span>
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <button type="button" role="menuitem" className="menu-item" onClick={() => (close(), navigate("/settings#account"))}>
                      <UserRound size={15} /> Account settings
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      onClick={async () => {
                        close();
                        await api.logout();
                        navigate("/login", { replace: true, state: { switchAccount: true } });
                      }}
                    >
                      <ArrowLeftRight size={15} /> Switch account
                    </button>
                    <div className="menu-sep" />
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item danger"
                      onClick={async () => {
                        close();
                        await api.logout();
                        navigate("/login", { replace: true });
                      }}
                    >
                      <LogOut size={15} /> Log out
                    </button>
                  </>
                )}
              </Menu>
            </div>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <nav className="crumbs" aria-label="Breadcrumb">
              {crumbs.map((c, i) => (
                <span key={`${c.label}-${i}`} className="crumb">
                  {i > 0 ? <ChevronRight size={14} className="sep" /> : null}
                  {c.to ? <Link to={c.to}>{c.label}</Link> : <span className="current">{c.label}</span>}
                </span>
              ))}
            </nav>
            <div className="topbar-actions">
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                onClick={openPalette}
                aria-label="Search sheets, lines and actions"
                data-tip="Search  Ctrl K"
                data-tip-pos="bottom"
              >
                <Search size={17} />
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                aria-label="Change theme"
                data-tip={`Theme: ${settings.theme}`}
                data-tip-pos="bottom"
                onClick={() => updateSettings({ theme: settings.theme === "system" ? "dark" : settings.theme === "dark" ? "light" : "system" })}
              >
                <ThemeIcon size={17} />
              </button>
              {assistantHere ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm assistant-toggle"
                  aria-pressed={assistantOpen}
                  onClick={() => setAssistantOpen(!assistantOpen)}
                  data-tip="Alt A"
                  data-tip-pos="bottom"
                >
                  <Sparkles size={16} /> Assistant
                </button>
              ) : null}
            </div>
          </header>
          <div className="content">
            <Outlet />
          </div>
        </div>

        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onShortcuts={() => setShortcutsOpen(true)} />
        <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      </div>
    </ShellContext.Provider>
  );
}

function RailLink({
  to,
  icon: Icon,
  label,
  end = true,
  active,
  badge,
  pulse,
}: {
  to: string;
  icon: typeof Layers;
  label: string;
  end?: boolean;
  active?: boolean;
  badge?: number;
  pulse?: boolean;
}) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `rail-item${(active ?? isActive) ? " active" : ""}`} aria-label={label}>
      <Icon size={18} />
      <span className="rail-text">{label}</span>
      {badge ? (
        <span className="rail-badge" aria-label={`${badge} missing`}>
          {badge}
        </span>
      ) : null}
      {pulse ? <span className="rail-pulse" aria-label="Running" /> : null}
    </NavLink>
  );
}
