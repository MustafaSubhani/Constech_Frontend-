import { useEffect, useRef, useState } from "react";

type Kind = "footing" | "column" | "beam" | "slab" | "core";
type Box = { kind: Kind; order: number; x: number; y: number; z: number; w: number; d: number; h: number };
type Vec = [number, number, number];

const BAY_X = 5;
const BAY_Y = 4.2;
const NX = 3;
const NY = 2;
const STOREY = 3.2;
const SLAB = 0.22;

function model(storeys: number): Box[] {
  const boxes: Box[] = [];
  let order = 0;
  const grid: [number, number][] = [];
  for (let i = 0; i <= NX; i++) for (let j = 0; j <= NY; j++) grid.push([i * BAY_X, j * BAY_Y]);
  grid.forEach(([x, y]) => boxes.push({ kind: "footing", order: order++, x: x - 0.8, y: y - 0.8, z: -0.7, w: 1.6, d: 1.6, h: 0.6 }));
  for (let s = 0; s < storeys; s++) {
    const base = s * STOREY;
    const top = base + STOREY - SLAB;
    grid.forEach(([x, y]) => boxes.push({ kind: "column", order: order++, x: x - 0.2, y: y - 0.2, z: s === 0 ? -0.1 : base, w: 0.4, d: 0.4, h: top - (s === 0 ? -0.1 : base) }));
    if (s === 0) boxes.push({ kind: "core", order: order++, x: BAY_X * 1 + 0.6, y: BAY_Y * 0 + 0.6, z: -0.1, w: 2.2, d: 2.4, h: storeys * STOREY - SLAB + 0.1 });
    const beamZ = top - 0.42;
    for (let j = 0; j <= NY; j++) for (let i = 0; i < NX; i++)
      boxes.push({ kind: "beam", order: order++, x: i * BAY_X + 0.2, y: j * BAY_Y - 0.15, z: beamZ, w: BAY_X - 0.4, d: 0.3, h: 0.42 });
    for (let i = 0; i <= NX; i++) for (let j = 0; j < NY; j++)
      boxes.push({ kind: "beam", order: order++, x: i * BAY_X - 0.15, y: j * BAY_Y + 0.2, z: beamZ, w: 0.3, d: BAY_Y - 0.4, h: 0.42 });
    boxes.push({ kind: "slab", order: order++, x: -0.6, y: -0.6, z: top, w: NX * BAY_X + 1.2, d: NY * BAY_Y + 1.2, h: SLAB });
  }
  return boxes;
}

const FACES: { n: Vec; idx: number[] }[] = [
  { n: [0, 0, 1], idx: [4, 5, 6, 7] },
  { n: [0, 0, -1], idx: [0, 3, 2, 1] },
  { n: [0, -1, 0], idx: [0, 1, 5, 4] },
  { n: [1, 0, 0], idx: [1, 2, 6, 5] },
  { n: [0, 1, 0], idx: [2, 3, 7, 6] },
  { n: [-1, 0, 0], idx: [3, 0, 4, 7] },
];

const CAPTIONS: { kind: Kind | "all"; text: string }[] = [
  { kind: "footing", text: "Footings from the schedule" },
  { kind: "column", text: "Columns per storey" },
  { kind: "beam", text: "Beams from sized labels" },
  { kind: "slab", text: "Slabs from thickness notes" },
  { kind: "all", text: "Compared with the bill" },
];

type Palette = { base: [number, number, number]; lit: [number, number, number]; edge: string; alpha: number; litAlpha: number };
const PALETTES: Record<"brand" | "light" | "dark", Palette> = {
  brand: { base: [236, 232, 255], lit: [122, 226, 196], edge: "rgba(255,255,255,0.55)", alpha: 0.9, litAlpha: 0.96 },
  light: { base: [214, 207, 236], lit: [70, 186, 154], edge: "rgba(43,2,102,0.28)", alpha: 0.95, litAlpha: 0.98 },
  dark: { base: [72, 64, 100], lit: [56, 160, 132], edge: "rgba(200,185,255,0.25)", alpha: 0.95, litAlpha: 0.98 },
};

const ease = (t: number) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);

type Props = { storeys?: number; tone?: "brand" | "light" | "dark"; caption?: boolean; className?: string; loop?: boolean; speed?: number };

/** A structural frame drawn in perspective on a canvas: assembles element by element, sways, and highlights each group. */
export function Building3D({ storeys = 3, tone = "light", caption = false, className = "", loop = true, speed = 1 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState(-1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const boxes = model(storeys);
    const palette = PALETTES[tone];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = 38 / speed;
    const buildMs = boxes.length * step + 700;
    const holdMs = 1700;
    const cycleMs = buildMs + CAPTIONS.length * holdMs + 900;
    const cx = (NX * BAY_X) / 2;
    const cy = (NY * BAY_Y) / 2;
    const cz = (storeys * STOREY) / 2 - 0.6;
    const light: Vec = normalize([-0.45, -0.7, 0.85]);
    let raf = 0;
    let start = performance.now();
    let lastPhase = -2;
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
      let t = reduced ? buildMs + holdMs * (CAPTIONS.length - 1) : now - start;
      if (loop && t > cycleMs) {
        start = now;
        t = 0;
      }
      const ph = t < buildMs ? -1 : Math.min(CAPTIONS.length - 1, Math.floor((t - buildMs) / holdMs));
      if (ph !== lastPhase) {
        lastPhase = ph;
        setPhase(ph);
      }
      const active = ph >= 0 ? CAPTIONS[ph]!.kind : null;
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
        const p = ease((t - b.order * step) / (520 / speed));
        if (p <= 0) continue;
        let { z, h } = b;
        let lift = 0;
        if (b.kind === "column" || b.kind === "core") h = b.h * p;
        else if (b.kind === "slab" || b.kind === "beam") lift = (1 - p) * 1.6;
        else lift = -(1 - p) * 0.8;
        z += lift;
        const corners: Vec[] = [
          [b.x, b.y, z], [b.x + b.w, b.y, z], [b.x + b.w, b.y + b.d, z], [b.x, b.y + b.d, z],
          [b.x, b.y, z + h], [b.x + b.w, b.y, z + h], [b.x + b.w, b.y + b.d, z + h], [b.x, b.y + b.d, z + h],
        ];
        const proj = corners.map(project);
        const lit = active === "all" ? b.kind !== "core" : active === b.kind || (active === "column" && b.kind === "core");
        const color = lit ? palette.lit : palette.base;
        for (const face of FACES) {
          if (dot(face.n, viewDir) > 0.02) continue;
          const shade = 0.62 + 0.38 * Math.max(0, dot(face.n, light));
          const alpha = (lit ? palette.litAlpha : palette.alpha) * Math.min(1, p * 1.4);
          polys.push({
            pts: face.idx.map((i) => [proj[i]![0], proj[i]![1]]),
            depth: face.idx.reduce((s, i) => s + proj[i]![2], 0) / 4,
            fill: `rgba(${Math.round(color[0] * shade)},${Math.round(color[1] * shade)},${Math.round(color[2] * shade)},${alpha.toFixed(3)})`,
          });
        }
      }
      polys.sort((a, b) => b.depth - a.depth);
      ctx.clearRect(0, 0, width, height);
      ctx.lineJoin = "round";
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = palette.edge;
      for (const poly of polys) {
        ctx.beginPath();
        ctx.moveTo(poly.pts[0]![0], poly.pts[0]![1]);
        for (let i = 1; i < poly.pts.length; i++) ctx.lineTo(poly.pts[i]![0], poly.pts[i]![1]);
        ctx.closePath();
        ctx.fillStyle = poly.fill;
        ctx.fill();
        ctx.stroke();
      }
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
      {caption ? (
        <div className="iso-caption" aria-live="polite">
          <div className="iso-steps" aria-hidden="true">
            {CAPTIONS.map((c, i) => (
              <span key={c.text} className={i === phase ? "on" : i < phase ? "done" : ""} />
            ))}
          </div>
          <span key={phase} className="iso-caption-text">
            {phase >= 0 ? CAPTIONS[phase]!.text : "Reading the drawings"}
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
