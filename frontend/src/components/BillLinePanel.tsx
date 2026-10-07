import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { BillPlacement, CompareRow, Project } from "../types";
import { api } from "../api/client";
import { fmt, pctOf, signed } from "../lib/format";
import { BillTraceCanvas } from "./BillTraceCanvas";
import {
  BlueprintIcon,
  FileTextIcon,
  CpuIcon,
  PencilIcon,
  TableIcon,
  CloseIcon,
  ExternalLinkIcon,
  ArrowRightIcon,
  ZapIcon,
} from "./Icons";

type Props = {
  project: Project;
  row: CompareRow | null;
  focusPlacement: BillPlacement | null;
  onFocusPlacement: (placement: BillPlacement | null) => void;
  onSaved: () => void;
  onClose: () => void;
};

function SourceIcon({ role }: { role: string }) {
  if (role.includes("drawing")) return <BlueprintIcon size={14} />;
  if (role.includes("bill")) return <FileTextIcon size={14} />;
  if (role.includes("engine")) return <CpuIcon size={14} />;
  if (role.includes("manual")) return <PencilIcon size={14} />;
  if (role.includes("schedule")) return <TableIcon size={14} />;
  return <FileTextIcon size={14} />;
}

function dimText(p: BillPlacement): string {
  const parts: string[] = [];
  if (p.areaM2 != null) parts.push(`${p.areaM2} m² plan`);
  if (p.widthMm != null && p.heightMm != null) parts.push(`${p.widthMm}×${p.heightMm} mm`);
  if (p.depthMm != null) parts.push(`${p.depthMm} mm deep`);
  return parts.join(" · ");
}

/** Parse a formula string into highlighted segments */
function FormulaDisplay({ formula }: { formula: string }) {
  if (!formula) return <span className="formula-empty">No formula recorded.</span>;

  // Highlight numbers (dimensions), operators, and descriptive words
  const parts = formula.split(/(\b\d+(?:\.\d+)?\s*(?:m³|m²|mm|m|kg|t)?\b|\+|\-|\×|×|\*|\/|=|\(|\))/g);
  return (
    <span className="formula-text">
      {parts.map((part, i) => {
        if (/^\d+(?:\.\d+)?/.test(part)) {
          return (
            <span key={i} className="formula-num">
              {part}
            </span>
          );
        }
        if (/^[+\-×*\/=()]/.test(part)) {
          return (
            <span key={i} className="formula-op">
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

function evaluateMathExpression(expr: string): number | null {
  if (!expr) return null;
  const clean = expr.replace(/^=/, "").trim();
  if (!/^[\d\s+\-*/.()]+$/.test(clean)) return null;
  if (!/\d/.test(clean)) return null;
  try {
    const fn = new Function(`"use strict"; return (${clean});`);
    const val = fn();
    if (typeof val === "number" && !isNaN(val) && isFinite(val)) {
      return Math.round(val * 1000) / 1000;
    }
  } catch {
    return null;
  }
  return null;
}

export function BillLinePanel({
  project,
  row,
  focusPlacement,
  onFocusPlacement,
  onSaved,
  onClose,
}: Props) {
  const [editOurs, setEditOurs] = useState("");
  const [editFormula, setEditFormula] = useState("");
  const [editReason, setEditReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [placementQuery, setPlacementQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"trace" | "calc" | "adjust">("calc");

  const evalResult = useMemo(() => evaluateMathExpression(editFormula), [editFormula]);

  const placements = row?.placements ?? [];

  const filteredPlacements = useMemo(() => {
    const q = placementQuery.trim().toLowerCase();
    if (!q) return placements;
    return placements.filter((p) =>
      (p.tag + p.sourceFile + p.sheetId + (p.label || "")).toLowerCase().includes(q),
    );
  }, [placements, placementQuery]);

  const traceSheet = useMemo(() => {
    const sid = focusPlacement?.sheetId || placements.find((p) => p.shapeId)?.sheetId || placements[0]?.sheetId;
    if (!sid) return undefined;
    return (
      project.sheets.find((s) => s.id === sid) ||
      project.sheets.find((s) => s.id.toLowerCase() === sid.toLowerCase()) ||
      project.sheets.find((s) => s.code.toLowerCase() === sid.toLowerCase()) ||
      project.sheets.find((s) => sid.toLowerCase().includes(s.id.toLowerCase()))
    );
  }, [focusPlacement, placements, project.sheets]);

  const sourceSheet = useMemo(() => {
    if (traceSheet) return traceSheet;
    for (const s of row?.sources || []) {
      if (s.file && (s.file.endsWith(".dwg") || s.role === "drawing")) {
        const stem = s.file.replace(/\.dwg$/i, "");
        const hit =
          project.sheets.find((sh) => sh.id === stem) ||
          project.sheets.find((sh) => sh.id.toLowerCase() === stem.toLowerCase()) ||
          project.sheets.find((sh) => sh.code.toLowerCase() === stem.toLowerCase()) ||
          project.sheets.find((sh) => stem.toLowerCase().includes(sh.id.toLowerCase()));
        if (hit) return hit;
      }
    }
    return project.sheets[0];
  }, [traceSheet, row?.sources, project.sheets]);

  function openSheetOnDrawings(sheetId?: string) {
    const sid = sheetId || sourceSheet?.id;
    const params = new URLSearchParams();
    if (row) params.set("line", row.id);
    if (sid) params.set("sheet", sid);
    return `/p/${encodeURIComponent(project.id)}?${params.toString()}`;
  }

  useEffect(() => {
    if (!row) return;
    setEditOurs(row.ours != null ? String(row.ours) : "");
    setEditFormula(row.formula || row.note || "");
    setEditReason(row.adjustmentReason || "");
    setPlacementQuery("");
    // Auto-switch to trace tab if placements exist
    setActiveTab(placements.length > 0 ? "trace" : "calc");
  }, [row]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!row?.placements?.length) {
      onFocusPlacement(null);
      return;
    }
    const withShape = row.placements.find((p) => p.shapeId);
    onFocusPlacement(withShape ?? row.placements[0] ?? null);
  }, [row?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- reset focus when bill line changes

  if (!row) {
    return (
      <aside className="bill-detail empty">
        <div className="bill-detail-placeholder">
          <svg viewBox="0 0 48 48" fill="none" className="placeholder-icon">
            <rect x="8" y="14" width="32" height="26" rx="3" stroke="currentColor" strokeWidth="1.8" />
            <line x1="14" y1="22" x2="34" y2="22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="14" y1="28" x2="28" y2="28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="14" y1="34" x2="24" y2="34" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="35" cy="13" r="6" fill="var(--teal-soft)" stroke="var(--teal-deep)" strokeWidth="1.5" />
            <line x1="33" y1="13" x2="37" y2="13" stroke="var(--teal-deep)" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="35" y1="11" x2="35" y2="15" stroke="var(--teal-deep)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <p>Select a bill line to see its traced sources, formula, and applied adjustments.</p>
        </div>
      </aside>
    );
  }

  const diff = row.bill != null && row.ours != null ? row.ours - row.bill : null;
  const pct = pctOf(row);
  const inputs = row.inputs || {};
  const rolled = inputs.rolledTotal as number | undefined;
  const elementCount = inputs.elementCount as number | undefined;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (editOurs === "" || !row) return;
    setBusy(true);
    try {
      await api.adjustBillLine(project.id, row.id, {
        ours: Number(editOurs),
        formula: editFormula,
        adjustment_reason: editReason || "Manual adjustment on bill comparison",
      });
      onSaved();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not save adjustment.");
    } finally {
      setBusy(false);
    }
  }

  function openOnDrawings(p: BillPlacement) {
    const params = new URLSearchParams();
    if (row) params.set("line", row.id);
    if (p.sheetId) params.set("sheet", p.sheetId);
    if (p.shapeId) params.set("shape", p.shapeId);
    return `/p/${encodeURIComponent(project.id)}?${params.toString()}`;
  }

  const diffClass = diff == null ? "" : diff > 0 ? "positive" : diff < 0 ? "negative" : "zero";

  return (
    <aside className="bill-detail">
      <div className="bill-detail-head">
        <div>
          <span className="bill-detail-section">{row.section}</span>
          <h2>{row.label}</h2>
          {row.adjusted ? <span className="pill adjusted">Adjusted</span> : null}
        </div>
        <button type="button" className="btn btn-ghost btn-close" onClick={onClose} aria-label="Close">
          <CloseIcon size={16} />
        </button>
      </div>

      {/* Key stats */}
      <dl className="bill-detail-stats">
        <div className="stat-cell">
          <dt>Consultant Bill</dt>
          <dd>
            {fmt(row.bill, row.digits)} <span className="unit">{row.unit}</span>
          </dd>
        </div>
        <div className="stat-cell">
          <dt>Measured</dt>
          <dd>
            {fmt(row.ours, row.digits)} <span className="unit">{row.unit}</span>
            {row.engineOurs != null && row.adjusted && row.engineOurs !== row.ours ? (
              <span className="muted engine-val"> · engine {fmt(row.engineOurs, row.digits)}</span>
            ) : null}
          </dd>
        </div>
        <div className="stat-cell">
          <dt>Difference</dt>
          <dd className={`diff-val ${diffClass}`}>{signed(diff, row.digits)}</dd>
        </div>
        <div className="stat-cell">
          <dt>Variance</dt>
          <dd className={`diff-val ${diffClass}`}>{pct == null ? "" : `${signed(pct, 1)}%`}</dd>
        </div>
      </dl>

      {/* Tabs */}
      <div className="detail-tabs">
        <button
          type="button"
          className={`detail-tab${activeTab === "trace" ? " active" : ""}`}
          onClick={() => setActiveTab("trace")}
        >
          {placements.length > 0 ? (
            <span className="tab-badge">{placements.length}</span>
          ) : null}
          Trace
        </button>
        <button
          type="button"
          className={`detail-tab${activeTab === "calc" ? " active" : ""}`}
          onClick={() => setActiveTab("calc")}
        >
          Calculation
        </button>
        <button
          type="button"
          className={`detail-tab${activeTab === "adjust" ? " active" : ""}`}
          onClick={() => setActiveTab("adjust")}
        >
          {row.adjusted ? <span className="tab-dot" /> : null}
          Adjust
        </button>
      </div>

      {/* TRACE TAB */}
      {activeTab === "trace" && (
        <div className="detail-pane">
          {placements.length > 0 ? (
            <>
              {/* Mini drawing canvas */}
              <div className="trace-canvas-wrap">
                {focusPlacement?.sourceFile ? (
                  <div className="trace-file-banner">
                    <span className="trace-file-icon"><BlueprintIcon size={14} /></span>
                    <div>
                      <strong>{focusPlacement.sourceFile}</strong>
                      {focusPlacement.sheetCode ? (
                        <span className="muted"> · {focusPlacement.sheetCode}</span>
                      ) : null}
                      {focusPlacement.tag ? (
                        <span className="muted"> · {focusPlacement.tag}</span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <BillTraceCanvas
                  project={project}
                  sheet={traceSheet}
                  placements={placements}
                  focusPlacement={focusPlacement}
                  onSelectShape={(shapeId) => {
                    const hit = placements.find((p) => p.shapeId === shapeId);
                    if (hit) onFocusPlacement(hit);
                  }}
                />
              </div>

              {/* Placement list */}
              <div className="placements-head">
                <span className="placements-count">{placements.length} source elements</span>
                <input
                  className="search placements-search"
                  type="search"
                  placeholder="Filter tag or file"
                  value={placementQuery}
                  onChange={(e) => setPlacementQuery(e.target.value)}
                />
              </div>
              <ul className="placement-list">
                {filteredPlacements.slice(0, 80).map((p) => {
                  const active =
                    focusPlacement?.measurementId === p.measurementId &&
                    focusPlacement?.shapeId === p.shapeId;
                  const dims = dimText(p);
                  return (
                    <li key={p.measurementId}>
                      <button
                        type="button"
                        className={`placement-row${active ? " on" : ""}`}
                        onClick={() => onFocusPlacement(p)}
                      >
                        <div className="placement-row-main">
                          <span className="placement-tag">{p.tag || p.label || ""}</span>
                          <span className="placement-qty">
                            {fmt(p.quantity, row.digits)} {row.unit}
                          </span>
                        </div>
                        {dims ? <span className="placement-dims">{dims}</span> : null}
                        <span className="placement-file">{p.sourceFile}</span>
                      </button>
                      <Link className="placement-open" to={openOnDrawings(p)} title="Open on drawings">
                        <ExternalLinkIcon size={12} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {filteredPlacements.length > 80 ? (
                <p className="muted small-note">
                  Showing 80 of {filteredPlacements.length}. Use the filter to narrow.
                </p>
              ) : null}
            </>
          ) : (
            <div className="trace-rule-basis">
              <div className="trace-file-banner">
                <span className="trace-file-icon"><FileTextIcon size={14} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{sourceSheet ? sourceSheet.title : (row.sources?.[0]?.file || "Drawing Reference")}</strong>
                  {sourceSheet?.code ? <span className="muted"> · {sourceSheet.code}</span> : null}
                  <span className="muted"> · Schedule / Calculation basis</span>
                </div>
                {sourceSheet ? (
                  <Link
                    className="btn btn-ghost btn-sm"
                    to={openSheetOnDrawings(sourceSheet.id)}
                    style={{ fontSize: 12, padding: "3px 8px" }}
                    title="Open on drawings canvas"
                  >
                    Open sheet <ExternalLinkIcon size={11} style={{ marginLeft: 3, verticalAlign: -1 }} />
                  </Link>
                ) : null}
              </div>

              {sourceSheet ? (
                <div className="trace-canvas-wrap">
                  <BillTraceCanvas
                    project={project}
                    sheet={sourceSheet}
                    placements={[]}
                    focusPlacement={null}
                    onSelectShape={() => {}}
                  />
                </div>
              ) : null}

              <div style={{ padding: "10px 14px", background: "rgba(43, 2, 102, 0.04)", borderRadius: 6, margin: "12px 0" }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--purple-deep)", letterSpacing: "0.5px" }}>
                  Schedule &amp; Drawing Basis
                </span>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  {row.formula || row.note || "Calculated from engineering schedules and plan dimensions across the drawings below."}
                </p>
              </div>

              {/* Source list */}
              {(row.sources || []).length > 0 ? (
                <ul className="source-list-rich">
                  {(row.sources || []).map((source, index) => (
                    <li key={`${source.role}-${index}`} className="source-rich-item">
                      <span className="source-icon"><SourceIcon role={source.role} /></span>
                      <div className="source-text">
                        <strong>{source.role.replace(/_/g, " ")}</strong>
                        {source.file ? <code className="source-file-name">{source.file}</code> : null}
                        {source.detail ? <span className="muted">{source.detail}</span> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}

          {/* Other references (non-drawing sources) */}
          {placements.length > 0 && (row.sources || []).filter((s) => s.role !== "drawing").length > 0 ? (
            <details className="sources-details">
              <summary>Other references</summary>
              <ul className="source-list-rich compact">
                {(row.sources || [])
                  .filter((s) => s.role !== "drawing")
                  .map((source, index) => (
                    <li key={`${source.role}-${index}`} className="source-rich-item">
                      <span className="source-icon"><SourceIcon role={source.role} /></span>
                      <div className="source-text">
                        <strong>{source.role.replace(/_/g, " ")}</strong>
                        {source.file ? <span className="source-file-name">{source.file}</span> : null}
                        {source.detail ? <span className="muted">{source.detail}</span> : null}
                      </div>
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}

      {/* CALCULATION TAB */}
      {activeTab === "calc" && (
        <div className="detail-pane">
          <div className="calc-section">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div className="calc-label" style={{ margin: 0 }}>Formula</div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setActiveTab("adjust")}
                style={{ fontSize: 12, padding: "3px 8px" }}
              >
                <PencilIcon size={12} style={{ marginRight: 4, verticalAlign: -1 }} /> Edit formula
              </button>
            </div>
            <div className="calc-formula-box">
              <FormulaDisplay formula={row.formula || row.note || ""} />
            </div>
          </div>

          {elementCount ? (
            <div className="calc-section">
              <div className="calc-label">Roll-up</div>
              <div className="rollup-card">
                <div className="rollup-count">
                  <strong>{elementCount}</strong>
                  <span className="muted"> {String(inputs.elementType || "elements")}</span>
                </div>
                {rolled != null ? (
                  <div className="rollup-total">
                    <ArrowRightIcon size={12} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }} /> <strong>{fmt(rolled, row.digits)}</strong>{" "}
                    <span className="muted">{row.unit}</span>
                  </div>
                ) : null}
                {Array.isArray(inputs.sheets) && inputs.sheets.length ? (
                  <div className="rollup-sheets muted">
                    on sheets: {(inputs.sheets as string[]).join(", ")}
                  </div>
                ) : null}
                {typeof inputs.perElementFormula === "string" && inputs.perElementFormula ? (
                  <div className="rollup-formula">
                    <span className="calc-label-inline">Per element:</span>{" "}
                    <FormulaDisplay formula={inputs.perElementFormula} />
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Source files with highlighted role */}
          {(row.sources || []).length > 0 ? (
            <div className="calc-section">
              <div className="calc-label">Source files</div>
              <ul className="source-list-rich">
                {(row.sources || []).map((source, index) => (
                  <li key={`${source.role}-${index}`} className="source-rich-item">
                    <span className="source-icon"><SourceIcon role={source.role} /></span>
                    <div className="source-text">
                      <strong>{source.role.replace(/_/g, " ")}</strong>
                      {source.file ? <code className="source-file-name">{source.file}</code> : null}
                      {source.detail ? <span className="muted">{source.detail}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      {/* ADJUST TAB */}
      {activeTab === "adjust" && (
        <div className="detail-pane">
          {row.adjusted ? (
            <div className="adjust-notice">
              <span className="pill adjusted">Adjusted</span>
              <span className="muted">
                {row.adjustmentReason
                  ? `"${row.adjustmentReason}"`
                  : "This line has been manually adjusted."}
              </span>
            </div>
          ) : null}
          <form className="bill-adjust-form" onSubmit={save}>
            <label className="adj-field">
              <span>
                Measured quantity ({row.unit})
              </span>
              <input
                type="number"
                step="any"
                value={editOurs}
                onChange={(e) => setEditOurs(e.target.value)}
                required
                className="adj-input"
              />
            </label>
            <label className="adj-field">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span>Calculation formula / note</span>
                {evalResult !== null && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setEditOurs(String(evalResult))}
                    style={{ fontSize: 11, padding: "2px 6px", color: "var(--purple-deep)", background: "rgba(43, 2, 102, 0.08)" }}
                    title="Apply calculated value into Measured quantity"
                  >
                    <ZapIcon size={11} style={{ marginRight: 4, verticalAlign: -1 }} /> Evaluates to {evalResult} (Apply)
                  </button>
                )}
              </div>
              <textarea
                rows={3}
                value={editFormula}
                onChange={(e) => setEditFormula(e.target.value)}
                placeholder="e.g. 15.4 * 2.1 * 0.45 or engineering note"
                className="adj-textarea"
              />
            </label>
            <label className="adj-field">
              <span>Reason for adjustment</span>
              <input
                type="text"
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="QS review note"
                className="adj-input"
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save adjustment"}
            </button>
          </form>
        </div>
      )}
    </aside>
  );
}
