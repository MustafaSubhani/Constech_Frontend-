import { useEffect, useRef, useState } from "react";

type Kind = "footing" | "column" | "beam" | "slab" | "core";
type Box = { kind: Kind; order: number; storey: number; x: number; y: number; z: number; w: number; d: number; h: number };
type Vec = [number, number, number];

const BAY_X = 5;
const BAY_Y = 4.2;
const NX = 3;
const NY = 2;
const STOREY = 3.2;
const SLAB = 0.22;
const LEVELS = ["Ground floor", "First floor", "Second floor", "Third floor", "Fourth floor"];

function model(storeys: number): Box[] {
  const boxes: Box[] = [];
  let order = 0;
  const grid: [number, number][] = [];
  for (let i = 0; i <= NX; i++) for (let j = 0; j <= NY; j++) grid.push([i * BAY_X, j * BAY_Y]);
  grid.forEach(([x, y]) => boxes.push({ kind: "footing", order: order++, storey: -1, x: x - 0.8, y: y - 0.8, z: -0.7, w: 1.6, d: 1.6, h: 0.6 }));
  for (let s = 0; s < storeys; s++) {
    const base = s * STOREY;
    const top = base + STOREY - SLAB;
    const z0 = s === 0 ? -0.1 : base;
    grid.forEach(([x, y]) => boxes.push({ kind: "column", order: order++, storey: s, x: x - 0.2, y: y - 0.2, z: z0, w: 0.4, d: 0.4, h: top - z0 }));
    // The lift core rises one storey at a time with the frame.
    boxes.push({ kind: "core", order: order++, storey: s, x: BAY_X + 0.6, y: 0.6, z: z0, w: 2.2, d: 2.4, h: top - z0 + SLAB });
    const beamZ = top - 0.42;
    for (let j = 0; j <= NY; j++)
      for (let i = 0; i < NX; i++)
        boxes.push({ kind: "beam", order: order++, storey: s, x: i * BAY_X + 0.2, y: j * BAY_Y - 0.15, z: beamZ, w: BAY_X - 0.4, d: 0.3, h: 0.42 });
    for (let i = 0; i <= NX; i++)
      for (let j = 0; j < NY; j++)
        boxes.push({ kind: "beam", order: order++, storey: s, x: i * BAY_X - 0.15, y: j * BAY_Y + 0.2, z: beamZ, w: 0.3, d: BAY_Y - 0.4, h: 0.42 });
    boxes.push({ kind: "slab", order: order++, storey: s, x: -0.6, y: -0.6, z: top, w: NX * BAY_X + 1.2, d: NY * BAY_Y + 1.2, h: SLAB });
  }
  return boxes;
}

function caption(box: Box | undefined, done: boolean) {
  if (done) return "Structure complete";
  if (!box || box.kind === "footing") return "Placing footings";
  const level = LEVELS[box.storey] ?? `Level ${box.storey}`;
  if (box.kind === "column" || box.kind === "core") return `${level}: columns and core`;
  if (box.kind === "beam") return `${level}: beams`;
  return `${level}: slab`;
}

const FACES: { n: Vec; idx: number[] }[] = [
  { n: [0, 0, 1], idx: [4, 5, 6, 7] },
  { n: [0, 0, -1], idx: [0, 3, 2, 1] },
  { n: [0, -1, 0], idx: [0, 1, 5, 4] },
  { n: [1, 0, 0], idx: [1, 2, 6, 5] },
  { n: [0, 1, 0], idx: [2, 3, 7, 6] },
  { n: [-1, 0, 0], idx: [3, 0, 4, 7] },
];

type Palette = { base: [number, number, number]; edge: string; alpha: number; glow: number };
const PALETTES: Record<"brand" | "light" | "dark", Palette> = {
  brand: { base: [234, 230, 252], edge: "rgba(255,255,255,0.5)", alpha: 0.9, glow: 0.14 },
  light: { base: [214, 207, 236], edge: "rgba(43,2,102,0.26)", alpha: 0.95, glow: 0.1 },
  dark: { base: [78, 70, 108], edge: "rgba(200,185,255,0.24)", alpha: 0.95, glow: 0.18 },
};

const ease = (t: number) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);

type Props = { storeys?: number; tone?: "brand" | "light" | "dark"; caption?: boolean; className?: string; loop?: boolean; speed?: number };

/** A structural frame drawn in perspective on a canvas, built floor by floor: footings, then each storey's columns, beams and slab. */
export function Building3D({ storeys = 3, tone = "light", caption: showCaption = false, className = "", loop = true, speed = 1 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [label, setLabel] = useState("Placing footings");
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const boxes = model(storeys);
    const palette = PALETTES[tone];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = 44 / speed;
    const settle = 560 / speed;
    const buildMs = boxes.length * step + settle;
    const holdMs = 2200;
    const fadeMs = 700;
    const cycleMs = buildMs + holdMs + fadeMs;
    const cx = (NX * BAY_X) / 2;
    const cy = (NY * BAY_Y) / 2;
    const cz = (storeys * STOREY) / 2 - 0.6;
    const light: Vec = normalize([-0.45, -0.7, 0.85]);
    let raf = 0;
    let start = performance.now();
    let lastLabel = "";
    let lastStage = -1;
    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = (now: number) => {
      let t = reduced ? buildMs : now - start;
      if (loop && t > cycleMs) {
        start = now;
        t = 0;
      }
      const placing = Math.min(boxes.length - 1, Math.floor(t / step));
      const done = t >= buildMs;
      const text = caption(boxes[placing], done);
      if (text !== lastLabel) {
        lastLabel = text;
        setLabel(text);
      }
      const current = done ? storeys + 1 : (boxes[placing]?.storey ?? -1) + 1;
      if (current !== lastStage) {
        lastStage = current;
        setStage(current);
      }
      const fade = t > buildMs + holdMs ? 1 - (t - buildMs - holdMs) / fadeMs : 1;
      const yaw = -0.62 + (reduced ? 0 : Math.sin(now / 5200) * 0.16);
      const pitch = 0.5;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);
      const span = Math.max(NX * BAY_X, storeys * STOREY * 1.25) + 4;
      const scale = Math.min(width, height * 1.25) / span;
      const camDist = 46;

      const project = (p: Vec): [number, number, number] => {
        const x = p[0] - cx;
        const y = p[1] - cy;
        const z = p[2] - cz;
        const rx = x * cosY - y * sinY;
        const ry = x * sinY + y * cosY;
        const vy = ry * cosP - z * sinP;
        const vz = ry * sinP + z * cosP;
        const persp = camDist / (camDist + vy);
        return [width / 2 + rx * scale * persp, height / 2 - vz * scale * persp + height * 0.04, vy];
      };
      const viewDir: Vec = [sinY * cosP, cosY * cosP, -sinP];

      type Poly = { pts: [number, number][]; depth: number; fill: string };
      const polys: Poly[] = [];
      for (const b of boxes) {
        const local = (t - b.order * step) / settle;
        const p = ease(local);
        if (p <= 0) continue;
        let { z, h } = b;
        if (b.kind === "column" || b.kind === "core") h = b.h * p;
        else if (b.kind === "slab" || b.kind === "beam") z += (1 - p) * 1.6;
        else z -= (1 - p) * 0.8;
        // A just-placed element is a touch brighter, then settles to the frame's colour.
        const glow = local < 1.6 ? palette.glow * Math.max(0, 1 - Math.abs(local - 0.8) / 0.8) : 0;
        const corners: Vec[] = [
          [b.x, b.y, z], [b.x + b.w, b.y, z], [b.x + b.w, b.y + b.d, z], [b.x, b.y + b.d, z],
          [b.x, b.y, z + h], [b.x + b.w, b.y, z + h], [b.x + b.w, b.y + b.d, z + h], [b.x, b.y + b.d, z + h],
        ];
        const proj = corners.map(project);
        for (const face of FACES) {
          if (dot(face.n, viewDir) > 0.02) continue;
          const shade = Math.min(1.08, 0.62 + 0.38 * Math.max(0, dot(face.n, light)) + glow);
          const alpha = palette.alpha * Math.min(1, p * 1.4) * fade;
          const [r, g, bl] = palette.base.map((c) => Math.min(255, Math.round(c * shade)));
          polys.push({
            pts: face.idx.map((i) => [proj[i]![0], proj[i]![1]]),
            depth: face.idx.reduce((s, i) => s + proj[i]![2], 0) / 4,
            fill: `rgba(${r},${g},${bl},${alpha.toFixed(3)})`,
          });
        }
      }
      polys.sort((a, b) => b.depth - a.depth);
      ctx.clearRect(0, 0, width, height);
      ctx.lineJoin = "round";
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = palette.edge;
      ctx.globalAlpha = fade;
      for (const poly of polys) {
        ctx.beginPath();
        ctx.moveTo(poly.pts[0]![0], poly.pts[0]![1]);
        for (let i = 1; i < poly.pts.length; i++) ctx.lineTo(poly.pts[i]![0], poly.pts[i]![1]);
        ctx.closePath();
        ctx.fillStyle = poly.fill;
        ctx.fill();
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [storeys, tone, loop, speed]);

  return (
    <div className={`b3d ${className}`.trim()}>
      <canvas ref={canvasRef} className="b3d-canvas" aria-hidden="true" />
      {showCaption ? (
        <div className="iso-caption" aria-live="polite">
          <div className="iso-steps" aria-hidden="true">
            {Array.from({ length: storeys + 1 }, (_, i) => (
              <span key={i} className={i === stage ? "on" : i < stage ? "done" : ""} />
            ))}
          </div>
          <span key={label} className="iso-caption-text">
            {label}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function dot(a: Vec, b: Vec) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: Vec): Vec {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
