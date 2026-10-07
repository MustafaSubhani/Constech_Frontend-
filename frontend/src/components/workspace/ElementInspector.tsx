import { Link } from "react-router-dom";
import { ArrowUpRight, PenLine, RotateCcw, Trash2, X } from "lucide-react";
import type { ExpressionSpec, Measurement, Project, Shape, Sheet } from "../../types";
import { KIND_META, STATUS_META, elementLabel } from "../../lib/kinds";
import { QUANTITY_FIELDS, fmt, numberOrNull } from "../../lib/format";
import { EvidenceList } from "./EvidenceList";
import { QuantityRow } from "./QuantityRow";

type Props = {
  project: Project;
  sheet: Sheet;
  shape: Shape;
  record: Measurement | undefined;
  imageUrl: string;
  editing: boolean;
  onClose: () => void;
  onEditOutline: () => void;
  onResetOutline: () => void;
  onRemove: () => void;
  onSaveQuantity: (field: string, spec: ExpressionSpec, reason: string) => Promise<void>;
  onFocusBox: (box: [number, number, number, number]) => void;
};

export function ElementInspector({
  project,
  sheet,
  shape,
  record,
  imageUrl,
  editing,
  onClose,
  onEditOutline,
  onResetOutline,
  onRemove,
  onSaveQuantity,
  onFocusBox,
}: Props) {
  const meta = KIND_META[shape.kind] ?? KIND_META.missed!;
  const status = record ? STATUS_META[record.status] ?? { label: record.status, tone: "neutral" } : null;
  const lines = record ? project.comparison.filter((r) => !r.hidden && r.placements?.some((p) => p.measurementId === record.id)) : [];
  const fields = record
    ? QUANTITY_FIELDS.filter((f) => numberOrNull(record.quantities[f.key]) != null || numberOrNull(record.engineQuantities?.[f.key]) != null)
    : [];

  return (
    <div className="inspector-scroll" key={shape.id}>
      <header className="insp-head">
        <span className="kind-swatch" style={{ background: meta.color }} />
        <div className="grow">
          <h2 className="truncate">{record?.tag || shape.label}</h2>
          <p className="muted small">
            {record ? elementLabel(record.elementType) : meta.single} on {sheet.code}
          </p>
        </div>
        {status ? <span className={`chip chip-${status.tone === "neutral" ? "outline" : status.tone}`}>{status.label}</span> : null}
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </header>

      {record?.note ? <div className="insp-note">{record.note}</div> : null}

      <section className="insp-section">
        <h3 className="section-title">Quantities</h3>
        {!record ? (
          <p className="muted small">This outline has no measurement record. It is drawn for reference only.</p>
        ) : fields.length ? (
          fields.map((f) => (
            <QuantityRow
              key={`${record.id}-${f.key}`}
              field={f}
              value={numberOrNull(record.quantities[f.key])}
              engineValue={numberOrNull(record.engineQuantities?.[f.key] ?? (record.manual ? null : record.quantities[f.key]))}
              stored={record.expressions?.[f.key]}
              inputs={record.inputs}
              onSave={(spec, reason) => onSaveQuantity(f.key, spec, reason)}
            />
          ))
        ) : (
          <p className="muted small">No quantities were measured for this element.</p>
        )}
        {record?.adjustmentReason ? <p className="small muted">Last change: {record.adjustmentReason}</p> : null}
      </section>

      <section className="insp-section">
        <h3 className="section-title">Source</h3>
        <EvidenceList evidence={shape.evidence ?? []} sheet={sheet} imageUrl={imageUrl} onFocus={onFocusBox} />
        {record?.sources?.length ? (
          <ul className="source-list">
            {record.sources.map((s, i) => (
              <li key={i}>
                <span className="src-role">{s.role.replace(/_/g, " ")}</span>
                <span className="muted">{[s.sheet, s.detail].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {lines.length ? (
        <section className="insp-section">
          <h3 className="section-title">Bill lines</h3>
          <div className="line-links">
            {lines.map((line) => (
              <Link key={line.id} className="line-link" to={`/p/${encodeURIComponent(project.id)}/bill?line=${encodeURIComponent(line.id)}`}>
                <span className="truncate">{line.label}</span>
                <span className="muted tnum">
                  {fmt(line.ours, line.digits)} {line.unit}
                </span>
                <ArrowUpRight size={13} />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="insp-section insp-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onEditOutline} disabled={editing}>
          <PenLine size={14} /> Adjust outline <kbd>E</kbd>
        </button>
        {shape.edited ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onResetOutline}>
            <RotateCcw size={14} /> Reset outline
          </button>
        ) : null}
        <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>
          <Trash2 size={14} /> {shape.manual ? "Delete element" : "Remove from takeoff"}
        </button>
      </section>
    </div>
  );
}
