import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project, Shape, Sheet } from "../types";
import { KIND_META } from "../lib/kinds";
import { api } from "../api/client";

type Props = {
  project: Project;
  sheet: Sheet;
  filter: string;
  selected: string | null;
  panelOpen: boolean;
  visibleShapeIds?: Set<string> | null;
  highlightShapeIds?: Set<string> | null;
  traceFocusShapeId?: string | null;
  onSelect: (id: string | null, focus?: boolean) => void;
  onTogglePanel: () => void;
  compact?: boolean;
};

type CanvasGeom = {
  w: number;
  h: number;
  sx: number;
  sy: number;
};

export function SheetCanvas({
  project,
  sheet,
  filter,
  selected,
  panelOpen,
  visibleShapeIds = null,
  highlightShapeIds = null,
  traceFocusShapeId = null,
  onSelect,
  onTogglePanel,
  compact = false,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [pos, setPos] = useState({ x: 24, y: 24 });
  const [dragging, setDragging] = useState(false);
  const [geom, setGeom] = useState<CanvasGeom>({
    w: sheet.width,
    h: sheet.height,
    sx: 1,
    sy: 1,
  });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean; shape?: string } | null>(
    null,
  );

  const rasterUrl = api.sheetImageUrl(project.id, sheet.id, sheet.image);
  const hasRaster = Boolean(rasterUrl);
  const captionShape = sheet.shapes.find((s) => s.id === selected);

  useEffect(() => {
    setGeom({ w: sheet.width, h: sheet.height, sx: 1, sy: 1 });
  }, [sheet.id, sheet.width, sheet.height]);

  const applyView = useCallback(
    (s: number, p: { x: number; y: number }) => {
      setScale(s);
      setPos(p);
    },
    [],
  );

  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const pad = 36;
    const s = Math.min((stage.clientWidth - pad) / geom.w, (stage.clientHeight - pad) / geom.h);
    applyView(s, {
      x: (stage.clientWidth - geom.w * s) / 2,
      y: (stage.clientHeight - geom.h * s) / 2,
    });
  }, [geom.w, geom.h, applyView]);

  const zoomIn = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const currentScale = scale || 1;
    const next = Math.min(3.5, currentScale * 1.25);
    const cx = stage.clientWidth / 2;
    const cy = stage.clientHeight / 2;
    applyView(next, {
      x: cx - ((cx - pos.x) * next) / currentScale,
      y: cy - ((cy - pos.y) * next) / currentScale,
    });
  }, [scale, pos, applyView]);

  const zoomOut = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const currentScale = scale || 1;
    const next = Math.max(0.12, currentScale * 0.8);
    const cx = stage.clientWidth / 2;
    const cy = stage.clientHeight / 2;
    applyView(next, {
      x: cx - ((cx - pos.x) * next) / currentScale,
      y: cy - ((cy - pos.y) * next) / currentScale,
    });
  }, [scale, pos, applyView]);

  const zoom100 = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const currentScale = scale || 1;
    const next = 1.0;
    const cx = stage.clientWidth / 2;
    const cy = stage.clientHeight / 2;
    applyView(next, {
      x: cx - ((cx - pos.x) * next) / currentScale,
      y: cy - ((cy - pos.y) * next) / currentScale,
    });
  }, [scale, pos, applyView]);

  // Keyboard shortcuts on canvas
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "f" || e.key === "F") {
        fit();
      } else if (e.key === "+" || e.key === "=") {
        zoomIn();
      } else if (e.key === "-") {
        zoomOut();
      } else if (e.key === "0") {
        zoom100();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [fit, zoomIn, zoomOut, zoom100]);

  useEffect(() => {
    applyView(0, { x: 24, y: 24 });
    requestAnimationFrame(fit);
  }, [sheet.id, fit, applyView]);

  const mapPoint = useCallback(
    (x: number, y: number) => [x * geom.sx, y * geom.sy] as [number, number],
    [geom.sx, geom.sy],
  );

  const focusShape = useCallback(
    (shape: Shape) => {
      const stage = stageRef.current;
      if (!stage) return;
      const xs = shape.points.map((p) => mapPoint(p[0], p[1])[0]);
      const ys = shape.points.map((p) => mapPoint(p[0], p[1])[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const w = Math.max(maxX - minX, 48);
      const h = Math.max(maxY - minY, 48);
      const pad = 160;
      const next = Math.min(2.8, Math.max(0.18, Math.min((stage.clientWidth - pad) / w, (stage.clientHeight - pad) / h)));
      applyView(next, {
        x: stage.clientWidth / 2 - ((minX + maxX) / 2) * next,
        y: stage.clientHeight / 2 - ((minY + maxY) / 2) * next,
      });
    },
    [applyView, mapPoint],
  );

  useEffect(() => {
    const focusId = traceFocusShapeId || selected;
    if (!focusId) return;
    const shape = sheet.shapes.find((s) => s.id === focusId);
    if (shape) focusShape(shape);
  }, [selected, traceFocusShapeId, sheet.shapes, focusShape]);

  const onRasterLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (!nw || !nh) {
        fit();
        return;
      }
      const sx = nw / sheet.width;
      const sy = nh / sheet.height;
      if (Math.abs(sx - 1) > 0.002 || Math.abs(sy - 1) > 0.002) {
        setGeom({ w: nw, h: nh, sx, sy });
      } else if (nw !== geom.w || nh !== geom.h) {
        setGeom({ w: nw, h: nh, sx: 1, sy: 1 });
      }
      requestAnimationFrame(fit);
    },
    [sheet.width, sheet.height, fit, geom.w, geom.h],
  );

  const shapes = useMemo(() => {
    return sheet.shapes.map((shape) => {
      const points = shape.points.map((p) => mapPoint(p[0], p[1]).join(",")).join(" ");
      return { shape, points };
    });
  }, [sheet.shapes, mapPoint]);

  return (
    <>
      <div className="stage-tools">
        <span className="code">{sheet.code}</span>
        <span>{sheet.title}</span>
        <div className="canvas-zoom-controls">
          <button type="button" className="canvas-zoom-btn" onClick={zoomOut} title="Zoom out (-)">−</button>
          <span className="zoom" style={{ minWidth: 42, textAlign: "center" }}>{scale ? `${Math.round(scale * 100)}%` : "Fit"}</span>
          <button type="button" className="canvas-zoom-btn" onClick={zoomIn} title="Zoom in (+)">+</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={zoom100} title="100% scale (0)">1:1</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={fit} title="Fit sheet (F)">Fit</button>
        </div>
        {!compact ? (
          <button type="button" className="btn btn-ghost" onClick={onTogglePanel}>
            {panelOpen ? "Hide list" : "Show list"}
          </button>
        ) : null}
      </div>
      <div
        className={`stage${dragging ? " dragging" : ""}`}
        ref={stageRef}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const target = e.target as Element;
          const poly = target.closest("polygon");
          dragRef.current = {
            x: e.clientX,
            y: e.clientY,
            ox: pos.x,
            oy: pos.y,
            moved: false,
            shape: poly?.getAttribute("data-shape") ?? undefined,
          };
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.hypot(dx, dy) > 4) {
            d.moved = true;
            setDragging(true);
            setPos({ x: d.ox + dx, y: d.oy + dy });
          }
        }}
        onPointerUp={() => {
          const d = dragRef.current;
          if (d && !d.moved && d.shape) {
            const kind = sheet.shapes.find((s) => s.id === d.shape)?.kind;
            if (filter === "all" || kind === filter) onSelect(d.shape, true);
          }
          dragRef.current = null;
          setDragging(false);
        }}
        onWheel={(e) => {
          e.preventDefault();
          const rect = stageRef.current?.getBoundingClientRect();
          if (!rect || !scale) return;
          const px = e.clientX - rect.left;
          const py = e.clientY - rect.top;
          const next = Math.min(3.2, Math.max(0.12, scale * (e.deltaY < 0 ? 1.08 : 0.92)));
          setPos({
            x: px - ((px - pos.x) * next) / scale,
            y: py - ((py - pos.y) * next) / scale,
          });
          setScale(next);
        }}
      >
        <div className={`caption${captionShape ? " show" : ""}`}>{captionShape?.label ?? ""}</div>
        <div
          className={`world${hasRaster ? " has-raster" : ""}`}
          style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale || 1})` }}
        >
          <div className="sheet-stack" style={{ width: geom.w, height: geom.h }}>
            {hasRaster ? (
              <img
                className="sheet-raster"
                src={rasterUrl}
                width={geom.w}
                height={geom.h}
                alt=""
                draggable={false}
                decoding="async"
                onLoad={onRasterLoad}
              />
            ) : null}
            <svg
              className="sheet-vector"
              width={geom.w}
              height={geom.h}
              viewBox={`0 0 ${geom.w} ${geom.h}`}
            >
              {!hasRaster ? <rect width="100%" height="100%" fill="white" /> : null}
              {shapes.map(({ shape, points }) => {
                const color = KIND_META[shape.kind]?.color ?? "#444444";
                const dim = filter !== "all" && shape.kind !== filter;
                const on = shape.id === selected;
                const fill = shape.dashed ? `${color}33` : `${color}55`;
                const gated = visibleShapeIds !== null && !visibleShapeIds.has(shape.id);
                const fresh = visibleShapeIds !== null && visibleShapeIds.has(shape.id);
                const traceHit = highlightShapeIds !== null && highlightShapeIds.has(shape.id);
                const traceDim =
                  highlightShapeIds !== null && highlightShapeIds.size > 0 && !traceHit;
                const traceFocus = traceFocusShapeId === shape.id;
                return (
                  <polygon
                    key={shape.id}
                    data-shape={shape.id}
                    data-kind={shape.kind}
                    points={points}
                    fill={traceHit ? `${color}88` : fill}
                    stroke={traceFocus ? "var(--purple)" : color}
                    strokeWidth={traceFocus ? 3.5 : traceHit ? 2.8 : 2}
                    strokeDasharray={shape.dashed ? "8 5" : undefined}
                    className={[
                      on || traceFocus ? "on" : "",
                      dim || (selected && !on) || traceDim ? "dim" : "",
                      traceHit ? "trace-hit" : "",
                      gated ? "reveal-hidden" : "",
                      fresh ? "reveal-in" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  />
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </>
  );
}
