import { useState, useEffect, useMemo, ChangeEvent, DragEvent, FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { usePageLoader } from "../components/PageLoader";
import { NewProjectModal } from "../components/NewProjectModal";
import { UploadFilesModal } from "../components/UploadFilesModal";
import { getAppSettings, saveAppSettings } from "../lib/settings";
import type { AppSettings, ExportItem, ProjectSummary } from "../types";
import {
  FolderPlusIcon,
  UploadCloudIcon,
  FileSpreadsheetIcon,
  SettingsIcon,
  BarChart3Icon,
  SearchIcon,
  DownloadIcon,
  CheckIcon,
  ZapIcon,
  ArrowRightIcon,
  TableIcon,
  LayersIcon,
} from "../components/Icons";

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      const base64 = res.includes(",") ? res.split(",")[1] : res;
      resolve(base64);
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

type MainDashboardTab = "projects" | "single_file" | "exports" | "settings";

export function ProjectsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const loader = usePageLoader();

  const [activeTab, setActiveTab] = useState<MainDashboardTab>("projects");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [uploadProjectTarget, setUploadProjectTarget] = useState<{ id: string; name: string } | null>(null);

  // Search & filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "has_bill" | "compared">("all");

  // Single-file takeoff state
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [singleSessionName, setSingleSessionName] = useState("");
  const [singleLocation, setSingleLocation] = useState("");
  const [isSingleDragging, setIsSingleDragging] = useState(false);
  const [singleUploading, setSingleUploading] = useState(false);
  const [singleError, setSingleError] = useState<string | null>(null);

  // Exports filter state
  const [exportSearch, setExportSearch] = useState("");
  const [exportCategoryFilter, setExportCategoryFilter] = useState("all");
  const [exportProjectFilter, setExportProjectFilter] = useState("all");

  // Settings state
  const [settings, setSettings] = useState<AppSettings>(getAppSettings);
  const [settingsSavedToast, setSettingsSavedToast] = useState(false);

  // Queries
  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });

  const { data: exports = [], isLoading: exportsLoading, refetch: refetchExports } = useQuery({
    queryKey: ["exports"],
    queryFn: () => api.listExports(),
    enabled: activeTab === "exports",
  });

  useEffect(() => {
    if (projectsLoading) loader.show();
    else loader.hide();
  }, [projectsLoading, loader]);

  // Aggregate stats
  const metrics = useMemo(() => {
    let totalDrawings = 0;
    let totalMeasuredSheets = 0;
    let totalComparedItems = 0;
    let totalCloseItems = 0;

    for (const p of projects) {
      totalDrawings += p.drawings || 0;
      totalMeasuredSheets += p.measuredSheets || 0;
      totalComparedItems += p.compared || 0;
      totalCloseItems += p.close || 0;
    }

    return {
      activeProjectsCount: projects.length,
      totalDrawings,
      totalMeasuredSheets,
      totalComparedItems,
      totalCloseItems,
      overallAccuracyPercent:
        totalComparedItems > 0 ? Math.round((totalCloseItems / totalComparedItems) * 100) : 0,
    };
  }, [projects]);

  // Filtered projects
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      const q = searchQuery.trim().toLowerCase();
      const matchSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.place && p.place.toLowerCase().includes(q)) ||
        p.id.toLowerCase().includes(q);

      if (!matchSearch) return false;

      if (statusFilter === "has_bill") return !!p.bill;
      if (statusFilter === "compared") return (p.compared || 0) > 0;
      return true;
    });
  }, [projects, searchQuery, statusFilter]);

  // Filtered exports
  const filteredExports = useMemo(() => {
    return exports.filter((item: ExportItem) => {
      const q = exportSearch.trim().toLowerCase();
      const matchSearch =
        !q ||
        item.fileName.toLowerCase().includes(q) ||
        item.projectName.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q);

      if (!matchSearch) return false;

      if (exportCategoryFilter !== "all" && item.category !== exportCategoryFilter) return false;
      if (exportProjectFilter !== "all" && item.projectId !== exportProjectFilter) return false;
      return true;
    });
  }, [exports, exportSearch, exportCategoryFilter, exportProjectFilter]);

  // Single-file handlers
  const handleSingleFileDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsSingleDragging(false);
    if (e.dataTransfer.files?.[0]) {
      const file = e.dataTransfer.files[0];
      setSingleFile(file);
      const cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ");
      setSingleSessionName(`Takeoff - ${cleanName.trim()}`);
      setSingleError(null);
    }
  };

  const handleSingleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const file = e.target.files[0];
      setSingleFile(file);
      const cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ");
      setSingleSessionName(`Takeoff - ${cleanName.trim()}`);
      setSingleError(null);
    }
  };

  const handleLaunchSingleFile = async (e: FormEvent) => {
    e.preventDefault();
    if (!singleFile) {
      setSingleError("Please choose or drop a drawing or BOQ file first.");
      return;
    }

    setSingleUploading(true);
    setSingleError(null);

    try {
      const b64 = await fileToBase64(singleFile);
      const projName = singleSessionName.trim() || `Takeoff - ${singleFile.name}`;
      const created = await api.createProject(projName, singleLocation.trim() || undefined, [
        { name: singleFile.name, content_base64: b64 },
      ]);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      // Direct navigation
      navigate(`/p/${encodeURIComponent(created.id)}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to launch single file takeoff.";
      setSingleError(msg);
    } finally {
      setSingleUploading(false);
    }
  };

  // Settings save handler
  const handleSaveSettings = (e: FormEvent) => {
    e.preventDefault();
    saveAppSettings(settings);
    setSettingsSavedToast(true);
    setTimeout(() => setSettingsSavedToast(false), 3000);
  };

  return (
    <main className="shell-main dashboard-view">
      {/* Executive Command Hub Bar */}
      <section className="dashboard-hub-header">
        <div className="dashboard-hub-intro">
          <h1>Estimation & Takeoff Command Center</h1>
          <p>
            AI-assisted structural quantity takeoff, drawing verification, bill comparison, and tender pricing.
          </p>
        </div>

        <div className="dashboard-hub-actions">
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setActiveTab("single_file")}
            title="Rapidly inspect an individual drawing or bill file without configuring a full project"
          >
            <ZapIcon size={15} /> Single-File Takeoff
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setNewProjectOpen(true)}
          >
            <FolderPlusIcon size={16} /> + New Project
          </button>
        </div>
      </section>

      {/* Navigation Tabs Switcher */}
      <nav className="dashboard-tabs-bar" aria-label="Dashboard Sections">
        <button
          type="button"
          className={`dashboard-tab-btn ${activeTab === "projects" ? "active" : ""}`}
          onClick={() => setActiveTab("projects")}
        >
          <LayersIcon size={16} />
          <span>Projects & Overview</span>
          <span className="tab-pill-badge">{projects.length}</span>
        </button>

        <button
          type="button"
          className={`dashboard-tab-btn ${activeTab === "single_file" ? "active" : ""}`}
          onClick={() => setActiveTab("single_file")}
        >
          <ZapIcon size={16} />
          <span>Single-File Takeoff</span>
          <span className="tab-pill-badge pill-accent">Instant</span>
        </button>

        <button
          type="button"
          className={`dashboard-tab-btn ${activeTab === "exports" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("exports");
            refetchExports();
          }}
        >
          <DownloadIcon size={16} />
          <span>Bills & Rates Hub</span>
          <span className="tab-pill-badge">{exports.length || "Files"}</span>
        </button>

        <button
          type="button"
          className={`dashboard-tab-btn ${activeTab === "settings" ? "active" : ""}`}
          onClick={() => setActiveTab("settings")}
        >
          <SettingsIcon size={16} />
          <span>Settings</span>
        </button>
      </nav>

      {/* TAB 1: PROJECTS & OVERVIEW */}
      {activeTab === "projects" && (
        <section className="dashboard-content-section rise">
          {/* Executive KPI Metric Tiles */}
          <div className="dashboard-kpi-grid">
            <div className="kpi-card">
              <div className="kpi-icon-wrap kpi-icon-blue">
                <FolderIcon />
              </div>
              <div className="kpi-body">
                <span className="kpi-label">Active Projects</span>
                <span className="kpi-value">{metrics.activeProjectsCount}</span>
                <span className="kpi-subtext">Multi-disciplinary work sets</span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon-wrap kpi-icon-purple">
                <LayersIcon size={20} />
              </div>
              <div className="kpi-body">
                <span className="kpi-label">Indexed Drawings</span>
                <span className="kpi-value">{metrics.totalDrawings}</span>
                <span className="kpi-subtext">
                  {metrics.totalMeasuredSheets} sheet{metrics.totalMeasuredSheets !== 1 ? "s" : ""} automated
                </span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon-wrap kpi-icon-teal">
                <BarChart3Icon size={20} />
              </div>
              <div className="kpi-body">
                <span className="kpi-label">Compared BOQ Lines</span>
                <span className="kpi-value">{metrics.totalComparedItems}</span>
                <span className="kpi-subtext">Contractor tender cross-check</span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon-wrap kpi-icon-green">
                <CheckIcon size={20} />
              </div>
              <div className="kpi-body">
                <span className="kpi-label">Tolerance Alignment</span>
                <span className="kpi-value">
                  {metrics.overallAccuracyPercent}%
                </span>
                <span className="kpi-subtext">Within &le;5% variance standard</span>
              </div>
            </div>
          </div>

          {/* Search, Filter & Quick Actions */}
          <div className="projects-control-bar">
            <div className="search-box-wrap">
              <SearchIcon size={16} className="search-icon-inline" />
              <input
                type="text"
                className="search-input"
                placeholder="Search projects by name, location, or slug..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setSearchQuery("")}
                >
                  &times;
                </button>
              )}
            </div>

            <div className="filter-pills-row">
              <button
                type="button"
                className={`filter-pill ${statusFilter === "all" ? "active" : ""}`}
                onClick={() => setStatusFilter("all")}
              >
                All ({projects.length})
              </button>
              <button
                type="button"
                className={`filter-pill ${statusFilter === "has_bill" ? "active" : ""}`}
                onClick={() => setStatusFilter("has_bill")}
              >
                With BOQ
              </button>
              <button
                type="button"
                className={`filter-pill ${statusFilter === "compared" ? "active" : ""}`}
                onClick={() => setStatusFilter("compared")}
              >
                Compared
              </button>
            </div>
          </div>

          {/* Projects Cards Grid */}
          <div className="cards">
            {filteredProjects.length === 0 && !projectsLoading ? (
              <div className="no-projects-empty">
                <FolderIcon />
                <h2>No matching projects found</h2>
                <p>
                  {searchQuery
                    ? "Try adjusting your search terms or filter."
                    : "Create a new project with drawings or drop a single CAD/PDF sheet to get started."}
                </p>
                <div style={{ marginTop: "16px", display: "flex", gap: "10px", justifyContent: "center" }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setNewProjectOpen(true)}
                  >
                    <FolderPlusIcon size={15} /> Create Project
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setActiveTab("single_file")}
                  >
                    <ZapIcon size={15} /> Single-File Takeoff
                  </button>
                </div>
              </div>
            ) : null}

            {filteredProjects.map((item: ProjectSummary, index: number) => {
              const closeCount = item.close ?? 0;
              const nearCount = item.near ?? 0;
              const farCount = item.far ?? 0;
              const totalCompared = closeCount + nearCount + farCount;
              const closePercent = totalCompared > 0 ? Math.round((closeCount / totalCompared) * 100) : 0;

              return (
                <article
                  className="card project-card-modern rise"
                  key={item.id}
                  style={{ ["--d" as string]: `${0.04 + index * 0.04}s` }}
                >
                  <div className="project-card-top">
                    <div>
                      <h2 className="project-card-title">{item.name}</h2>
                      <p className="place">{item.place || "General Site"}</p>
                    </div>
                    <span className="card-id-tag">#{item.id}</span>
                  </div>

                  <div className="card-meta-row">
                    <span className="card-stat" title={`${item.drawings} CAD and PDF sheets in drawings folder`}>
                      <LayersIcon size={13} />
                      {item.drawings} sheet{item.drawings !== 1 ? "s" : ""}
                    </span>
                    <span className="card-stat-sep" />
                    <span
                      className="card-stat"
                      title={item.bill ? `BOQ file: ${item.bill}` : "No tender BOQ sheet attached"}
                    >
                      <FileSpreadsheetIcon size={13} />
                      {item.bill ? (
                        <span className="truncate-text" style={{ maxWidth: "160px" }}>
                          {item.bill}
                        </span>
                      ) : (
                        "No BOQ"
                      )}
                    </span>
                  </div>

                  <div className="caps">
                    {(item.capabilities || []).slice(0, 4).map((cap) => (
                      <span className={`cap ${cap.status}`} key={cap.id} title={cap.reason}>
                        {cap.id.replace(/_/g, " ")}
                      </span>
                    ))}
                    {!item.capabilities?.length ? (
                      <span className="cap">Ready for Discovery</span>
                    ) : null}
                  </div>

                  {item.compared ? (
                    <div className="project-card-variance">
                      <div className="bands">
                        <span className="band close">{closeCount} &le;5%</span>
                        <span className="band near">{nearCount} &le;15%</span>
                        <span className="band far">{farCount} &gt;15%</span>
                      </div>
                      {closePercent > 0 && (
                        <div
                          className="card-progress"
                          title={`${closePercent}% of items match within 5% tolerance`}
                        >
                          <div className="card-progress-fill" style={{ width: `${closePercent}%` }} />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="meta" style={{ padding: "4px 0" }}>
                      No comparison run yet
                    </div>
                  )}

                  <div className="project-card-actions">
                    <Link className="btn btn-primary btn-sm flex-1" to={`/p/${encodeURIComponent(item.id)}`}>
                      Open Takeoff
                    </Link>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setUploadProjectTarget({ id: item.id, name: item.name })}
                      title="Add drawings or BOQ files to this project"
                    >
                      <UploadCloudIcon size={14} /> Add Files
                    </button>
                    <Link
                      className="btn btn-ghost btn-sm btn-icon-only"
                      to={`/p/${encodeURIComponent(item.id)}/rates`}
                      title="View Rates & Estimation"
                    >
                      <TableIcon size={14} />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* TAB 2: SINGLE-FILE TAKEOFF */}
      {activeTab === "single_file" && (
        <section className="dashboard-content-section rise">
          <div className="single-file-workbench">
            <div className="single-file-intro">
              <div className="single-file-badge">
                <ZapIcon size={14} /> Instant Inspection Mode
              </div>
              <h2>Single-File Rapid Takeoff</h2>
              <p>
                Drop a single structural CAD plan (.dwg, .dxf), floor drawing PDF, or contractor BOQ sheet (.xlsx, .csv).
                The engine creates an instant dedicated session and jumps right to measurement.
              </p>
            </div>

            {singleError && (
              <div className="alert-banner alert-banner-error" role="alert">
                {singleError}
              </div>
            )}

            <form onSubmit={handleLaunchSingleFile} className="single-file-form">
              <div
                className={`dropzone dropzone-large ${isSingleDragging ? "dropzone-active" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsSingleDragging(true);
                }}
                onDragLeave={() => setIsSingleDragging(false)}
                onDrop={handleSingleFileDrop}
              >
                <input
                  type="file"
                  id="single-file-input"
                  accept=".dwg,.dxf,.pdf,.png,.xlsx,.xls,.csv"
                  style={{ display: "none" }}
                  onChange={handleSingleFileChange}
                />
                <label htmlFor="single-file-input" className="dropzone-inner cursor-pointer">
                  <div className="dropzone-icon dropzone-icon-accent">
                    <UploadCloudIcon size={40} />
                  </div>
                  <div className="dropzone-text dropzone-text-large">
                    {singleFile ? (
                      <span className="file-selected-text">
                        Selected: <strong>{singleFile.name}</strong> ({formatBytes(singleFile.size)})
                      </span>
                    ) : (
                      <>
                        <strong>Drop your drawing or spreadsheet here</strong>, or browse
                      </>
                    )}
                  </div>
                  <div className="dropzone-hint">
                    CAD Drawing (.dwg, .dxf) &bull; PDF Floor/Foundation Sheet (.pdf) &bull; Excel BOQ (.xlsx, .csv)
                  </div>
                </label>
              </div>

              {singleFile && (
                <div className="single-file-config rise">
                  <div className="form-grid-2">
                    <div className="form-group">
                      <label htmlFor="single-session-name">
                        Session / Project Name <span className="req">*</span>
                      </label>
                      <input
                        id="single-session-name"
                        type="text"
                        className="input-text"
                        value={singleSessionName}
                        onChange={(e) => setSingleSessionName(e.target.value)}
                        placeholder="e.g. Ground Floor Foundation Plan"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor="single-loc">Location / Tag (Optional)</label>
                      <input
                        id="single-loc"
                        type="text"
                        className="input-text"
                        value={singleLocation}
                        onChange={(e) => setSingleLocation(e.target.value)}
                        placeholder="e.g. Sector B, Quick Check"
                      />
                    </div>
                  </div>

                  <div className="single-file-submit-row">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        setSingleFile(null);
                        setSingleSessionName("");
                      }}
                      disabled={singleUploading}
                    >
                      Clear File
                    </button>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={singleUploading || !singleSessionName.trim()}
                    >
                      {singleUploading ? (
                        <>
                          <span className="spinner-dots" /> Uploading & Processing...
                        </>
                      ) : (
                        <>
                          Launch Instant Takeoff <ArrowRightIcon size={16} />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </form>

            {/* Quick guide cards */}
            <div className="single-file-guide-grid">
              <div className="guide-card">
                <div className="guide-card-icon">1</div>
                <h3>Foundation & Piling Plan</h3>
                <p>
                  Extracts isolated footing dimensions, pile caps, strap beams, and computes concrete cubic meters and steel rebar weight automatically.
                </p>
              </div>
              <div className="guide-card">
                <div className="guide-card-icon">2</div>
                <h3>Floor Framing & Columns</h3>
                <p>
                  Indexes column schedules, slab perimeter thickness, drop panels, and summarizes structural concrete elements.
                </p>
              </div>
              <div className="guide-card">
                <div className="guide-card-icon">3</div>
                <h3>Contractor BOQ Bill</h3>
                <p>
                  Parses bill items, tenders, and units to cross-check contractor estimates against geometric calculations with unit rates.
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* TAB 3: GENERATED BILLS & RATES HUB */}
      {activeTab === "exports" && (
        <section className="dashboard-content-section rise">
          <div className="exports-hub-container">
            <div className="exports-hub-head">
              <div>
                <h2>Generated Bills & Rates Hub</h2>
                <p>
                  Centralized repository of all exported bill comparisons, Excel BOQ sheets, rates schedules, and engineering audit reports.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => refetchExports()}
              >
                Refresh List
              </button>
            </div>

            {/* Filter bar */}
            <div className="projects-control-bar">
              <div className="search-box-wrap">
                <SearchIcon size={16} className="search-icon-inline" />
                <input
                  type="text"
                  className="search-input"
                  placeholder="Filter files by name, project, or category..."
                  value={exportSearch}
                  onChange={(e) => setExportSearch(e.target.value)}
                />
                {exportSearch && (
                  <button
                    type="button"
                    className="search-clear-btn"
                    onClick={() => setExportSearch("")}
                  >
                    &times;
                  </button>
                )}
              </div>

              <div className="filter-selects-row">
                <select
                  className="select-input"
                  value={exportCategoryFilter}
                  onChange={(e) => setExportCategoryFilter(e.target.value)}
                  aria-label="Filter by category"
                >
                  <option value="all">All File Types</option>
                  <option value="BOQ Spreadsheet">BOQ Spreadsheets (.xlsx)</option>
                  <option value="Structural Comparison">Structural Comparison (.csv)</option>
                  <option value="Rates Schedule">Rates Schedule (.json)</option>
                  <option value="Raw Measurements">Raw Measurements (.json)</option>
                  <option value="Audit Report">Audit Reports (.md)</option>
                </select>

                <select
                  className="select-input"
                  value={exportProjectFilter}
                  onChange={(e) => setExportProjectFilter(e.target.value)}
                  aria-label="Filter by project"
                >
                  <option value="all">All Projects</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Exports Table */}
            <div className="exports-table-wrapper">
              {exportsLoading ? (
                <div className="loading-state-box">Loading export files...</div>
              ) : filteredExports.length === 0 ? (
                <div className="no-projects-empty" style={{ padding: "48px 16px" }}>
                  <FileSpreadsheetIcon size={36} />
                  <h3>No exported files found</h3>
                  <p>
                    {exportSearch || exportCategoryFilter !== "all" || exportProjectFilter !== "all"
                      ? "Try clearing filters."
                      : "Run discovery and bill comparisons or save rates to generate files."}
                  </p>
                </div>
              ) : (
                <table className="exports-table">
                  <thead>
                    <tr>
                      <th>File Name</th>
                      <th>Project</th>
                      <th>Category</th>
                      <th>Size</th>
                      <th>Date Modified</th>
                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExports.map((item: ExportItem) => {
                      const ext = item.ext?.toLowerCase() || "file";
                      return (
                        <tr key={`${item.projectId}-${item.fileName}`}>
                          <td>
                            <div className="export-file-cell">
                              <span className={`file-badge file-badge-${ext}`}>
                                {ext.toUpperCase()}
                              </span>
                              <span className="export-file-name" title={item.fileName}>
                                {item.fileName}
                              </span>
                            </div>
                          </td>
                          <td>
                            <Link
                              to={`/p/${encodeURIComponent(item.projectId)}`}
                              className="export-project-link"
                            >
                              {item.projectName}
                            </Link>
                          </td>
                          <td>
                            <span className="export-category-pill">{item.category}</span>
                          </td>
                          <td className="num-cell">{formatBytes(item.sizeBytes)}</td>
                          <td className="date-cell">{formatDate(item.modifiedAt)}</td>
                          <td style={{ textAlign: "right" }}>
                            <div className="action-buttons-cell">
                              <a
                                href={item.downloadUrl}
                                download={item.fileName}
                                className="btn btn-ghost btn-sm"
                                title="Download file to computer"
                              >
                                <DownloadIcon size={14} /> Download
                              </a>
                              <Link
                                to={`/p/${encodeURIComponent(item.projectId)}`}
                                className="btn btn-outline btn-sm"
                                title="Open project workspace"
                              >
                                Open
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>
      )}

      {/* TAB 4: SETTINGS & PREFERENCES */}
      {activeTab === "settings" && (
        <section className="dashboard-content-section rise">
          <div className="settings-container">
            <div className="settings-header">
              <div>
                <h2>Estimation & Workspace Settings</h2>
                <p>
                  Configure global estimation defaults, contractor overhead & profit margins, and measurement units.
                </p>
              </div>
            </div>

            {settingsSavedToast && (
              <div className="alert-banner alert-banner-success rise" role="alert">
                <CheckIcon size={16} /> Preferences successfully saved and applied to all future estimations!
              </div>
            )}

            <form onSubmit={handleSaveSettings} className="settings-form">
              <div className="settings-card">
                <h3>Financial & Estimation Currency</h3>
                <p className="settings-hint">
                  Default currency applied to unit rates schedules, material pricing, and bill totals.
                </p>
                <div className="form-group" style={{ maxWidth: "340px", marginTop: "12px" }}>
                  <label htmlFor="settings-curr">Default Currency</label>
                  <select
                    id="settings-curr"
                    className="select-input"
                    value={settings.currency}
                    onChange={(e) => setSettings({ ...settings, currency: e.target.value })}
                  >
                    <option value="AED">AED - United Arab Emirates Dirham (د.إ)</option>
                    <option value="USD">USD - United States Dollar ($)</option>
                    <option value="EUR">EUR - Euro (€)</option>
                    <option value="GBP">GBP - British Pound (£)</option>
                    <option value="SAR">SAR - Saudi Riyal (﷼)</option>
                    <option value="QAR">QAR - Qatari Riyal (﷼)</option>
                    <option value="KWD">KWD - Kuwaiti Dinar (KD)</option>
                    <option value="INR">INR - Indian Rupee (₹)</option>
                  </select>
                </div>
              </div>

              <div className="settings-card">
                <h3>Contractor OH&amp;P (Overhead &amp; Profit)</h3>
                <p className="settings-hint">
                  Standard contingency and margin percentage automatically incorporated into bill totals.
                </p>
                <div className="ohp-slider-box" style={{ marginTop: "12px", maxWidth: "420px" }}>
                  <div className="ohp-slider-labels">
                    <span>Default Markup:</span>
                    <strong>{settings.defaultMarkupPercent}%</strong>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="50"
                    step="0.5"
                    className="ohp-range-input"
                    value={settings.defaultMarkupPercent}
                    onChange={(e) =>
                      setSettings({ ...settings, defaultMarkupPercent: parseFloat(e.target.value) || 0 })
                    }
                  />
                  <div className="slider-ticks">
                    <span>0% (Net Cost)</span>
                    <span>15% (Standard)</span>
                    <span>30%</span>
                    <span>50%</span>
                  </div>
                </div>
              </div>

              <div className="settings-card">
                <h3>Measurement Units &amp; Precision</h3>
                <p className="settings-hint">
                  Units of measure for concrete volume, structural steel weights, and length geometry.
                </p>
                <div className="form-grid-2" style={{ marginTop: "12px", maxWidth: "560px" }}>
                  <div className="form-group">
                    <label htmlFor="settings-units">Measurement Standard</label>
                    <select
                      id="settings-units"
                      className="select-input"
                      value={settings.unitSystem}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          unitSystem: e.target.value as "metric" | "imperial",
                        })
                      }
                    >
                      <option value="metric">Metric (m, m², m³, kg, tonnes)</option>
                      <option value="imperial">Imperial (ft, sq ft, cu yd, lbs)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label htmlFor="settings-precision">Numeric Decimal Precision</label>
                    <select
                      id="settings-precision"
                      className="select-input"
                      value={settings.decimalPlaces}
                      onChange={(e) =>
                        setSettings({ ...settings, decimalPlaces: parseInt(e.target.value, 10) })
                      }
                    >
                      <option value="2">2 Decimal Places (e.g. 145.25)</option>
                      <option value="3">3 Decimal Places (e.g. 145.250)</option>
                      <option value="0">Whole Integers (e.g. 145)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="settings-actions">
                <button type="submit" className="btn btn-primary">
                  <CheckIcon size={16} /> Save Estimation Preferences
                </button>
              </div>
            </form>
          </div>
        </section>
      )}

      {/* MODALS */}
      <NewProjectModal
        isOpen={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ["projects"] })}
      />

      {uploadProjectTarget && (
        <UploadFilesModal
          projectId={uploadProjectTarget.id}
          projectName={uploadProjectTarget.name}
          isOpen={!!uploadProjectTarget}
          onClose={() => setUploadProjectTarget(null)}
          onUploaded={() => {
            queryClient.invalidateQueries({ queryKey: ["projects"] });
            refetchExports();
          }}
        />
      )}
    </main>
  );
}
