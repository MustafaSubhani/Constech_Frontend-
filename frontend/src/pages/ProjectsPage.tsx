import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  Coins,
  FileSpreadsheet,
  FolderKanban,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  ScanLine,
  Search,
  Upload,
} from "lucide-react";
import { api } from "../api/client";
import type { ProjectSummary } from "../types";
import { capabilityLabel, capabilityTally } from "../lib/capabilities";
import { relativeTime } from "../lib/format";
import { NewProjectDialog } from "../components/NewProjectDialog";
import { UploadDialog } from "../components/UploadDialog";
import { Menu } from "../components/ui/Menu";

type Filter = "all" | "progress" | "compared" | "new";
type Sort = "updated" | "name" | "match";
type View = "grid" | "list";

function stageOf(p: ProjectSummary): { label: string; tone: string; step: number } {
  if (p.pipelineRunning) return { label: "Running", tone: "chip-brand", step: -1 };
  if (p.compared > 0) return { label: "Compared", tone: "chip-ok", step: 4 };
  if (p.runs.foundations || p.runs.structure) return { label: "Measured", tone: "chip-info", step: 3 };
  if (p.runs.discover) return { label: "Discovered", tone: "chip-warn", step: 2 };
  if (p.drawings > 0) return { label: "Files added", tone: "", step: 1 };
  return { label: "Not started", tone: "", step: 0 };
}

const STEPS = ["Files", "Discover", "Measure", "Compare"];

function matchShare(p: ProjectSummary) {
  return p.compared ? Math.round((p.close / p.compared) * 100) : null;
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("updated");
  const [view, setView] = useState<View>(() => {
    try {
      return (localStorage.getItem("constech.projects.view") as View) || "grid";
    } catch {
      return "grid";
    }
  });
  const [uploadFor, setUploadFor] = useState<ProjectSummary | null>(null);
  const newOpen = params.get("new") === "1";

  const { data: projects = [], isLoading, error } = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });

  useEffect(() => {
    try {
      localStorage.setItem("constech.projects.view", view);
    } catch {
      /* storage unavailable */
    }
  }, [view]);

  const totals = useMemo(() => {
    const t = { sheets: 0, compared: 0, close: 0 };
    for (const p of projects) {
      t.sheets += p.drawings;
      t.compared += p.compared;
      t.close += p.close;
    }
    return t;
  }, [projects]);

  const counts = useMemo(
    () => ({
      all: projects.length,
      progress: projects.filter((p) => !p.compared && p.runs.discover).length,
      compared: projects.filter((p) => p.compared > 0).length,
      new: projects.filter((p) => !p.runs.discover).length,
    }),
    [projects],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = projects.filter((p) => {
      if (q && !`${p.name} ${p.place} ${p.bill}`.toLowerCase().includes(q)) return false;
      if (filter === "progress") return !p.compared && p.runs.discover;
      if (filter === "compared") return p.compared > 0;
      if (filter === "new") return !p.runs.discover;
      return true;
    });
    return [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "match") return (matchShare(b) ?? -1) - (matchShare(a) ?? -1);
      return (b.updated || "").localeCompare(a.updated || "");
    });
  }, [projects, query, filter, sort]);

  const open = (p: ProjectSummary, tab = "") => navigate(`/p/${encodeURIComponent(p.id)}${tab ? `/${tab}` : ""}`);
  const closeNew = () => {
    params.delete("new");
    setParams(params, { replace: true });
  };

  return (
    <div className="page-scroll">
      <div className="page-wrap page">
        <header className="page-head">
          <div className="titles">
            <h1>Projects</h1>
            <p>Drawing sets, their measured quantities and how they compare with the bill.</p>
          </div>
          <div className="actions">
            <button type="button" className="btn btn-secondary" onClick={() => navigate("/quick")}>
              <ScanLine size={15} /> Quick takeoff
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setParams({ new: "1" })}>
              <Plus size={16} /> New project
            </button>
          </div>
        </header>

        <section className="stats" aria-label="Totals">
          <Stat label="Projects" value={projects.length} />
          <Stat label="Sheets indexed" value={totals.sheets} />
          <Stat label="Bill lines compared" value={totals.compared} />
          <Stat
            label="Within 5% of the bill"
            value={totals.compared ? `${Math.round((totals.close / totals.compared) * 100)}%` : "None yet"}
            sub={totals.compared ? `${totals.close} of ${totals.compared} lines` : undefined}
          />
        </section>

        <div className="toolbar">
          <div className="input-group">
            <Search size={15} />
            <input className="input" placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="segmented" role="group" aria-label="Filter projects">
            {(
              [
                ["all", "All"],
                ["progress", "In progress"],
                ["compared", "Compared"],
                ["new", "Not started"],
              ] as [Filter, string][]
            ).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                {label} <span className="count">{counts[key]}</span>
              </button>
            ))}
          </div>
          <div className="grow" />
          <select className="select input-sm" style={{ width: 170 }} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="updated">Recently updated</option>
            <option value="name">Name</option>
            <option value="match">Best match with bill</option>
          </select>
          <div className="segmented" role="group" aria-label="View">
            <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")} aria-label="Grid view">
              <LayoutGrid size={15} />
            </button>
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} aria-label="List view">
              <List size={15} />
            </button>
          </div>
        </div>

        {error ? <div className="banner banner-bad">{(error as Error).message}</div> : null}

        {!isLoading && shown.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <span className="empty-icon">
                <FolderKanban size={20} />
              </span>
              <h3>{projects.length ? "No projects match" : "No projects yet"}</h3>
              <p>
                {projects.length
                  ? "Try another search or filter."
                  : "Create a project from a drawing set, or start with a single sheet."}
              </p>
              {!projects.length ? (
                <div className="actions">
                  <button type="button" className="btn btn-primary" onClick={() => setParams({ new: "1" })}>
                    <Plus size={16} /> New project
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => navigate("/quick")}>
                    <ScanLine size={15} /> Quick takeoff
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : isLoading ? (
          <div className="project-grid" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="project-card skeleton" style={{ ["--delay" as string]: `${i * 120}ms` }}>
                <span className="sk sk-title" />
                <span className="sk sk-line" />
                <span className="sk sk-bar" />
                <span className="sk sk-line short" />
              </div>
            ))}
          </div>
        ) : view === "grid" ? (
          <div className="project-grid">
            {shown.map((p, i) => (
              <ProjectCard key={p.id} project={p} index={i} onOpen={open} onUpload={() => setUploadFor(p)} />
            ))}
          </div>
        ) : (
          <div className="card" style={{ overflow: "hidden" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Stage</th>
                  <th className="num">Sheets</th>
                  <th>Match with bill</th>
                  <th>Bill</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const stage = stageOf(p);
                  return (
                    <tr key={p.id} className="clickable" onClick={() => open(p)}>
                      <td>
                        <strong>{p.name}</strong>
                        {p.place ? <span className="muted small"> · {p.place}</span> : null}
                      </td>
                      <td>
                        <span className={`chip ${stage.tone}`}>{stage.label}</span>
                      </td>
                      <td className="num">{p.drawings}</td>
                      <td style={{ width: 220 }}>
                        <MatchBar p={p} compact />
                      </td>
                      <td className="muted truncate" style={{ maxWidth: 220 }}>{p.bill || "No bill selected"}</td>
                      <td className="muted">{relativeTime(p.updated)}</td>
                      <td onClick={(e) => e.stopPropagation()} style={{ width: 48 }}>
                        <CardMenu p={p} onOpen={open} onUpload={() => setUploadFor(p)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NewProjectDialog open={newOpen} onClose={closeNew} />
      {uploadFor ? (
        <UploadDialog
          open
          projectId={uploadFor.id}
          title={`Add files to ${uploadFor.name}`}
          onClose={() => setUploadFor(null)}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value tnum">{value}</span>
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </div>
  );
}

function MatchBar({ p, compact = false }: { p: ProjectSummary; compact?: boolean }) {
  if (!p.compared) return <span className="muted small">Not compared yet</span>;
  const total = p.compared;
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="match">
      <div className="match-bar" role="img" aria-label={`${p.close} within 5%, ${p.near} within 15%, ${p.far} over 15%`}>
        <span className="bg-close" style={{ width: seg(p.close) }} />
        <span className="bg-near" style={{ width: seg(p.near) }} />
        <span className="bg-far" style={{ width: seg(p.far) }} />
      </div>
      {!compact ? (
        <div className="match-legend">
          <span>
            <i className="bg-close" />
            {p.close} within 5%
          </span>
          <span>
            <i className="bg-near" />
            {p.near} within 15%
          </span>
          <span>
            <i className="bg-far" />
            {p.far} over
          </span>
        </div>
      ) : null}
    </div>
  );
}

function CardMenu({ p, onOpen, onUpload }: { p: ProjectSummary; onOpen: (p: ProjectSummary, tab?: string) => void; onUpload: () => void }) {
  return (
    <Menu
      trigger={({ toggle }) => (
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          aria-label={`Actions for ${p.name}`}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
        >
          <MoreHorizontal size={16} />
        </button>
      )}
    >
      {(close) => (
        <>
          <button type="button" className="menu-item" onClick={() => (close(), onUpload())}>
            <Upload size={15} /> Add files
          </button>
          <button type="button" className="menu-item" onClick={() => (close(), onOpen(p, "bill"))}>
            <FileSpreadsheet size={15} /> Bill comparison
          </button>
          <button type="button" className="menu-item" onClick={() => (close(), onOpen(p, "rates"))}>
            <Coins size={15} /> Rates and estimate
          </button>
        </>
      )}
    </Menu>
  );
}

function ProjectCard({
  project: p,
  index,
  onOpen,
  onUpload,
}: {
  project: ProjectSummary;
  index: number;
  onOpen: (p: ProjectSummary, tab?: string) => void;
  onUpload: () => void;
}) {
  const stage = stageOf(p);
  const tally = capabilityTally(p.capabilities);
  const coverageTitle = p.capabilities.map((c) => `${capabilityLabel(c.id)}: ${c.status}. ${c.reason ?? ""}`).join("\n");
  return (
    <article
      className="project-card enter"
      style={{ ["--delay" as string]: `${Math.min(index, 8) * 40}ms` }}
      tabIndex={0}
      role="link"
      aria-label={`Open ${p.name}`}
      onClick={() => onOpen(p)}
      onKeyDown={(e) => e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(p))}
    >
      <header className="pc-head">
        <div className="grow">
          <h3 className="truncate">{p.name}</h3>
          <p className="truncate">{p.place || `${p.drawings} sheets`}</p>
        </div>
        <span className={`chip ${stage.tone}`}>
          {stage.step === -1 ? <span className="spinner" style={{ width: 10, height: 10 }} /> : null}
          {stage.label}
        </span>
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <CardMenu p={p} onOpen={onOpen} onUpload={onUpload} />
        </span>
      </header>

      <ol className="stage-track" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className={i < stage.step ? "done" : ""}>
            <span className="st-dot">{i < stage.step ? <Check size={10} strokeWidth={3} /> : null}</span>
            <span className="st-label">{s}</span>
          </li>
        ))}
      </ol>

      <MatchBar p={p} />

      <footer className="pc-foot">
        <span className="truncate" title={p.bill || undefined}>
          <FileSpreadsheet size={13} /> {p.bill || "No bill selected"}
        </span>
        {p.capabilities.length ? (
          <span className="coverage" title={`Discovery coverage\n${coverageTitle}`}>
            <i className={`status-dot ${tally.blocked ? "warn" : "ok"}`} />
            {tally.ready} of {p.capabilities.length} ready
          </span>
        ) : null}
        <span className="muted">{relativeTime(p.updated)}</span>
      </footer>
    </article>
  );
}
