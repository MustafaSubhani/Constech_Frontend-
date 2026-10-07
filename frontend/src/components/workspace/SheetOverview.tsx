import { AlertTriangle, CheckCircle2, Info, RotateCcw, SquarePlus } from "lucide-react";
import type { Measurement, Project, Sheet } from "../../types";
import { KIND_META, KIND_ORDER } from "../../lib/kinds";

type Props = {
  project: Project;
  sheet: Sheet;
  onSelectMeasurement: (measurementId: string) => void;
  onRestore: (shapeId: string, measurementId?: string) => void;
  onDraw: () => void;
};

export function SheetOverview({ project, sheet, onSelectMeasurement, onRestore, onDraw }: Props) {
  const visible = sheet.shapes.filter((s) => !s.hidden);
  const removed = sheet.shapes.filter((s) => s.hidden);
  const byKind = KIND_ORDER.map((k) => ({ kind: k, count: visible.filter((s) => s.kind === k).length })).filter((k) => k.count);
  const review = project.reviewQueue.filter((r) => r.sheet === sheet.id);
  const records = new Map<string, Measurement>(project.measurements.map((m) => [m.id, m]));
  const edited = visible.filter((s) => s.edited || s.manual || (s.measurementId && records.get(s.measurementId)?.status === "adjusted")).length;

  return (
    <div className="inspector-scroll">
      <header className="insp-head">
        <div className="grow">
          <h2>{sheet.code}</h2>
          <p className="muted small">{sheet.title}</p>
        </div>
      </header>

      <section className="insp-section">
        <dl className="kv">
          <dt>Drawing</dt>
          <dd className="truncate" title={sheet.file}>{sheet.file || "No DWG"}</dd>
          <dt>Sheet</dt>
          <dd className="truncate" title={sheet.pdf}>{sheet.pdf || "No PDF"}</dd>
          <dt>Overlay</dt>
          <dd>
            {sheet.fitOk ? (
              <span className="row" style={{ gap: 6, color: "var(--ok)" }}>
                <CheckCircle2 size={13} /> Aligned with the PDF
              </span>
            ) : (
              <span className="row" style={{ gap: 6, color: "var(--warn)" }}>
                <AlertTriangle size={13} /> Alignment not verified
              </span>
            )}
          </dd>
        </dl>
      </section>

      <section className="insp-section">
        <h3 className="section-title">Elements</h3>
        <div className="kind-counts">
          {byKind.map(({ kind, count }) => (
            <div key={kind} className="kind-count">
              <span className="kind-swatch" style={{ background: KIND_META[kind]?.color }} />
              <span className="grow">{KIND_META[kind]?.name ?? kind}</span>
              <span className="tnum">{count}</span>
            </div>
          ))}
          {!byKind.length ? <p className="muted small">No measured outlines on this sheet.</p> : null}
        </div>
        {edited ? <p className="small muted" style={{ marginTop: 8 }}>{edited} changed by hand</p> : null}
      </section>

      {review.length ? (
        <section className="insp-section">
          <h3 className="section-title">Review · {review.length}</h3>
          <ul className="review-list">
            {review.slice(0, 30).map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`review-item sev-${item.severity}`}
                  onClick={() => item.measurementId && onSelectMeasurement(item.measurementId)}
                  disabled={!item.measurementId}
                >
                  {item.severity === "error" ? <AlertTriangle size={14} /> : <Info size={14} />}
                  <span className="grow">
                    <strong>{item.tag || item.kind.replace(/_/g, " ")}</strong> {item.message}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {removed.length ? (
        <section className="insp-section">
          <h3 className="section-title">Removed · {removed.length}</h3>
          <ul className="review-list">
            {removed.map((s) => (
              <li key={s.id} className="row">
                <span className="grow truncate">{s.label}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRestore(s.id, s.measurementId)}>
                  <RotateCcw size={13} /> Restore
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="insp-section">
        <div className="hint-card">
          <SquarePlus size={16} />
          <div className="grow">
            <strong>Add an element</strong>
            <p>Draw around it on the sheet and enter its dimensions.</p>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onDraw}>
            Draw <kbd>B</kbd>
          </button>
        </div>
      </section>
    </div>
  );
}
