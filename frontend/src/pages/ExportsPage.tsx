import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, FileDown, RefreshCw, Search } from "lucide-react";
import { api } from "../api/client";
import { formatBytes, relativeTime } from "../lib/format";
import { ExportMenu } from "../components/ExportMenu";

export function ExportsPage() {
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("all");
  const exports = useQuery({ queryKey: ["exports"], queryFn: api.listExports });
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (exports.data ?? []).filter((item) => {
      if (project !== "all" && item.projectId !== project) return false;
      return !q || `${item.fileName} ${item.projectName} ${item.category}`.toLowerCase().includes(q);
    });
  }, [exports.data, query, project]);

  return (
    <div className="page-scroll">
      <div className="page-wrap page">
        <header className="page-head">
          <div className="titles">
            <h1>Exports</h1>
            <p>Generate bill comparisons and estimates, or download files already in each project.</p>
          </div>
        </header>

        <section>
          <h2 className="section-heading">Generate</h2>
          <div className="export-grid">
            {(projects.data ?? []).map((p) => (
              <div className="card export-card" key={p.id}>
                <div className="grow">
                  <strong className="truncate">{p.name}</strong>
                  <span className="muted small">
                    {p.compared ? `${p.compared} lines compared` : "Not compared yet"}
                  </span>
                </div>
                <ExportMenu projectId={p.id} disabled={!p.lines} />
              </div>
            ))}
            {projects.isLoading
              ? [0, 1, 2].map((i) => (
                  <div className="card export-card" key={`sk${i}`}>
                    <div className="grow stack" style={{ gap: 6 }}>
                      <span className="sk sk-title" style={{ ["--delay" as string]: `${i * 120}ms` }} />
                      <span className="sk sk-line short" />
                    </div>
                  </div>
                ))
              : null}
          </div>
          {!projects.isLoading && !projects.data?.length ? (
            <p className="muted small">
              No projects yet. <Link to="/projects?new=1">Create one</Link> to generate comparisons and estimates.
            </p>
          ) : null}
          {projects.error ? <div className="banner banner-bad">{(projects.error as Error).message}</div> : null}
        </section>

        <section className="stack" style={{ gap: 12 }}>
          <div className="toolbar">
            <h2 className="section-heading grow" style={{ margin: 0 }}>Project files</h2>
            <div className="input-group">
              <Search size={15} />
              <input className="input input-sm" placeholder="Filter files" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <select className="select input-sm" style={{ width: 200 }} value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="all">All projects</option>
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => exports.refetch()}>
              <RefreshCw size={14} className={exports.isFetching ? "spin" : undefined} /> Refresh
            </button>
          </div>
          <div className="card table-card">
            {rows.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">
                  <FileDown size={20} />
                </span>
                <h3>{exports.isLoading ? "Loading files" : "No files"}</h3>
                <p>Bills, rate sheets and engine reports appear here once a project has them.</p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Project</th>
                    <th>Type</th>
                    <th className="num">Size</th>
                    <th>Modified</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => (
                    <tr key={item.downloadUrl}>
                      <td>
                        <div className="row">
                          <span className={`file-ext x-${item.ext}`}>{item.ext.toUpperCase()}</span>
                          <span className="truncate" style={{ maxWidth: 360 }} title={item.fileName}>
                            {item.fileName}
                          </span>
                        </div>
                      </td>
                      <td>
                        <Link to={`/p/${encodeURIComponent(item.projectId)}`}>{item.projectName}</Link>
                      </td>
                      <td className="muted">{item.category}</td>
                      <td className="num muted">{formatBytes(item.sizeBytes)}</td>
                      <td className="muted">{relativeTime(item.modifiedAt)}</td>
                      <td style={{ textAlign: "right" }}>
                        <a className="btn btn-ghost btn-sm" href={item.downloadUrl} download>
                          <Download size={14} /> Download
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
