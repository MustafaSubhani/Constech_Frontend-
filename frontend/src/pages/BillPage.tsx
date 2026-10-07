import { Fragment, useMemo, useState, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BillLinePanel } from "../components/BillLinePanel";
import { useProjectContext } from "../context/ProjectContext";
import type { BillPlacement, CompareRow } from "../types";
import { bandOf, fmt, pctOf, signed } from "../lib/format";
import { DownloadIcon, PrinterIcon } from "../components/Icons";

function CopyIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function BarChart2Icon({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  );
}

function QtyCell({ value, unit, digits }: { value: number | null; unit: string; digits: number }) {
  const [copied, setCopied] = useState(false);
  const formatted = fmt(value, digits);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (formatted) {
      navigator.clipboard.writeText(formatted).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      });
    }
  }, [formatted]);

  return (
    <span className="qty-copy-wrap">
      <span>{formatted}</span>
      <span className="unit" style={{ marginLeft: 3 }}>{unit}</span>
      <button
        className="copy-btn"
        type="button"
        onClick={handleCopy}
        title={copied ? "Copied!" : "Copy value"}
        tabIndex={-1}
      >
        {copied ? "✓" : <CopyIcon size={11} />}
      </button>
    </span>
  );
}

type SortColumn = "default" | "label" | "bill" | "ours" | "diff" | "pct";

export function BillPage() {
  const { project, phase, progress } = useProjectContext();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusPlacement, setFocusPlacement] = useState<BillPlacement | null>(null);
  const [bandFilter, setBandFilter] = useState<"all" | "close" | "near" | "far" | "adjusted">("all");
  const [sortKey, setSortKey] = useState<SortColumn>("default");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Tally bands for the summary strip
  const { tally, adjustedCount } = useMemo(() => {
    const t = { close: 0, near: 0, far: 0 };
    let adj = 0;
    project.comparison.forEach((row) => {
      const b = bandOf(row);
      if (b in t) t[b as keyof typeof t] += 1;
      if (row.adjusted) adj += 1;
    });
    return { tally: t, adjustedCount: adj };
  }, [project.comparison]);

  // Filter and sort rows
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let filtered = project.comparison.filter((row) => {
      if (bandFilter === "adjusted") {
        if (!row.adjusted) return false;
      } else if (bandFilter !== "all" && bandOf(row) !== bandFilter) {
        return false;
      }
      if (!q) return true;
      return (row.label + row.section + (row.note || "")).toLowerCase().includes(q);
    });

    if (sortKey === "default") {
      return filtered;
    }

    return [...filtered].sort((a, b) => {
      let va: number | string = 0;
      let vb: number | string = 0;

      if (sortKey === "label") {
        va = a.label.toLowerCase();
        vb = b.label.toLowerCase();
      } else if (sortKey === "bill") {
        va = a.bill ?? -Infinity;
        vb = b.bill ?? -Infinity;
      } else if (sortKey === "ours") {
        va = a.ours ?? -Infinity;
        vb = b.ours ?? -Infinity;
      } else if (sortKey === "diff") {
        va = a.bill != null && a.ours != null ? a.ours - a.bill : -Infinity;
        vb = b.bill != null && b.ours != null ? b.ours - b.bill : -Infinity;
      } else if (sortKey === "pct") {
        va = pctOf(a) ?? -Infinity;
        vb = pctOf(b) ?? -Infinity;
      }

      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [project.comparison, query, bandFilter, sortKey, sortDir]);

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedId(null);
        setFocusPlacement(null);
      }
      if (!rows.length) return;
      const idx = rows.findIndex((r) => r.id === selectedId);
      if (e.key === "ArrowDown" && e.target instanceof HTMLElement && !e.target.matches("input, textarea, select")) {
        e.preventDefault();
        const next = idx < rows.length - 1 ? rows[idx + 1] : rows[0];
        setSelectedId(next.id);
      }
      if (e.key === "ArrowUp" && e.target instanceof HTMLElement && !e.target.matches("input, textarea, select")) {
        e.preventDefault();
        const prev = idx > 0 ? rows[idx - 1] : rows[rows.length - 1];
        setSelectedId(prev.id);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rows, selectedId]);

  const selectedRow = useMemo(
    () => project.comparison.find((row) => row.id === selectedId) ?? null,
    [project.comparison, selectedId],
  );

  const visibleCount =
    phase === "bill" && progress != null
      ? Math.max(0, Math.floor(progress * rows.length))
      : phase === "ready"
        ? rows.length
        : 0;

  let section = "";
  let dataIndex = 0;

  const hasComparison = project.comparison.length > 0;

  function toggleSort(col: SortColumn) {
    if (sortKey === col) {
      if (sortDir === "asc") setSortDir("desc");
      else {
        setSortKey("default");
        setSortDir("asc");
      }
    } else {
      setSortKey(col);
      setSortDir("asc");
    }
  }

  function renderSortIcon(col: SortColumn) {
    if (sortKey !== col) return null;
    return <span className="sort-indicator">{sortDir === "asc" ? "▲" : "▼"}</span>;
  }

  function exportCsv() {
    const lines = ["Section,Item,Consultant Bill,Unit,Measured,Difference,Variance %,Status,Formula/Note"];
    for (const row of project.comparison) {
      const diff = row.bill != null && row.ours != null ? row.ours - row.bill : "";
      const pct = pctOf(row);
      const pctStr = pct != null ? `${signed(pct, 1)}%` : "";
      const status = row.adjusted ? "Adjusted" : bandOf(row);
      lines.push([
        `"${(row.section || "").replace(/"/g, '""')}"`,
        `"${(row.label || "").replace(/"/g, '""')}"`,
        row.bill != null ? row.bill : "",
        `"${row.unit || ""}"`,
        row.ours != null ? row.ours : "",
        diff,
        `"${pctStr}"`,
        `"${status}"`,
        `"${(row.formula || row.note || "").replace(/"/g, '""')}"`,
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.toLowerCase().replace(/\s+/g, "-")}-bill-comparison.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="shell-main tab-in">
      <section className="bill-workbench">
        {/* Unified Top Control Bar */}
        <div className="workbench-bar">
          <div className="workbench-bar-top">
            <div className="workbench-title-group">
              <h2>Bill Comparison</h2>
              {hasComparison && (
                <span className="workbench-subtext">
                  {project.comparison.length} bill items · {tally.close + tally.near} within tolerance
                </span>
              )}
            </div>

            <div className="workbench-actions">
              <input
                className="search search-workbench"
                type="search"
                placeholder="Search items or sections…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {hasComparison ? (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={exportCsv}
                    title="Export comparison table as CSV"
                  >
                    <DownloadIcon size={13} style={{ marginRight: 4, verticalAlign: -1 }} />
                    Export CSV
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => window.print()}
                    title="Print comparison table"
                  >
                    <PrinterIcon size={13} style={{ marginRight: 4, verticalAlign: -1 }} />
                    Print
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {/* Filter Pills Bar */}
          {hasComparison && (
            <div className="workbench-bar-filters">
              <div className="filter-pills-group">
                <button
                  type="button"
                  className={`filter-pill${bandFilter === "all" ? " active" : ""}`}
                  onClick={() => setBandFilter("all")}
                >
                  All {project.comparison.length}
                </button>
                <button
                  type="button"
                  className={`filter-pill close${bandFilter === "close" ? " active" : ""}`}
                  onClick={() => setBandFilter(bandFilter === "close" ? "all" : "close")}
                >
                  <span className="band-dot close-dot" />
                  Within 5% ({tally.close})
                </button>
                <button
                  type="button"
                  className={`filter-pill near${bandFilter === "near" ? " active" : ""}`}
                  onClick={() => setBandFilter(bandFilter === "near" ? "all" : "near")}
                >
                  <span className="band-dot near-dot" />
                  Within 15% ({tally.near})
                </button>
                <button
                  type="button"
                  className={`filter-pill far${bandFilter === "far" ? " active" : ""}`}
                  onClick={() => setBandFilter(bandFilter === "far" ? "all" : "far")}
                >
                  <span className="band-dot far-dot" />
                  Out of band ({tally.far})
                </button>
                {adjustedCount > 0 ? (
                  <button
                    type="button"
                    className={`filter-pill adjusted${bandFilter === "adjusted" ? " active" : ""}`}
                    onClick={() => setBandFilter(bandFilter === "adjusted" ? "all" : "adjusted")}
                  >
                    <span className="band-dot adjusted-dot" />
                    Adjusted ({adjustedCount})
                  </button>
                ) : null}
              </div>

              <span className="workbench-hint">
                {selectedRow ? "Inspect CAD trace & formulas on right" : "Click any row to inspect traceability"}
              </span>
            </div>
          )}
        </div>

        {/* Empty States */}
        {!hasComparison ? (
          <div className="bill-empty-art">
            <BarChart2Icon size={56} />
            <h2>No bill comparison yet</h2>
            <p>Run Foundations and Structure from the pipeline above to measure quantities against the bill.</p>
          </div>
        ) : phase !== "ready" && phase !== "bill" ? (
          <div className="empty">
            <h2>Bill comparison</h2>
            <p>Available after quantities are located on the drawings.</p>
          </div>
        ) : phase === "bill" && visibleCount === 0 ? (
          <div className="empty">
            <h2>Building comparison</h2>
            <p>Matching lines to the consultant bill…</p>
          </div>
        ) : (
          /* Grid Layout: Full width when nothing selected, Clean Split when row selected */
          <div className={`bill-layout${selectedRow ? " has-selection" : " no-selection"}`}>
            <div className="bill-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="th-sortable" onClick={() => toggleSort("label")}>
                      Item {renderSortIcon("label")}
                    </th>
                    <th className="num th-sortable" onClick={() => toggleSort("bill")}>
                      Bill {renderSortIcon("bill")}
                    </th>
                    <th className="num th-sortable" onClick={() => toggleSort("ours")}>
                      Measured {renderSortIcon("ours")}
                    </th>
                    <th className="num th-sortable" onClick={() => toggleSort("diff")}>
                      Difference {renderSortIcon("diff")}
                    </th>
                    <th className="num th-sortable" onClick={() => toggleSort("pct")}>
                      % {renderSortIcon("pct")}
                    </th>
                    <th>Calculation Basis</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const band = bandOf(row);
                    const pct = pctOf(row);
                    const diff = row.bill != null && row.ours != null ? row.ours - row.bill : null;
                    const showSection = sortKey === "default" && row.section !== section;
                    if (showSection) section = row.section;
                    const show = phase === "ready" || (phase === "bill" && dataIndex < visibleCount);
                    if (show) dataIndex += 1;
                    const onRow = selectedId === row.id;
                    return (
                      <Fragment key={row.id}>
                        {showSection && show ? (
                          <tr className="section">
                            <td colSpan={6}>{row.section}</td>
                          </tr>
                        ) : null}
                        {show ? (
                          <tr
                            className={`${band}${onRow ? " selected" : ""}${row.adjusted ? " adjusted" : ""}`}
                            onClick={() => setSelectedId(row.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSelectedId(row.id);
                              }
                            }}
                          >
                            <td>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ fontWeight: 500 }}>{row.label}</span>
                                {row.adjusted ? <span className="pill inline">Adjusted</span> : null}
                                {sortKey !== "default" && (
                                  <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto" }}>
                                    {row.section}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="num">
                              <QtyCell value={row.bill} unit={row.unit} digits={row.digits} />
                            </td>
                            <td className="num">
                              <QtyCell value={row.ours} unit={row.unit} digits={row.digits} />
                            </td>
                            <td className="num">{signed(diff, row.digits)}</td>
                            <td className={`num pct ${band}`}>{pct == null ? "" : `${signed(pct, 1)}%`}</td>
                            <td className="note" title={row.formula || row.note || ""}>{row.formula || row.note}</td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: "28px" }}>
                        No lines match that filter.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {/* Side Inspector: Only renders when a row is selected */}
            {selectedRow && (
              <BillLinePanel
                project={project}
                row={selectedRow as CompareRow}
                focusPlacement={focusPlacement}
                onFocusPlacement={setFocusPlacement}
                onClose={() => {
                  setSelectedId(null);
                  setFocusPlacement(null);
                }}
                onSaved={() => {
                  void qc.invalidateQueries({ queryKey: ["project", project.id] });
                }}
              />
            )}
          </div>
        )}
      </section>
    </main>
  );
}
