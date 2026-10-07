import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type { Sheet } from "../types";
import { useProjectContext } from "../context/ProjectContext";
import { MeasurementPanel } from "../components/MeasurementPanel";
import { SheetCanvas } from "../components/SheetCanvas";
import { KIND_META, KIND_ORDER } from "../lib/kinds";
import { bandOf, fmt, pctOf, signed } from "../lib/format";

function sheetsWithShapes(project: { sheets: Sheet[] }): Sheet[] {
  return (project.sheets || []).filter((s) => s.shapes?.length);
}

export function DrawingsPage() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const { project, phase, visibleShapeIds } = useProjectContext();
  const drawn = useMemo(() => {
    const measured = sheetsWithShapes(project);
    if (measured.length) return measured;
    if (phase === "measuring" || phase === "revealing") {
      return (project.sheets || []).filter((s) => s.image);
    }
    return measured;
  }, [project, phase]);
  const [sheetId, setSheetId] = useState<string | null>(drawn[0]?.id ?? null);
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [compareOpen, setCompareOpen] = useState(true);
  const [compareBand, setCompareBand] = useState("all");
  const [query, setQuery] = useState("");

  const sheet = drawn.find((s) => s.id === sheetId) ?? drawn[0];
  const selectedShape = sheet?.shapes.find((s) => s.id === selected);
  const measurementId = selectedShape?.measurementId ?? null;

  const traceFromBill = searchParams.get("line");
  const traceShapeIds = useMemo(() => {
    if (!traceFromBill) return null;
    const row = project.comparison.find((r) => r.id === traceFromBill);
    if (!row?.placements?.length || !sheet) return null;
    const ids = new Set(
      row.placements.filter((p) => p.sheetId === sheet.id && p.shapeId).map((p) => p.shapeId as string),
    );
    return ids.size ? ids : null;
  }, [traceFromBill, project.comparison, sheet]);

  useEffect(() => {
    const sheetParam = searchParams.get("sheet");
    const shapeParam = searchParams.get("shape");
    if (sheetParam && drawn.some((s) => s.id === sheetParam)) {
      setSheetId(sheetParam);
    }
    if (shapeParam) {
      setSelected(shapeParam);
      setPanelOpen(true);
    }
  }, [searchParams, drawn]);

  function refreshProject() {
    void qc.invalidateQueries({ queryKey: ["project", project.id] });
  }

  if (!drawn.length || !sheet) {
    return (
      <main className="shell-main">
        <section className="bill">
          <div className="empty">
            <h2>No outlines on these sheets yet</h2>
            <p>Discover reads the drawing set. Foundations and Structure measure the quantities and draw them here.</p>
          </div>
        </section>
      </main>
    );
  }

  const kinds = KIND_ORDER.filter((k) => sheet.shapes.some((s) => s.kind === k));
  const tally = { close: 0, near: 0, far: 0 };
  project.comparison.forEach((row) => {
    const b = bandOf(row);
    if (b in tally) tally[b as keyof typeof tally] += 1;
  });

  const filteredRows = project.comparison.filter((row) => {
    if (compareBand !== "all" && bandOf(row) !== compareBand) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (row.label + row.section + (row.note || "")).toLowerCase().includes(q);
  });

  return (
    <main className="shell-main tab-in">
      <section className={`workspace${panelOpen ? "" : " panel-hidden"}`}>
        <aside className="sheets">
          <div className="sheets-header">
            <p className="kicker">Sheets</p>
            <span className="sheet-count-badge">{drawn.length}</span>
          </div>
          <div className="sheet-scroll">
            {drawn.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`sheet-btn${entry.id === sheet.id ? " active" : ""}`}
                onClick={() => {
                  setSheetId(entry.id);
                  setSelected(null);
                  setFilter("all");
                }}
              >
                <b>{entry.code}</b>
                <span>{entry.title}</span>
                <small>{entry.shapes.length} detected</small>
              </button>
            ))}
          </div>
          <p className="sheet-note">
            {drawn.length} of {project.sheets.length} sheets have measured outlines. Schedules, notes, and rates are in the Rates and Bill tabs.
          </p>
        </aside>

        <div className="stage-wrap">
          {traceFromBill ? (
            <p className="bill-trace-banner">
              Highlighting placements for bill line{" "}
              <strong>{project.comparison.find((r) => r.id === traceFromBill)?.label ?? traceFromBill}</strong>
            </p>
          ) : null}
          <SheetCanvas
            project={project}
            sheet={sheet}
            filter={filter}
            selected={selected}
            panelOpen={panelOpen}
            visibleShapeIds={visibleShapeIds}
            highlightShapeIds={traceShapeIds}
            traceFocusShapeId={selected}
            onTogglePanel={() => setPanelOpen((v) => !v)}
            onSelect={(id) => setSelected(id)}
          />
          {project.comparison.length ? (
            <div className={`compare${compareOpen ? "" : " collapsed"}`}>
              <div className="compare-bar">
                <button
                  type="button"
                  className={`compare-pill${compareBand === "all" ? " on" : ""}`}
                  onClick={() => setCompareBand("all")}
                >
                  All {project.comparison.length}
                </button>
                <button
                  type="button"
                  className={`compare-pill close${compareBand === "close" ? " on" : ""}`}
                  onClick={() => setCompareBand("close")}
                >
                  {tally.close} within 5%
                </button>
                <button
                  type="button"
                  className={`compare-pill near${compareBand === "near" ? " on" : ""}`}
                  onClick={() => setCompareBand("near")}
                >
                  {tally.near} within 15%
                </button>
                <button
                  type="button"
                  className={`compare-pill far${compareBand === "far" ? " on" : ""}`}
                  onClick={() => setCompareBand("far")}
                >
                  {tally.far} further out
                </button>
                <input
                  className="search compare-search"
                  type="search"
                  placeholder="Search lines"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button type="button" className="btn btn-ghost compare-toggle" onClick={() => setCompareOpen((v) => !v)}>
                  {compareOpen ? "Hide" : "Show"}
                </button>
              </div>
              <div className="compare-body">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="num">Bill</th>
                      <th className="num">Measured</th>
                      <th className="num">Difference</th>
                      <th className="num">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length ? (
                      filteredRows.map((row) => {
                        const band = bandOf(row);
                        const pct = pctOf(row);
                        const diff = row.bill != null && row.ours != null ? row.ours - row.bill : null;
                        return (
                          <tr key={row.id} className={band}>
                            <td title={row.note}>{row.label}</td>
                            <td className="num">
                              {fmt(row.bill, row.digits)} {row.unit}
                            </td>
                            <td className="num">
                              {fmt(row.ours, row.digits)} {row.unit}
                            </td>
                            <td className="num">{signed(diff, row.digits)}</td>
                            <td className={`num pct ${band}`}>{pct == null ? "" : `${signed(pct, 1)}%`}</td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={5}>No lines match that search.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="compare collapsed">
              <div className="compare-bar">
                <span>No bill comparison on this project yet</span>
              </div>
            </div>
          )}
        </div>

        <aside className="panel">
          <div className="panel-head">
            <h2>On this sheet</h2>
            <div className="filters">
              <button type="button" className={`chip${filter === "all" ? " on" : ""}`} onClick={() => setFilter("all")}>
                All
                <span className="chip-count">{sheet.shapes.length}</span>
              </button>
              {kinds.map((kind) => {
                const kindCount = sheet.shapes.filter((s) => s.kind === kind).length;
                return (
                  <button
                    key={kind}
                    type="button"
                    className={`chip${filter === kind ? " on" : ""}`}
                    onClick={() => setFilter(kind)}
                  >
                    <i style={{ background: KIND_META[kind]?.color }} />
                    {KIND_META[kind]?.name ?? kind}
                    <span className="chip-count">{kindCount}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="detect-scroll">
            {KIND_ORDER.filter((k) => sheet.shapes.some((s) => s.kind === k)).map((kind) => (
              <div className="group" key={kind} hidden={filter !== "all" && filter !== kind}>
                <div className="group-label">{KIND_META[kind]?.name ?? kind}</div>
                {sheet.shapes
                  .filter((s) => s.kind === kind)
                  .map((shape) => (
                    <button
                      key={shape.id}
                      type="button"
                      className={`item${selected === shape.id ? " on" : ""}`}
                      hidden={filter !== "all" && shape.kind !== filter}
                      onClick={() => setSelected(shape.id)}
                    >
                      <i className="swatch" style={{ background: KIND_META[kind]?.color }} />
                      <span className="name">{shape.label}</span>
                    </button>
                  ))}
              </div>
            ))}
          </div>
          <MeasurementPanel
            projectId={project.id}
            sheet={sheet}
            measurements={project.measurements ?? []}
            reviewQueue={project.reviewQueue ?? []}
            selectedShapeId={selected}
            measurementId={measurementId}
            comparison={project.comparison ?? []}
            onSelectMeasurement={(id) => {
              if (!id) return;
              const target = sheet.shapes.find((s) => s.measurementId === id);
              if (target) setSelected(target.id);
            }}
            onSaved={refreshProject}
          />
        </aside>
      </section>
    </main>
  );
}
