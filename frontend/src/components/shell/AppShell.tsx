import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  Download,
  FolderKanban,
  ArrowLeftRight,
  Layers,
  LogOut,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
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
import { PROJECT_TABS } from "./projectTabs";

const RAIL_KEY = "constech.rail.collapsed";

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

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const settings = useSettings();
  const user = api.session();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(RAIL_KEY) === "1");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

  const projectMatch = location.pathname.match(/^\/p\/([^/]+)(?:\/([^/]+))?/);
  const projectId = projectMatch ? decodeURIComponent(projectMatch[1]!) : null;
  const projectTab = projectMatch?.[2] ?? "";

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
    localStorage.setItem(RAIL_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    if (!projectId) setAssistantOpen(false);
  }, [projectId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = e.target instanceof HTMLElement && e.target.matches("input, textarea, select, [contenteditable]");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (typing) return;
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      } else if (e.key === "[" && !e.ctrlKey) {
        setCollapsed((v) => !v);
      } else if (e.altKey && projectId && /^[1-5]$/.test(e.key)) {
        e.preventDefault();
        const tab = PROJECT_TABS[Number(e.key) - 1]!;
        navigate(`/p/${encodeURIComponent(projectId)}${tab.path ? `/${tab.path}` : ""}`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, projectId]);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const shell = useMemo(() => ({ assistantOpen, setAssistantOpen, openPalette }), [assistantOpen, openPalette]);

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

  const themeIcon = settings.theme === "dark" ? Moon : settings.theme === "light" ? Sun : Monitor;
  const ThemeIcon = themeIcon;
  const base = projectId ? `/p/${encodeURIComponent(projectId)}` : "";

  return (
    <ShellContext.Provider value={shell}>
      <div className={`app${collapsed ? " rail-collapsed" : ""}`}>
        <aside className="rail" aria-label="Main navigation">
          <div className="rail-brand">
            <button type="button" className="brand-link" onClick={() => navigate("/projects")} aria-label="All projects">
              <Logo height={24} />
            </button>
            <button
              type="button"
              className="rail-toggle"
              onClick={() => setCollapsed((v) => !v)}
              aria-label={collapsed ? "Expand side bar" : "Collapse side bar"}
              title={collapsed ? "Expand  [" : "Collapse  ["}
            >
              <span className="mark">
                <Logo variant="mark" height={24} />
              </span>
              <span className="icon">{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</span>
            </button>
          </div>
          <nav className="rail-scroll">
            <div className="rail-group">
              <div className="rail-label">Workspace</div>
              <RailLink to="/projects" icon={FolderKanban} label="Projects" collapsed={collapsed} end={false} active={!projectId && location.pathname.startsWith("/projects")} />
              <RailLink to="/quick" icon={ScanLine} label="Quick takeoff" collapsed={collapsed} />
              <RailLink to="/exports" icon={Download} label="Exports" collapsed={collapsed} />
            </div>
            {projectId ? (
              <div className="rail-project" key={projectId}>
                <div className="rail-project-head" title={collapsed ? summary.data?.name : undefined}>
                  <span className="project-dot">{initials(summary.data?.name ?? projectId)}</span>
                  <span className="project-meta">
                    <span className="name" title={summary.data?.name}>{summary.data?.name ?? projectId}</span>
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
                    collapsed={collapsed}
                    badge={tab.path === "inputs" && missingInputs ? missingInputs : undefined}
                    pulse={tab.path === "pipeline" && running}
                  />
                ))}
              </div>
            ) : null}
          </nav>
          <div className="rail-foot">
            <RailLink to="/settings" icon={Settings} label="Settings" collapsed={collapsed} />
            <Menu
              align="left"
              placement="up"
              width={230}
              trigger={({ open, toggle }) => (
                <button
                  type="button"
                  className="rail-user"
                  onClick={toggle}
                  aria-label="Account menu"
                  aria-haspopup="menu"
                  aria-expanded={open}
                >
                  <span className="avatar">{initials(user?.name ?? "")}</span>
                  <span className="who">
                    <strong>{user?.name ?? "Quantity surveyor"}</strong>
                    <span>{user?.email ?? ""}</span>
                  </span>
                </button>
              )}
            >
              {(close) => (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      close();
                      navigate("/settings#account");
                    }}
                  >
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
        </aside>

        <div className="main">
          <header className="topbar">
            <nav className="crumbs" aria-label="Breadcrumb">
              {crumbs.map((c, i) => (
                <span key={`${c.label}-${i}`} className="row" style={{ gap: 4, minWidth: 0 }}>
                  {i > 0 ? <ChevronRight size={14} className="sep" /> : null}
                  {c.to ? <Link to={c.to}>{c.label}</Link> : <span className="current">{c.label}</span>}
                </span>
              ))}
            </nav>
            <button type="button" className="search-trigger" onClick={openPalette}>
              <Search size={15} />
              <span>Search sheets, lines, actions</span>
              <kbd>Ctrl K</kbd>
            </button>
            <div className="topbar-actions">
              {projectId ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-pressed={assistantOpen}
                  onClick={() => setAssistantOpen(!assistantOpen)}
                >
                  <Sparkles size={15} /> Assistant
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                aria-label="Change theme"
                data-tip="Theme"
                data-tip-pos="bottom"
                onClick={() =>
                  updateSettings({ theme: settings.theme === "system" ? "dark" : settings.theme === "dark" ? "light" : "system" })
                }
              >
                <ThemeIcon size={16} />
              </button>
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
  collapsed,
  end = true,
  active,
  badge,
  pulse,
}: {
  to: string;
  icon: typeof Layers;
  label: string;
  collapsed: boolean;
  end?: boolean;
  active?: boolean;
  badge?: number;
  pulse?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `rail-item${(active ?? isActive) ? " active" : ""}`}
      title={collapsed ? label : undefined}
    >
      <Icon size={17} />
      <span className="rail-text">{label}</span>
      {badge ? <span className="rail-badge" aria-label={`${badge} missing`}>{badge}</span> : null}
      {pulse ? <span className="rail-pulse" aria-label="Running" /> : null}
    </NavLink>
  );
}
