import { useMemo, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Info, Play, RotateCcw, Search, SquarePlus } from "lucide-react";
import type { Measurement, Project, Shape, Sheet } from "../../types";
import { KIND_META, KIND_ORDER } from "../../lib/kinds";

type Filter = "all" | "todo" | "flagged" | "changed";

type Props = {
  project: Project;
  sheet: Sheet;
  ordered: Shape[];
  reviewed: Set<string>;
  onSelectShape: (shapeId: string) => void;
  onSelectMeasurement: (measurementId: string) => void;
  onMarkAll: (reviewed: boolean) => void;
  onRestore: (shapeId: string, measurementId?: string) => void;
  onDraw: () => void;
  onStart: () => void;
};

/** What is on the sheet and how far the review has got, with every outline in reading order. */
export function SheetOverview({ project, sheet, ordered, reviewed, onSelectShape, onSelectMeasurement, onMarkAll, onRestore, onDraw, onStart }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const visible = sheet.shapes.filter((s) => !s.hidden);
  const removed = sheet.shapes.filter((s) => s.hidden);
  const review = project.reviewQueue.filter((r) => r.sheet === sheet.id);
  const records = useMemo(() => new Map<string, Measurement>(project.measurements.map((m) => [m.id, m])), [project.measurements]);
  const flaggedIds = useMemo(() => new Set(review.map((r) => r.measurementId).filter(Boolean) as string[]), [review]);
  const changed = (s: Shape) => Boolean(s.edited || s.manual || (s.measurementId && records.get(s.measurementId)?.status === "adjusted"));
  const flagged = (s: Shape) => s.kind === "missed" || Boolean(s.measurementId && (flaggedIds.has(s.measurementId) || records.get(s.measurementId)?.status === "review"));
  const done = visible.filter((s) => reviewed.has(s.id)).length;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ordered.filter((s) => {
      if (filter === "todo" && reviewed.has(s.id)) return false;
      if (filter === "flagged" && !flagged(s)) return false;
      if (filter === "changed" && !changed(s)) return false;
      if (!q) return true;
      const rec = s.measurementId ? records.get(s.measurementId) : undefined;
      return `${s.label} ${rec?.tag ?? ""} ${KIND_META[s.kind]?.name ?? s.kind}`.toLowerCase().includes(q);
    });
  }, [ordered, filter, query, reviewed, records]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts: Record<Filter, number> = {
    all: ordered.length,
    todo: ordered.filter((s) => !reviewed.has(s.id)).length,
    flagged: ordered.filter(flagged).length,
    changed: ordered.filter(changed).length,
  };

  return (
    <div className="inspector-scroll">
      <header className="insp-head">
        <div className="grow">
          <h2>{sheet.code}</h2>
          <p className="muted small">{sheet.title}</p>
        </div>
      </header>

      <section className="insp-section">
        <div className="review-progress">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="section-title">Review</span>
            <span className="tnum small muted">
              {done} of {visible.length} checked
            </span>
          </div>
          <div className="progress">
            <span style={{ width: `${visible.length ? (done / visible.length) * 100 : 0}%` }} />
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={onStart} disabled={!ordered.length}>
              <Play size={13} /> {done ? "Continue review" : "Start review"} <kbd className="kbd-on-brand">J</kbd>
            </button>
            {done < visible.length ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onMarkAll(true)} disabled={!visible.length}>
                <Check size={13} /> Mark all
              </button>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onMarkAll(false)} disabled={!done}>
                <RotateCcw size={13} /> Clear marks
              </button>
            )}
          </div>
        </div>
        <dl className="kv">
          <dt>Drawing</dt>
          <dd className="truncate" title={sheet.file}>{sheet.file || "No DWG"}</dd>
          <dt>Sheet</dt>
          <dd className="truncate" title={sheet.pdf}>{sheet.pdf || "No PDF"}</dd>
          <dt>Alignment</dt>
          <dd>
            {sheet.fitOk ? (
              <span className="row" style={{ gap: 6, color: "var(--ok)" }}>
                <CheckCircle2 size={13} /> Lined up with the PDF
              </span>
            ) : (
              <span className="row" style={{ gap: 6, color: "var(--warn)" }}>
                <AlertTriangle size={13} /> Not verified
              </span>
            )}
          </dd>
        </dl>
      </section>

      <section className="insp-section">
        <div className="segmented segmented-full">
          {(
            [
              ["all", "All"],
              ["todo", "To do"],
              ["flagged", "Flagged"],
              ["changed", "Changed"],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label} <span className="count">{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="input-group">
          <Search size={14} />
          <input className="input input-sm" placeholder="Find a tag or element" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <ul className="element-list">
          {rows.slice(0, 300).map((s) => {
            const rec = s.measurementId ? records.get(s.measurementId) : undefined;
            const qty = rec?.quantities?.concrete_m3 ?? rec?.quantities?.area_m2;
            return (
              <li key={s.id}>
                <button type="button" className={`element-row${reviewed.has(s.id) ? " done" : ""}`} onClick={() => onSelectShape(s.id)}>
                  <span className="kind-swatch" style={{ background: KIND_META[s.kind]?.color }} />
                  <span className="grow truncate">
                    <strong>{rec?.tag || s.label.split(/\s{2,}/)[0]}</strong>
                    <span className="muted"> {KIND_META[s.kind]?.single ?? s.kind}</span>
                  </span>
                  {flagged(s) ? <AlertTriangle size={13} className="el-flag" /> : null}
                  {changed(s) ? <span className="mini-tag info">edited</span> : null}
                  {qty != null && qty !== "" ? <span className="tnum small muted">{Number(qty).toFixed(2)}</span> : null}
                  <span className="el-check" aria-label={reviewed.has(s.id) ? "Reviewed" : "Not reviewed"}>
                    {reviewed.has(s.id) ? <Check size={12} strokeWidth={3} /> : null}
                  </span>
                </button>
              </li>
            );
          })}
          {!rows.length ? <li className="muted small element-empty">{ordered.length ? "Nothing matches." : "No measured outlines on this sheet."}</li> : null}
        </ul>
        <div className="kind-counts">
          {KIND_ORDER.map((k) => ({ k, n: visible.filter((s) => s.kind === k).length }))
            .filter(({ n }) => n)
            .map(({ k, n }) => (
              <span key={k} className="kind-count">
                <span className="kind-swatch" style={{ background: KIND_META[k]?.color }} />
                {KIND_META[k]?.name ?? k} <span className="tnum faint">{n}</span>
              </span>
            ))}
        </div>
      </section>

      {review.length ? (
        <section className="insp-section">
          <h3 className="section-title">Engine notes · {review.length}</h3>
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
