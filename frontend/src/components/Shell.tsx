import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsModal } from "./ShortcutsModal";

const THEME_KEY = "constech.theme";

export function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [dark, setDark] = useState(() => localStorage.getItem(THEME_KEY) === "dark");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  }, [dark]);

  // Global keyboard listeners for Ctrl+K and ?
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
      } else if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
          e.preventDefault();
          setShortcutsOpen((v) => !v);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Compute current project context
  const projectMatch = location.pathname.match(/^\/p\/([^/]+)/);
  const currentProjectId = projectMatch ? decodeURIComponent(projectMatch[1]) : null;

  return (
    <div className="shell">
      <header className="topbar">
        {/* Brand & Project indicator */}
        <div className="topbar-left">
          <button className="brand" type="button" aria-label="All projects" onClick={() => navigate("/projects")}>
            <img src="/assets/20450-Mamdouh-Labib-V6_Logo11.png" alt="Constech" />
          </button>

          {currentProjectId ? (
            <div className="topbar-project-crumb">
              <span className="crumb-sep">/</span>
              <Link to="/projects" className="topbar-proj-link" title="Return to Dashboard">
                Dashboard
              </Link>
              <span className="crumb-sep">/</span>
              <span className="topbar-proj-active">{currentProjectId}</span>
            </div>
          ) : (
            <div className="topbar-project-crumb">
              <span className="crumb-sep">/</span>
              <span className="topbar-proj-active">Command Dashboard</span>
            </div>
          )}
        </div>

        {/* Global Quick Search (Ctrl+K) */}
        <button
          type="button"
          className="topbar-search-btn"
          onClick={() => setCommandPaletteOpen(true)}
          title="Search sheets, bill items, actions (Ctrl+K)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span className="search-placeholder">Jump to sheet, line, action…</span>
          <kbd className="topbar-search-kbd">Ctrl+K</kbd>
        </button>

        {/* Right utility actions */}
        <div className="top-actions">
          <button
            type="button"
            className="icon-action-btn"
            onClick={() => setShortcutsOpen(true)}
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
          >
            <span style={{ fontSize: 13, fontWeight: 700 }}>?</span>
          </button>

          <button
            type="button"
            className="theme-btn"
            aria-pressed={dark}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() => setDark((v) => !v)}
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
          >
            <svg className="moon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3a7 7 0 0 0 11.5 11.5z" />
            </svg>
            <svg className="sun" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
          </button>

          <div className="user-badge" title="Quantity Surveying & Takeoff Engineer">
            <span className="user-avatar-circle">QS</span>
            <span>QS Team</span>
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await api.logout();
              navigate("/login", { replace: true });
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="shell-body">
        <Outlet />
      </div>

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onToggleTheme={() => setDark((v) => !v)}
      />

      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
