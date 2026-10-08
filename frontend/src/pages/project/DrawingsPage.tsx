import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Eye, EyeOff, Layers, MousePointer2, PanelRight, SquarePlus, X } from "lucide-react";
import { api } from "../../api/client";
import type { ExpressionSpec, Shape, Sheet } from "../../types";
import { KIND_META, KIND_ORDER } from "../../lib/kinds";
import { useProject } from "./ProjectContext";
import { useToast } from "../../components/ui/Toast";
import { useConfirm } from "../../components/ui/Confirm";
import { SheetCanvas, type CanvasFocus } from "../../components/workspace/SheetCanvas";
import { ElementInspector } from "../../components/workspace/ElementInspector";
import { SheetOverview } from "../../components/workspace/SheetOverview";
import { AddElementDialog } from "../../components/workspace/AddElementDialog";
import { useShell } from "../../components/shell/ShellContext";

type Pt = [number, number];

/** Reading order for stepping through a sheet: by kind, then top to bottom, left to right. */
function reviewOrder(shapes: Shape[]) {
  const centre = (s: Shape) => {
    const xs = s.points.map((p) => p[0]);
    const ys = s.points.map((p) => p[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2] as const;
  };
  return [...shapes].sort((a, b) => {
    const k = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (k) return k;
    const [ax, ay] = centre(a);
    const [bx, by] = centre(b);
    return Math.abs(ay - by) > 40 ? ay - by : ax - bx;
  });
}

export function DrawingsPage() {
  const { project, projectId, refresh, revealKey } = useProject();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const measurable = useMemo(() => project.sheets.filter((s) => s.measurable && s.shapes.length), [project.sheets]);
  const reference = useMemo(() => project.sheets.filter((s) => !(s.measurable && s.shapes.length)), [project.sheets]);

  const sheetParam = params.get("sheet");
  const sheet: Sheet | undefined =
    project.sheets.find((s) => s.id === sheetParam && (s.measurable || s.image)) ?? measurable[0] ?? project.sheets.find((s) => s.image);

  // The selection lives in the URL: links, the assistant and the back button all see it.
  const selectedId = params.get("shape");
  const setSelectedId = useCallback(
    (id: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("shape", id);
          else next.delete("shape");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const [tool, setTool] = useState<"select" | "draw">("select");
  const [editing, setEditing] = useState<{ id: string; points: Pt[] } | null>(null);
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const [hideReviewed, setHideReviewed] = useState(false);
  const [sheetsOpen, setSheetsOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const { assistantOpen } = useShell();
  // The assistant needs room; fold the sheet list away so the drawing keeps its space.
  const autoFolded = useRef(false);
  useEffect(() => {
    if (assistantOpen) {
      setSheetsOpen((open) => {
        autoFolded.current = open;
        return false;
      });
    } else if (autoFolded.current) {
      autoFolded.current = false;
      setSheetsOpen(true);
    }
  }, [assistantOpen]);
  const [drawn, setDrawn] = useState<Pt[] | null>(null);
  const [focus, setFocus] = useState<CanvasFocus | null>(null);
  // A focus target belongs to the sheet it was set on.
  useEffect(() => setFocus(null), [sheet?.id]);

  const marks = useQuery({ queryKey: ["review-marks", projectId], queryFn: () => api.reviewMarks(projectId), staleTime: 60_000 });
  const reviewed = useMemo(() => new Set(sheet ? marks.data?.marks[sheet.id] ?? [] : []), [marks.data, sheet]);

  const traceLineId = params.get("line");
  const traceLine = traceLineId ? project.comparison.find((r) => r.id === traceLineId) : undefined;

  // Focus a shape picked from outside the canvas (a link, the assistant, the overview list).
  const lastFocused = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId && selectedId !== lastFocused.current) {
      lastFocused.current = selectedId;
      setFocus({ nonce: Date.now(), shapeId: selectedId });
      setInspectorOpen(true);
    }
    if (!selectedId) lastFocused.current = null;
  }, [selectedId]);

  const selectSheet = (id: string) => {
    setEditing(null);
    setTool("select");
    const next = new URLSearchParams(params);
    next.set("sheet", id);
    next.delete("shape");
    setParams(next, { replace: true });
  };

  const liveShapes = useMemo(() => (sheet?.shapes ?? []).filter((s) => !s.hidden), [sheet]);
  const visibleShapes = useMemo(
    () => liveShapes.filter((s) => !hiddenKinds.has(s.kind) && (!hideReviewed || !reviewed.has(s.id) || s.id === selectedId)),
    [liveShapes, hiddenKinds, hideReviewed, reviewed, selectedId],
  );
  const ordered = useMemo(() => reviewOrder(liveShapes.filter((s) => !hiddenKinds.has(s.kind))), [liveShapes, hiddenKinds]);
  const kindsHere = useMemo(() => KIND_ORDER.filter((k) => liveShapes.some((s) => s.kind === k)), [liveShapes]);
  const highlight = useMemo(() => {
    if (!traceLine || !sheet) return null;
    return new Set((traceLine.placements ?? []).filter((p) => p.sheetId === sheet.id && p.shapeId).map((p) => p.shapeId!));
  }, [traceLine, sheet]);

  const shape = sheet?.shapes.find((s) => s.id === selectedId);
  const record = shape?.measurementId ? project.measurements.find((m) => m.id === shape.measurementId) : undefined;
  const imageUrl = sheet ? api.sheetImageUrl(projectId, sheet.id, sheet.image) : "";
  const position = shape ? ordered.findIndex((s) => s.id === shape.id) : -1;

  const startEdit = useCallback(
    (id?: string) => {
      const target = sheet?.shapes.find((s) => s.id === (id ?? selectedId));
      if (!target) return;
      if (id && id !== selectedId) setSelectedId(id);
      setTool("select");
      setEditing({ id: target.id, points: target.points.map((p) => [p[0], p[1]] as Pt) });
    },
    [sheet, selectedId, setSelectedId],
  );

  const step = useCallback(
    (delta: number) => {
      if (!ordered.length) return;
      const from = position < 0 ? (delta > 0 ? -1 : 0) : position;
      const next = ordered[(from + delta + ordered.length) % ordered.length]!;
      setEditing(null);
      setSelectedId(next.id);
    },
    [ordered, position, setSelectedId],
  );

  // Marks are shown at once and saved one request at a time, so quick R presses cannot race.
  const markQueue = useRef<Promise<unknown>>(Promise.resolve());
  function setReviewed(ids: string[], value: boolean) {
    if (!sheet || !ids.length) return;
    const sheetId = sheet.id;
    const key = ["review-marks", projectId];
    const apply = (on: boolean) =>
      qc.setQueryData<{ marks: Record<string, string[]> }>(key, (old) => {
        const current = new Set(old?.marks[sheetId] ?? []);
        ids.forEach((id) => (on ? current.add(id) : current.delete(id)));
        return { marks: { ...(old?.marks ?? {}), [sheetId]: [...current] } };
      });
    void qc.cancelQueries({ queryKey: key });
    apply(value);
    markQueue.current = markQueue.current.then(async () => {
      try {
        await api.setReviewMarks(projectId, sheetId, ids, value);
      } catch (err) {
        apply(!value); // undo only this request's marks
        toast.error((err as Error).message);
      }
    });
  }

  async function saveOutline() {
    if (!editing || !sheet || !shape) return;
    try {
      if (shape.manual && shape.measurementId) await api.updateManualMeasurement(projectId, shape.measurementId, { points: editing.points });
      else await api.saveShape(projectId, { sheetId: sheet.id, shapeId: shape.id, points: editing.points });
      await refresh();
      setEditing(null);
      toast.success("Outline saved");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function resetOutline() {
    if (!sheet || !shape) return;
    try {
      await api.saveShape(projectId, { sheetId: sheet.id, shapeId: shape.id, reset: true });
      await refresh();
      toast.success("Outline reset to the engine's position");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function removeShape() {
    if (!sheet || !shape) return;
    const result = await confirm({
      title: shape.manual ? "Delete this element?" : "Remove from the takeoff?",
      message: shape.manual
        ? "The element and its quantities are deleted."
        : "Its quantities are taken out of every bill line it feeds. You can restore it from the sheet overview.",
      confirmLabel: shape.manual ? "Delete" : "Remove",
      tone: "danger",
      reasonLabel: shape.manual ? undefined : "Reason",
    });
    if (!result.ok) return;
    try {
      if (shape.manual && shape.measurementId) await api.deleteManualMeasurement(projectId, shape.measurementId);
      else {
        if (shape.measurementId)
          await api.adjustMeasurement(projectId, shape.measurementId, { status: "excluded", adjustment_reason: result.reason || "Removed in drawings" });
        await api.saveShape(projectId, { sheetId: sheet.id, shapeId: shape.id, hidden: true });
      }
      setSelectedId(null);
      await refresh();
      toast.show(shape.manual ? "Element deleted" : "Removed from the takeoff", "success");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function restoreShape(shapeId: string, measurementId?: string) {
    if (!sheet) return;
    try {
      if (measurementId) await api.resetMeasurement(projectId, measurementId);
      await api.saveShape(projectId, { sheetId: sheet.id, shapeId, reset: true });
      await refresh();
      toast.success("Restored with engine values");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function saveQuantity(field: string, spec: ExpressionSpec, reason: string) {
    if (!record) return;
    try {
      if (record.manual) await api.updateManualMeasurement(projectId, record.id, { expressions: { [field]: spec }, reason: reason || undefined });
      else await api.adjustMeasurement(projectId, record.id, { expressions: { [field]: spec }, adjustment_reason: reason || "Formula edited in drawings" });
      await refresh();
      toast.success("Quantity updated. Bill lines are recalculated.");
    } catch (err) {
      toast.error((err as Error).message);
      throw err;
    }
  }

  async function addElement(body: { tag: string; elementType: string; reason: string; expressions: Record<string, ExpressionSpec> }) {
    if (!sheet || !drawn) return;
    const created = await api.addManualMeasurement(projectId, {
      tag: body.tag,
      sheet: sheet.id,
      element_type: body.elementType,
      reason: body.reason,
      points: drawn,
      expressions: body.expressions,
    });
    await refresh();
    setTool("select");
    setSelectedId(created.entry.id);
    toast.success(`${body.tag} added to the takeoff`);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && e.target.matches("input, textarea, select, [contenteditable]")) return;
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".dialog-backdrop, .palette-backdrop, .menu")) return;
      const k = e.key.toLowerCase();
      // Enter or Space on a focused button is that button's click; R held down must not race through a sheet.
      if ((k === "enter" || k === " ") && e.target instanceof HTMLButtonElement) return;
      if (e.repeat && (k === "r" || k === "e" || k === "enter")) return;
      if (k === "escape") {
        if (editing) setEditing(null);
        else if (tool === "draw") setTool("select");
        else setSelectedId(null);
      } else if (k === "v") setTool("select");
      else if (k === "b") {
        setEditing(null);
        setTool("draw");
      } else if (k === "e" && shape && !editing) startEdit();
      else if (k === "enter" && editing) void saveOutline();
      else if ((k === "j" || k === "]") && !editing) step(1);
      else if ((k === "k" || k === "[") && !editing) step(-1);
      else if (k === "r" && shape && !editing) {
        const wasReviewed = reviewed.has(shape.id);
        setReviewed([shape.id], !wasReviewed);
        if (!wasReviewed) step(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!sheet) {
    return (
      <div className="page-scroll">
        <div className="empty-state page-empty">
          <span className="empty-icon">
            <Layers size={20} />
          </span>
          <h3>No sheets to show yet</h3>
          <p>Upload drawings and run the pipeline. Measured sheets appear here with their outlines.</p>
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => navigate(`/p/${encodeURIComponent(projectId)}/inputs`)}>
              Add drawings
            </button>
          </div>
        </div>
      </div>
    );
  }

  const reviewedHere = liveShapes.filter((s) => reviewed.has(s.id)).length;

  return (
    <div className={`ws${sheetsOpen ? "" : " no-sheets"}${inspectorOpen ? "" : " no-inspector"}`}>
      <aside className="ws-sheets" aria-label="Sheets">
        <div className="ws-panel-head">
          <span className="section-title">Sheets</span>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setSheetsOpen(false)} aria-label="Hide sheets">
            <ChevronLeft size={15} />
          </button>
        </div>
        <div className="ws-sheet-list">
          {measurable.map((s) => {
            const live = s.shapes.filter((sh) => !sh.hidden);
            const done = (marks.data?.marks[s.id] ?? []).filter((id) => live.some((sh) => sh.id === id)).length;
            return (
              <button key={s.id} type="button" className={`sheet-item${s.id === sheet.id ? " active" : ""}`} onClick={() => selectSheet(s.id)}>
                <span className="sheet-code">{s.code}</span>
                <span className="sheet-title">{s.title}</span>
                <span className="sheet-kinds">
                  {KIND_ORDER.filter((k) => live.some((sh) => sh.kind === k)).map((k) => (
                    <i key={k} style={{ background: KIND_META[k]?.color }} title={KIND_META[k]?.name} />
                  ))}
                  <span className="faint">{live.length}</span>
                </span>
                {live.length ? (
                  <span className="sheet-progress" title={`${done} of ${live.length} reviewed`}>
                    <span style={{ width: `${(done / live.length) * 100}%` }} />
                  </span>
                ) : null}
              </button>
            );
          })}
          {reference.length ? <div className="ws-sheet-group">Reference sheets · {reference.length}</div> : null}
          {reference.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`sheet-item ref${s.id === sheet.id ? " active" : ""}`}
              onClick={() => s.image && selectSheet(s.id)}
              disabled={!s.image}
              title={s.image ? undefined : "No PDF for this sheet, so it cannot be shown"}
            >
              <span className="sheet-code">{s.code}</span>
              <span className="sheet-title">{s.role.replace(/_/g, " ")}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="ws-stage">
        <div className="ws-toolbar">
          {!sheetsOpen ? (
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setSheetsOpen(true)} aria-label="Show sheets">
              <ChevronRight size={15} />
            </button>
          ) : null}
          <div className="tool-group" role="toolbar" aria-label="Tools">
            <button type="button" className="tool" aria-pressed={tool === "select" && !editing} onClick={() => (setTool("select"), setEditing(null))} data-tip="Select  V" data-tip-pos="bottom">
              <MousePointer2 size={15} />
            </button>
            <button type="button" className="tool" aria-pressed={tool === "draw"} onClick={() => (setEditing(null), setTool("draw"))} data-tip="Draw a box  B" data-tip-pos="bottom">
              <SquarePlus size={15} />
            </button>
          </div>
          <div className="layer-chips" aria-label="Layers">
            {kindsHere.map((k) => {
              const count = liveShapes.filter((s) => s.kind === k).length;
              const on = !hiddenKinds.has(k);
              return (
                <button
                  key={k}
                  type="button"
                  className="chip chip-toggle"
                  aria-pressed={on}
                  onClick={() =>
                    setHiddenKinds((prev) => {
                      const next = new Set(prev);
                      if (next.has(k)) next.delete(k);
                      else next.add(k);
                      return next;
                    })
                  }
                >
                  <span className="dot" style={{ background: KIND_META[k]?.color }} />
                  {KIND_META[k]?.name ?? k}
                  <span className="faint tnum">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="grow" />
          {liveShapes.length ? (
            <button
              type="button"
              className={`review-pill${hideReviewed ? " on" : ""}`}
              onClick={() => setHideReviewed((v) => !v)}
              aria-pressed={hideReviewed}
              title={hideReviewed ? "Show reviewed outlines" : "Hide reviewed outlines"}
            >
              {hideReviewed ? <EyeOff size={13} /> : <Eye size={13} />}
              <span className="tnum">
                {reviewedHere}/{liveShapes.length}
              </span>
              reviewed
            </button>
          ) : null}
          {!inspectorOpen ? (
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setInspectorOpen(true)} aria-label="Show inspector">
              <PanelRight size={15} />
            </button>
          ) : null}
        </div>

        <div className="ws-banners">
          {traceLine ? (
            <div className="ws-banner">
              <span>
                Showing elements of <strong>{traceLine.label}</strong>
                {highlight?.size ? ` · ${highlight.size} on this sheet` : " · none on this sheet"}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.delete("line");
                  setParams(next, { replace: true });
                }}
              >
                <X size={14} /> Clear
              </button>
            </div>
          ) : null}
          {tool === "draw" ? (
            <div className="ws-banner info">
              <span>Drag a box around the element on the sheet.</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTool("select")}>
                Cancel <kbd>Esc</kbd>
              </button>
            </div>
          ) : null}
          {editing ? (
            <div className="ws-banner info">
              <span>Drag corners or sides to resize, inside to move. Arrow keys nudge.</span>
              <div className="row">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={saveOutline}>
                  <Check size={14} /> Save <kbd className="kbd-on-brand">Enter</kbd>
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <SheetCanvas
          key={sheet.id}
          imageUrl={sheet.image ? imageUrl : undefined}
          width={sheet.width}
          height={sheet.height}
          shapes={visibleShapes}
          selectedId={selectedId}
          onSelect={(id) => {
            lastFocused.current = id;
            setSelectedId(id);
            if (id) setInspectorOpen(true);
          }}
          tool={tool}
          editing={editing}
          onEditPoints={(points) => setEditing((e) => (e ? { ...e, points } : e))}
          onEditStart={(id) => {
            lastFocused.current = id;
            startEdit(id);
          }}
          onDrawn={(points) => setDrawn(points)}
          highlightIds={highlight}
          reviewedIds={reviewed}
          focus={focus}
          revealKey={revealKey}
        />
      </section>

      <aside className="ws-inspector" aria-label="Inspector">
        {shape ? (
          <ElementInspector
            project={project}
            sheet={sheet}
            shape={shape}
            record={record}
            imageUrl={imageUrl}
            editing={Boolean(editing)}
            position={{ index: position, total: ordered.length }}
            reviewed={reviewed.has(shape.id)}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
            onToggleReviewed={() => {
              const was = reviewed.has(shape.id);
              setReviewed([shape.id], !was);
              if (!was) step(1);
            }}
            onClose={() => setSelectedId(null)}
            onEditOutline={() => startEdit()}
            onResetOutline={resetOutline}
            onRemove={removeShape}
            onSaveQuantity={saveQuantity}
            onFocusBox={(box) => setFocus({ nonce: Date.now(), box })}
          />
        ) : (
          <SheetOverview
            project={project}
            sheet={sheet}
            ordered={ordered}
            reviewed={reviewed}
            onSelectShape={(id) => setSelectedId(id)}
            onSelectMeasurement={(mid) => {
              const target = sheet.shapes.find((s) => s.measurementId === mid);
              if (target) setSelectedId(target.id);
              else toast.show("That item has no outline on this sheet.");
            }}
            onMarkAll={(value) => setReviewed(liveShapes.map((s) => s.id), value)}
            onRestore={restoreShape}
            onDraw={() => setTool("draw")}
            onStart={() => step(1)}
          />
        )}
        <button type="button" className="ws-inspector-hide btn btn-ghost btn-icon btn-sm" onClick={() => setInspectorOpen(false)} aria-label="Hide inspector">
          <ChevronRight size={15} />
        </button>
      </aside>

      <AddElementDialog open={Boolean(drawn)} sheetCode={sheet.code} onClose={() => setDrawn(null)} onSave={addElement} />
    </div>
  );
}
