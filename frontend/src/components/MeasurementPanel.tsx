import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { CompareRow, Measurement, ReviewItem, Sheet } from "../types";
import { api } from "../api/client";
import { fmt } from "../lib/format";
import { ExternalLinkIcon } from "./Icons";

type Props = {
  projectId: string;
  sheet: Sheet;
  measurements: Measurement[];
  reviewQueue: ReviewItem[];
  selectedShapeId: string | null;
  measurementId: string | null;
  onSelectMeasurement: (id: string | null) => void;
  onSaved: () => void;
  comparison?: CompareRow[];
};

function sourceLabel(source: { role: string; sheet?: string; detail?: string }) {
  const parts = [source.role.replace(/_/g, " ")];
  if (source.sheet) parts.push(`sheet ${source.sheet}`);
  if (source.detail) parts.push(source.detail);
  return parts.join(" · ");
}

export function MeasurementPanel({
  projectId,
  sheet,
  measurements,
  reviewQueue,
  selectedShapeId,
  measurementId,
  onSelectMeasurement,
  onSaved,
  comparison = [],
}: Props) {
  const record = useMemo(
    () => (measurementId ? measurements.find((m) => m.id === measurementId) : undefined),
    [measurementId, measurements],
  );

  const linkedRow = useMemo(() => {
    if (!comparison.length || !record) return null;
    for (const row of comparison) {
      if (
        row.placements?.some(
          (p) => p.measurementId === record.id || (selectedShapeId && p.shapeId === selectedShapeId),
        )
      ) {
        return row;
      }
    }
    const tagLower = (record.tag || "").toLowerCase();
    const typeLower = (record.elementType || "").toLowerCase();
    return (
      comparison.find((row) => {
        const l = row.label.toLowerCase();
        const s = row.section.toLowerCase();
        if (typeLower && (l.includes(typeLower) || s.includes(typeLower))) return true;
        if (tagLower && l.includes(tagLower)) return true;
        return false;
      }) || null
    );
  }, [comparison, record, selectedShapeId]);

  const [editM3, setEditM3] = useState("");
  const [editM2, setEditM2] = useState("");
  const [editKg, setEditKg] = useState("");
  const [editFormula, setEditFormula] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editReason, setEditReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [manualTag, setManualTag] = useState("");
  const [manualM3, setManualM3] = useState("");
  const [manualReason, setManualReason] = useState("");

  useEffect(() => {
    if (!record) return;
    const q = record.quantities || {};
    setEditM3(q.concrete_m3 != null ? String(q.concrete_m3) : "");
    setEditM2(q.formwork_m2 != null ? String(q.formwork_m2) : "");
    setEditKg(q.rebar_kg != null ? String(q.rebar_kg) : "");
    setEditFormula(record.formula || "");
    setEditNote(record.note || "");
    setEditReason(record.adjustmentReason || "");
  }, [record]);

  const sheetReview = reviewQueue.filter((item) => !item.sheet || item.sheet === sheet.id);

  async function saveAdjustment(e: FormEvent) {
    e.preventDefault();
    if (!record) return;
    setBusy(true);
    try {
      await api.adjustMeasurement(projectId, record.id, {
        quantities: {
          ...(editM3 !== "" ? { concrete_m3: Number(editM3) } : {}),
          ...(editM2 !== "" ? { formwork_m2: Number(editM2) } : {}),
          ...(editKg !== "" ? { rebar_kg: Number(editKg) } : {}),
        },
        formula: editFormula,
        note: editNote,
        adjustment_reason: editReason || "Manual adjustment in takeoff UI",
      });
      onSaved();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not save adjustment.");
    } finally {
      setBusy(false);
    }
  }

  async function saveManual(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.addManualMeasurement(projectId, {
        tag: manualTag || "MANUAL",
        sheet: sheet.id,
        element_type: "other",
        reason: manualReason,
        formula: manualReason ? `manual: ${manualReason}` : "manual entry",
        quantities: { concrete_m3: Number(manualM3) || 0 },
      });
      setManualTag("");
      setManualM3("");
      setManualReason("");
      onSaved();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not save manual entry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="measure-block">
      <div className="measure-head">
        <h3>Measurement</h3>
        <p className="hint">Formula, inputs, and source drawings for the selected outline.</p>
      </div>

      {!record ? (
        <p className="hint measure-empty">
          {selectedShapeId
            ? "Per-outline records appear after Foundations/Structure. For bill-line calculations (formulas, drawing sources, measured adjustments), open the Bill tab and select a comparison line."
            : "Select an outline on the sheet."}
        </p>
      ) : (
        <div className="measure-detail">
          <p className="measure-kicker">
            <strong>{record.tag}</strong> · {record.elementType} ·{" "}
            <span className={`status-pill ${record.status}`}>{record.status}</span>
          </p>

          {linkedRow ? (
            <div
              style={{
                padding: "8px 12px",
                background: "var(--purple-soft)",
                borderRadius: 8,
                marginBottom: 12,
                border: "1px solid var(--line)",
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: "var(--purple-deep)",
                  letterSpacing: "0.5px",
                }}
              >
                Linked Bill Comparison Line
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginTop: 2 }}>
                {linkedRow.label}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", margin: "2px 0 6px" }}>
                {linkedRow.section} · Bill: {linkedRow.bill ?? "—"} {linkedRow.unit} · Ours: {linkedRow.ours ?? "—"} {linkedRow.unit}
              </div>
              <Link
                to={`/p/${encodeURIComponent(projectId)}/bill`}
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11, width: "100%", justifyContent: "center" }}
              >
                Inspect in Bill Comparison <ExternalLinkIcon size={11} style={{ marginLeft: 4 }} />
              </Link>
            </div>
          ) : null}

          <dl className="measure-dl">
            <div>
              <dt>Formula</dt>
              <dd>{record.formula || ""}</dd>
            </div>
            <div>
              <dt>Quantities</dt>
              <dd>
                m³ {fmt(record.quantities.concrete_m3 as number | null, 3)} · m²{" "}
                {fmt(record.quantities.formwork_m2 as number | null, 2)} · kg{" "}
                {fmt(record.quantities.rebar_kg as number | null, 1)}
              </dd>
            </div>
            <div>
              <dt>Inputs</dt>
              <dd className="measure-json">{JSON.stringify(record.inputs || {}, null, 0)}</dd>
            </div>
            <div>
              <dt>Sources</dt>
              <dd>
                <ul className="source-list">
                  {(record.sources || []).map((s, i) => (
                    <li key={i}>{sourceLabel(s)}</li>
                  ))}
                  {!record.sources?.length ? "None" : null}
                </ul>
                <p className="hint source-files">
                  Files: <code>work/{projectId}/out/{record.sheet}.json</code>
                  {record.sheet ? (
                    <>
                      {" "}
                      · <code>work/{projectId}/pdf/{record.sheet}.pdf</code>
                    </>
                  ) : null}
                  {" · "}
                  <code>work/{projectId}/out/measurements.json</code>
                </p>
              </dd>
            </div>
            {record.note ? (
              <div>
                <dt>Engine note</dt>
                <dd>{record.note}</dd>
              </div>
            ) : null}
          </dl>

          <form className="measure-form" onSubmit={saveAdjustment}>
            <p className="form-kicker">Manual adjustment</p>
            <div className="measure-fields">
              <label>
                <span>Concrete m³</span>
                <input type="number" step="any" value={editM3} onChange={(e) => setEditM3(e.target.value)} />
              </label>
              <label>
                <span>Formwork m²</span>
                <input type="number" step="any" value={editM2} onChange={(e) => setEditM2(e.target.value)} />
              </label>
              <label>
                <span>Rebar kg</span>
                <input type="number" step="any" value={editKg} onChange={(e) => setEditKg(e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>Formula (documented)</span>
              <input type="text" value={editFormula} onChange={(e) => setEditFormula(e.target.value)} />
            </label>
            <label className="field">
              <span>Note</span>
              <input type="text" value={editNote} onChange={(e) => setEditNote(e.target.value)} />
            </label>
            <label className="field">
              <span>Reason for change</span>
              <input
                type="text"
                placeholder="e.g. matched site measure"
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
              />
            </label>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              Save adjustment
            </button>
          </form>
        </div>
      )}

      {sheetReview.length ? (
        <div className="measure-review">
          <p className="form-kicker">Review on this sheet</p>
          <ul className="review-list">
            {sheetReview.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`review-item ${item.severity}`}
                  onClick={() => onSelectMeasurement(item.measurementId || null)}
                >
                  <strong>{item.kind}</strong>
                  {item.tag ? ` · ${item.tag}` : ""}
                  <span>{item.message}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form className="measure-form measure-manual" onSubmit={saveManual}>
        <p className="form-kicker">New manual quantity</p>
        <label className="field">
          <span>Tag</span>
          <input value={manualTag} onChange={(e) => setManualTag(e.target.value)} placeholder="e.g. F12" />
        </label>
        <label className="field">
          <span>Concrete m³</span>
          <input type="number" step="any" value={manualM3} onChange={(e) => setManualM3(e.target.value)} />
        </label>
        <label className="field">
          <span>Reason</span>
          <input value={manualReason} onChange={(e) => setManualReason(e.target.value)} />
        </label>
        <button className="btn btn-ghost" type="submit" disabled={busy}>
          Add manual entry
        </button>
      </form>
    </div>
  );
}
