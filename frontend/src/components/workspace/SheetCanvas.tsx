import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import type { Shape } from "../../types";
import { KIND_META, KIND_ORDER } from "../../lib/kinds";

type Pt = [number, number];
export type CanvasFocus = { nonce: number; shapeId?: string; box?: [number, number, number, number] };

type Props = {
  imageUrl?: string;
  width: number;
  height: number;
  shapes: Shape[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  tool: "select" | "draw";
  editing: { id: string; points: Pt[] } | null;
  onEditPoints: (points: Pt[]) => void;
  onEditStart?: (id: string) => void;
  onDrawn: (points: Pt[]) => void;
  highlightIds?: Set<string> | null;
  reviewedIds?: Set<string>;
  focus?: CanvasFocus | null;
  revealKey: number;
};

type Drag =
  | { mode: "pan"; sx: number; sy: number; ox: number; oy: number; moved: boolean; shapeId: string | null }
  | { mode: "vertex"; index: number; origin: Pt[]; rect: boolean }
  | { mode: "edge"; index: number; origin: Pt[]; start: Pt }
  | { mode: "insert"; index: number; origin: Pt[]; sx: number; sy: number }
  | { mode: "move"; start: Pt; origin: Pt[] }
  | { mode: "draw"; start: Pt };

const MIN = 0.08;
const MAX = 6;

/** Four points whose sides alternate horizontal and vertical. */
export function isAxisRect(points: Pt[]) {
  if (points.length !== 4) return false;
  const eq = (a: number, b: number) => Math.abs(a - b) < 0.6;
  const sides = points.map((p, i) => {
    const q = points[(i + 1) % 4]!;
    return eq(p[1], q[1]) ? "h" : eq(p[0], q[0]) ? "v" : "x";
  });
  return (sides.join("") === "hvhv" || sides.join("") === "vhvh");
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}

export function SheetCanvas({
  imageUrl,
  width,
  height,
  shapes,
  selectedId,
  onSelect,
  tool,
  editing,
  onEditPoints,
  onEditStart,
  onDrawn,
  highlightIds,
  reviewedIds,
  focus,
  revealKey,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 0, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<Drag | null>(null);
  const [drawRect, setDrawRect] = useState<[Pt, Pt] | null>(null);
  const [focusBox, setFocusBox] = useState<[number, number, number, number] | null>(null);
  const [panning, setPanning] = useState(false);
  const editRef = useRef(editing);
  editRef.current = editing;

  // The view produced by the last whole-sheet fit; while it is unchanged, resizes refit the sheet.
  const fittedView = useRef<typeof view | null>(null);
  const stageSize = useRef({ w: 0, h: 0 });

  const fitTo = useCallback((x0: number, y0: number, x1: number, y1: number, pad = 40, maxScale = MAX) => {
    const stage = stageRef.current;
    if (!stage) return null;
    const w = Math.max(x1 - x0, 1);
    const h = Math.max(y1 - y0, 1);
    const scale = Math.min(maxScale, Math.max(MIN, Math.min((stage.clientWidth - pad * 2) / w, (stage.clientHeight - pad * 2) / h)));
    const next = { scale, x: stage.clientWidth / 2 - ((x0 + x1) / 2) * scale, y: stage.clientHeight / 2 - ((y0 + y1) / 2) * scale };
    setView(next);
    return next;
  }, []);

  const fit = useCallback(() => {
    fittedView.current = fitTo(0, 0, width, height, 24);
  }, [fitTo, width, height]);

  useLayoutEffect(() => {
    fit();
  }, [fit, imageUrl]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stageSize.current = { w: stage.clientWidth, h: stage.clientHeight };
    const ro = new ResizeObserver(() => {
      const prev = stageSize.current;
      stageSize.current = { w: stage.clientWidth, h: stage.clientHeight };
      const v = viewRef.current;
      if (!v.scale || v === fittedView.current) {
        fit();
        return;
      }
      // The user has moved the view: keep the same point of the sheet in the middle.
      const dx = (stage.clientWidth - prev.w) / 2;
      const dy = (stage.clientHeight - prev.h) / 2;
      if (dx || dy) setView({ ...v, x: v.x + dx, y: v.y + dy });
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, [fit]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const v = viewRef.current;
    const px = cx ?? stage.clientWidth / 2;
    const py = cy ?? stage.clientHeight / 2;
    const scale = Math.min(MAX, Math.max(MIN, v.scale * factor));
    setView({ scale, x: px - ((px - v.x) * scale) / v.scale, y: py - ((py - v.y) * scale) / v.scale });
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = stage!.getBoundingClientRect();
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX }));
      }
    }
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && e.target.matches("input, textarea, select, [contenteditable]")) return;
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".dialog-backdrop, .palette-backdrop, .menu")) return;
      const current = editRef.current;
      if (current && e.key.startsWith("Arrow")) {
        // Nudge the outline being adjusted: one screen pixel, or ten with Shift.
        e.preventDefault();
        const stepPx = (e.shiftKey ? 10 : 1) / (viewRef.current.scale || 1);
        const dx = e.key === "ArrowLeft" ? -stepPx : e.key === "ArrowRight" ? stepPx : 0;
        const dy = e.key === "ArrowUp" ? -stepPx : e.key === "ArrowDown" ? stepPx : 0;
        onEditPoints(current.points.map(([x, y]) => [round(x + dx), round(y + dy)]));
        return;
      }
      if (e.key === "f" || e.key === "F") fit();
      else if (e.key === "+" || e.key === "=") zoomAt(1.25);
      else if (e.key === "-") zoomAt(0.8);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fit, zoomAt, onEditPoints]);

  useEffect(() => {
    if (!focus) return;
    if (focus.box) {
      const [x0, y0, x1, y1] = focus.box;
      fitTo(x0, y0, x1, y1, 120, 3);
      setFocusBox(focus.box);
      const t = window.setTimeout(() => setFocusBox(null), 2400);
      return () => window.clearTimeout(t);
    }
    const shape = shapes.find((s) => s.id === focus.shapeId);
    if (shape) {
      const xs = shape.points.map((p) => p[0]);
      const ys = shape.points.map((p) => p[1]);
      fitTo(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 140, 2.5);
    }
    return undefined;
  }, [focus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const toSheet = (clientX: number, clientY: number): Pt => {
    const rect = stageRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return [(clientX - rect.left - v.x) / v.scale, (clientY - rect.top - v.y) / v.scale];
  };

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as Element;
    const handle = target.closest("[data-handle]");
    const edge = target.closest("[data-edge]");
    const polygon = target.closest("[data-shape]");
    const shapeId = polygon?.getAttribute("data-shape") ?? null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (editing && handle && e.button === 0) {
      drag.current = { mode: "vertex", index: Number(handle.getAttribute("data-handle")), origin: editing.points, rect: isAxisRect(editing.points) };
    } else if (editing && edge && e.button === 0) {
      const index = Number(edge.getAttribute("data-edge"));
      const start = toSheet(e.clientX, e.clientY);
      if (isAxisRect(editing.points)) drag.current = { mode: "edge", index, origin: editing.points, start };
      // On other shapes, dragging the middle of a side adds a corner there (a click alone changes nothing).
      else drag.current = { mode: "insert", index, origin: editing.points, sx: e.clientX, sy: e.clientY };
    } else if (editing && shapeId === editing.id && e.button === 0) {
      drag.current = { mode: "move", start: toSheet(e.clientX, e.clientY), origin: editing.points };
    } else if (tool === "draw" && e.button === 0) {
      const start = toSheet(e.clientX, e.clientY);
      drag.current = { mode: "draw", start };
      setDrawRect([start, start]);
    } else {
      drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y, moved: false, shapeId };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (d.mode === "pan") {
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) > 4) {
        d.moved = true;
        setPanning(true);
      }
      if (d.moved) setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
    } else if (d.mode === "insert") {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
      const [x, y] = toSheet(e.clientX, e.clientY).map(round) as Pt;
      const points = [...d.origin];
      points.splice(d.index + 1, 0, [x, y]);
      onEditPoints(points);
      drag.current = { mode: "vertex", index: d.index + 1, origin: points, rect: false };
    } else if (d.mode === "vertex" && editing) {
      const [x, y] = toSheet(e.clientX, e.clientY).map(round) as Pt;
      if (d.rect) {
        // Keep a rectangle a rectangle: the two neighbouring corners follow along their shared side.
        const o = d.origin;
        const i = d.index;
        const prev = (i + 3) % 4;
        const next = (i + 1) % 4;
        const pts = o.map((p) => [p[0], p[1]] as Pt);
        pts[i] = [x, y];
        if (Math.abs(o[prev]![0] - o[i]![0]) < 0.6) pts[prev]![0] = x;
        else pts[prev]![1] = y;
        if (Math.abs(o[next]![0] - o[i]![0]) < 0.6) pts[next]![0] = x;
        else pts[next]![1] = y;
        onEditPoints(pts);
      } else onEditPoints(editing.points.map((pt, i) => (i === d.index ? [x, y] : pt)));
    } else if (d.mode === "edge") {
      const p = toSheet(e.clientX, e.clientY);
      const o = d.origin;
      const a = d.index;
      const b = (a + 1) % 4;
      const horizontal = Math.abs(o[a]![1] - o[b]![1]) < 0.6;
      const pts = o.map((q) => [q[0], q[1]] as Pt);
      if (horizontal) {
        const y = round(o[a]![1] + p[1] - d.start[1]);
        pts[a]![1] = y;
        pts[b]![1] = y;
      } else {
        const x = round(o[a]![0] + p[0] - d.start[0]);
        pts[a]![0] = x;
        pts[b]![0] = x;
      }
      onEditPoints(pts);
    } else if (d.mode === "move") {
      const p = toSheet(e.clientX, e.clientY);
      const dx = p[0] - d.start[0];
      const dy = p[1] - d.start[1];
      onEditPoints(d.origin.map(([x, y]) => [round(x + dx), round(y + dy)]));
    } else if (d.mode === "draw") {
      setDrawRect([d.start, toSheet(e.clientX, e.clientY)]);
    }
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    if (!d) return;
    if (d.mode === "pan" && !d.moved && !editing) onSelect(d.shapeId);
    if (d.mode === "draw" && drawRect) {
      const [[ax, ay], [bx, by]] = drawRect;
      setDrawRect(null);
      const minSize = 6 / viewRef.current.scale;
      if (Math.abs(bx - ax) > minSize && Math.abs(by - ay) > minSize) {
        const x0 = round(Math.min(ax, bx));
        const x1 = round(Math.max(ax, bx));
        const y0 = round(Math.min(ay, by));
        const y1 = round(Math.max(ay, by));
        onDrawn([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
      }
    }
  }

  const scale = view.scale || 1;
  const kindIndex = (kind: string) => Math.max(0, KIND_ORDER.indexOf(kind));
  const cursor = editing ? "default" : tool === "draw" ? "crosshair" : panning ? "grabbing" : "grab";
  const editRect = editing ? isAxisRect(editing.points) : false;

  return (
    <div
      className="canvas"
      ref={stageRef}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        const id = (e.target as Element).closest("[data-shape]")?.getAttribute("data-shape");
        if (id && !editing && tool === "select" && onEditStart) onEditStart(id);
      }}
    >
      <div className="canvas-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${scale})` }}>
        <div className="canvas-sheet" style={{ width, height }}>
          {imageUrl ? <img src={imageUrl} alt="" draggable={false} width={width} height={height} decoding="async" /> : null}
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="canvas-svg">
            <g key={revealKey}>
              {shapes.map((shape, i) => {
                const meta = KIND_META[shape.kind] ?? KIND_META.missed!;
                const isEditing = editing?.id === shape.id;
                const points = (isEditing ? editing!.points : shape.points).map((p) => p.join(",")).join(" ");
                const selected = selectedId === shape.id;
                const hit = highlightIds?.has(shape.id);
                const faded = highlightIds && highlightIds.size > 0 && !hit;
                return (
                  <polygon
                    key={shape.id}
                    data-shape={shape.id}
                    points={points}
                    className={[
                      "shape",
                      `k-${shape.kind}`,
                      selected ? "selected" : "",
                      hit ? "hit" : "",
                      faded ? "faded" : "",
                      isEditing ? "editing" : "",
                      shape.manual ? "manual" : "",
                      reviewedIds?.has(shape.id) && !selected && !isEditing ? "reviewed" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={{
                      ["--c" as string]: meta.color,
                      animationDelay: `${kindIndex(shape.kind) * 110 + Math.min(i, 50) * 5}ms`,
                    }}
                  >
                    <title>{shape.label}</title>
                  </polygon>
                );
              })}
            </g>
            {editing
              ? editing.points.map(([x, y], i) => {
                  const [nx, ny] = editing.points[(i + 1) % editing.points.length]!;
                  const mx = (x + nx) / 2;
                  const my = (y + ny) / 2;
                  const horizontal = Math.abs(y - ny) < 0.6;
                  return (
                    <rect
                      key={`e${i}`}
                      data-edge={i}
                      className={`edge-handle${editRect ? (horizontal ? " ns" : " ew") : " add"}`}
                      x={mx - (editRect && horizontal ? 9 : 4) / scale}
                      y={my - (editRect && !horizontal ? 9 : 4) / scale}
                      width={(editRect && horizontal ? 18 : 8) / scale}
                      height={(editRect && !horizontal ? 18 : 8) / scale}
                      rx={2 / scale}
                      strokeWidth={1.25 / scale}
                    />
                  );
                })
              : null}
            {editing
              ? editing.points.map(([x, y], i) => (
                  <circle key={i} data-handle={i} className="handle" cx={x} cy={y} r={5.5 / scale} strokeWidth={1.5 / scale} />
                ))
              : null}
            {drawRect ? (
              <rect
                className="draw-rect"
                x={Math.min(drawRect[0][0], drawRect[1][0])}
                y={Math.min(drawRect[0][1], drawRect[1][1])}
                width={Math.abs(drawRect[1][0] - drawRect[0][0])}
                height={Math.abs(drawRect[1][1] - drawRect[0][1])}
              />
            ) : null}
            {focusBox ? (
              <rect className="focus-box" x={focusBox[0]} y={focusBox[1]} width={focusBox[2] - focusBox[0]} height={focusBox[3] - focusBox[1]} />
            ) : null}
          </svg>
        </div>
      </div>
      <div className="canvas-zoom" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => zoomAt(0.8)} aria-label="Zoom out">
          <Minus size={15} />
        </button>
        <span className="zoom-value tnum">{Math.round(scale * 100)}%</span>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => zoomAt(1.25)} aria-label="Zoom in">
          <Plus size={15} />
        </button>
        <span className="zoom-sep" />
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={fit} aria-label="Fit sheet" title="Fit (F)">
          <Maximize size={14} />
        </button>
      </div>
    </div>
  );
}
