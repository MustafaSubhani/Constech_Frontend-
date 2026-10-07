import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, ChevronDown, ChevronRight, EyeOff, Eye, FileText, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { api } from "../../api/client";
import type { BillPlacement, CompareRow, Project, Proposal } from "../../types";
import { ProposalCard } from "../assistant/ProposalCard";
import { evaluate } from "../../lib/formula";
import { BAND_LABEL, bandOf, fmt, pctOf, signed } from "../../lib/format";
import { elementLabel } from "../../lib/kinds";
import { FormulaEditor, MathView } from "../formula/FormulaEditor";
import { EvidenceList } from "../workspace/EvidenceList";

type Props = {
  project: Project;
  row: CompareRow;
  suggestions?: Proposal[];
  onClose: () => void;
  onSaveOverride: (expression: string, variables: Record<string, number>, reason: string) => Promise<void>;
  onResetOverride: () => Promise<void>;
  onToggleHidden: () => Promise<void>;
  onEditCustom: () => void;
  onDeleteCustom: () => Promise<void>;
};

function defaultSpec(row: CompareRow) {
  if (row.expression) return { expression: row.expression, variables: row.variables ?? {} };
  const engine = row.engineOurs ?? row.ours ?? 0;
  const vars: Record<string, number> = { engine };
  if (row.measureDelta) vars.engine = row.ours ?? engine;
  return { expression: "engine", variables: vars };
}

export function BillInspector({ project, row, suggestions = [], onClose, onSaveOverride, onResetOverride, onToggleHidden, onEditCustom, onDeleteCustom }: Props) {
  const [tab, setTab] = useState<"sources" | "calc">((row.placements?.length ?? 0) > 0 ? "sources" : "calc");
  const [open, setOpen] = useState<string | null>(null);
  const [spec, setSpec] = useState(() => defaultSpec(row));
  const [reason, setReason] = useState(row.adjustmentReason ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTab((row.placements?.length ?? 0) > 0 ? "sources" : "calc");
    setOpen(null);
    setSpec(defaultSpec(row));
    setReason(row.adjustmentReason ?? "");
  }, [row.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const band = bandOf(row);
  const pct = pctOf(row);
  const diff = row.bill != null && row.ours != null ? row.ours - row.bill : null;
  const result = evaluate(spec.expression, spec.variables);
  const placements = row.placements ?? [];
  const bySheet = useMemo(() => {
    const groups = new Map<string, BillPlacement[]>();
    placements.forEach((p) => groups.set(p.sheetId || "Unplaced", [...(groups.get(p.sheetId || "Unplaced") ?? []), p]));
    return [...groups.entries()];
  }, [placements]);
  const inputs = row.inputs ?? {};
  const base = `/p/${encodeURIComponent(project.id)}`;

  async function save() {
    if (!result.ok) return;
    setBusy(true);
    try {
      await onSaveOverride(spec.expression, spec.variables, reason.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="bill-inspector" aria-label="Line details">
      <header className="insp-head">
        <div className="grow">
          <span className="eyebrow">{row.section}</span>
          <h2>{row.label}</h2>
          <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <span className={`chip band-chip-${band}`}>{BAND_LABEL[band]}</span>
            {row.lineOverride ? <span className="chip chip-info">Overridden</span> : null}
            {row.measureDelta ? <span className="chip chip-info">Elements edited</span> : null}
            {row.custom ? <span className="chip chip-brand">Added by hand</span> : null}
            {row.hidden ? <span className="chip chip-outline">Hidden</span> : null}
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </header>

      <dl className="line-stats">
        <div>
          <dt>Bill</dt>
          <dd className="tnum">
            {row.bill != null ? fmt(row.bill, row.digits) : "None"} <span className="unit">{row.unit}</span>
          </dd>
        </div>
        <div>
          <dt>Measured</dt>
          <dd className="tnum">
            {fmt(row.ours, row.digits)} <span className="unit">{row.unit}</span>
          </dd>
        </div>
        <div>
          <dt>Difference</dt>
          <dd className={`tnum band-${band}`}>{signed(diff, row.digits) || "None"}</dd>
        </div>
        <div>
          <dt>Variance</dt>
          <dd className={`tnum band-${band}`}>{pct != null ? `${signed(pct, 1)}%` : "None"}</dd>
        </div>
      </dl>

      {suggestions.length ? (
        <section className="insp-section suggestions">
          <h3 className="section-title">Suggested changes</h3>
          {suggestions.map((p) => (
            <ProposalCard key={p.id} proposal={p} projectId={project.id} compact />
          ))}
        </section>
      ) : null}

      <div className="tabs" role="tablist">
        <button type="button" role="tab" className="tab" aria-selected={tab === "sources"} onClick={() => setTab("sources")}>
          Sources <span className="count">{placements.length || ""}</span>
        </button>
        <button type="button" role="tab" className="tab" aria-selected={tab === "calc"} onClick={() => setTab("calc")}>
          Calculation
        </button>
      </div>

      <div className="inspector-scroll">
        {tab === "sources" ? (
          <>
            {placements.length ? (
              <section className="insp-section">
                <p className="muted small" style={{ marginBottom: 10 }}>
                  {placements.length} measured element{placements.length === 1 ? "" : "s"} roll up into this line. Open one to see where its
                  dimensions were read.
                </p>
                {bySheet.map(([sheetId, items]) => {
                  const sheet = project.sheets.find((s) => s.id === sheetId);
                  return (
                    <div key={sheetId} className="placement-group">
                      <div className="placement-sheet">
                        <FileText size={13} />
                        <span className="truncate">{sheet ? `${sheet.code} · ${sheet.title}` : sheetId}</span>
                        <span className="faint">{items.length}</span>
                      </div>
                      {items.map((p) => {
                        const key = `${p.measurementId}-${p.shapeId}`;
                        const shape = sheet?.shapes.find((s) => s.id === p.shapeId);
                        const expanded = open === key;
                        return (
                          <div key={key} className={`placement${expanded ? " open" : ""}`}>
                            <button type="button" className="placement-row" onClick={() => setOpen(expanded ? null : key)} aria-expanded={expanded}>
                              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              <span className="placement-tag">{p.tag || elementLabel(p.kind ?? "")}</span>
                              <span className="placement-dims muted">
                                {[p.widthMm && p.heightMm ? `${p.widthMm}×${p.heightMm}` : "", p.depthMm ? `d ${p.depthMm}` : "", p.areaM2 ? `${p.areaM2} m²` : ""]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                              <span className="placement-qty tnum">{fmt(p.quantity, row.digits)}</span>
                            </button>
                            {expanded ? (
                              <div className="placement-body">
                                {shape && sheet ? (
                                  <EvidenceList evidence={shape.evidence ?? []} sheet={sheet} imageUrl={api.sheetImageUrl(project.id, sheet.id, sheet.image)} limit={3} />
                                ) : (
                                  <p className="muted small">
                                    Measured from {p.sourceFile || "the engine"}; no drawn position is linked to this record.
                                  </p>
                                )}
                                {shape ? (
                                  <Link
                                    className="btn btn-ghost btn-sm"
                                    to={`${base}?sheet=${encodeURIComponent(p.sheetId)}&shape=${encodeURIComponent(p.shapeId!)}&line=${encodeURIComponent(row.id)}`}
                                  >
                                    Open on the drawing <ArrowUpRight size={13} />
                                  </Link>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                {placements.some((p) => p.shapeId) ? (
                  <Link className="btn btn-secondary btn-sm btn-block" to={`${base}?sheet=${encodeURIComponent(placements.find((p) => p.shapeId)!.sheetId)}&line=${encodeURIComponent(row.id)}`}>
                    Highlight all on the drawings
                  </Link>
                ) : null}
              </section>
            ) : (
              <section className="insp-section">
                <p className="muted small">
                  {row.custom
                    ? "This line was added by hand."
                    : "This line is computed by an engine rule across several sheets rather than from individual outlines."}
                </p>
              </section>
            )}
            {(row.sources ?? []).length ? (
              <section className="insp-section">
                <h3 className="section-title">References</h3>
                <ul className="source-list">
                  {(row.sources ?? []).map((s, i) => (
                    <li key={i}>
                      <span className="src-role">{s.role.replace(/_/g, " ")}</span>
                      <span className="truncate" title={s.file}>{s.file || s.detail}</span>
                      {s.file && s.detail ? <span className="muted small">{s.detail}</span> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
          <>
            {!row.custom ? (
              <section className="insp-section">
                <h3 className="section-title">Method</h3>
                <p className="basis">{row.note || row.formula || "No description recorded."}</p>
                {typeof inputs.elementCount === "number" ? (
                  <div className="rollup">
                    <span>
                      <strong className="tnum">{inputs.elementCount as number}</strong> {elementLabel(String(inputs.elementType ?? "element")).toLowerCase()} records
                    </span>
                    {typeof inputs.perElementFormula === "string" && inputs.perElementFormula ? (
                      <span className="muted small">each: {inputs.perElementFormula as string}</span>
                    ) : null}
                  </div>
                ) : null}
                {row.engineOurs != null ? (
                  <p className="small muted">
                    Engine total {fmt(row.engineOurs, row.digits)} {row.unit}
                  </p>
                ) : null}
              </section>
            ) : null}

            {row.measureDelta ? (
              <section className="insp-section">
                <h3 className="section-title">Element adjustments</h3>
                <ul className="change-list">
                  {row.measureDelta.changes.map((c) => (
                    <li key={c.measurementId}>
                      <span className="grow">{c.tag || c.measurementId}</span>
                      <span className="tnum muted">{fmt(c.before, row.digits)}</span>
                      <ChevronRight size={12} />
                      <span className="tnum">{c.status === "excluded" ? "removed" : fmt(c.after, row.digits)}</span>
                    </li>
                  ))}
                </ul>
                <p className="small muted">Net {signed(row.measureDelta.delta, row.digits)} {row.unit} on the engine total.</p>
              </section>
            ) : null}

            {row.custom ? (
              <section className="insp-section">
                <h3 className="section-title">Formula</h3>
                {row.expression ? <MathView expression={row.expression} /> : <p className="muted small">Entered as a value.</p>}
                <div className="row" style={{ marginTop: 12 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={onEditCustom}>
                    <Pencil size={13} /> Edit line
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={onDeleteCustom}>
                    <Trash2 size={13} /> Delete line
                  </button>
                </div>
              </section>
            ) : (
              <section className="insp-section">
                <h3 className="section-title">Override</h3>
                <p className="muted small" style={{ marginBottom: 10 }}>
                  Applies to the whole line. Element edits in Drawings stay traceable and are preferred.
                </p>
                <FormulaEditor
                  key={row.id}
                  label="Measured"
                  unit={row.unit}
                  digits={row.digits}
                  expression={spec.expression}
                  variables={spec.variables}
                  engineValue={row.engineOurs ?? null}
                  onChange={(expression, variables) => setSpec({ expression, variables })}
                />
                <input className="input input-sm" style={{ marginTop: 10 }} placeholder="Reason (kept in the audit trail)" value={reason} onChange={(e) => setReason(e.target.value)} />
                <div className="row" style={{ marginTop: 10, justifyContent: "flex-end" }}>
                  {row.lineOverride ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={onResetOverride}>
                      <RotateCcw size={13} /> Remove override
                    </button>
                  ) : null}
                  <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy || !result.ok}>
                    {busy ? <span className="spinner" /> : null} Save override
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <footer className="insp-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onToggleHidden}>
          {row.hidden ? <Eye size={14} /> : <EyeOff size={14} />} {row.hidden ? "Show line" : "Hide line"}
        </button>
        <span className="faint small">
          <kbd>↑</kbd> <kbd>↓</kbd> to move
        </span>
      </footer>
    </aside>
  );
}
