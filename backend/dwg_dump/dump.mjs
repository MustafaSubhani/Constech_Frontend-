// Headless DWG reader. Keeps closed shapes, text, hatches, and expanded
// block inserts as JSON. Does not rasterize. LibreDWG only, no ODA.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { LibreDwg, Dwg_File_Type } from "@mlightcad/libredwg-web";

const require = createRequire(import.meta.url);
const wasmDir = join(dirname(require.resolve("@mlightcad/libredwg-web")), "..", "wasm");

function round(n) {
  return Math.round(n * 1000) / 1000;
}

function pt(p) {
  if (!p) return null;
  return [round(p.x), round(p.y)];
}

/** Strip AutoCAD MTEXT control codes so schedule cells are plain text. */
export function cleanText(raw) {
  if (!raw) return "";
  let s = String(raw);
  s = s.replace(/\\~/g, " ");
  // \P is a new paragraph. It must not swallow \pxxxx; font commands.
  s = s.replace(/\\P(?![A-Za-z])/g, "\n");
  s = s.replace(/%%([dDcCpP])/g, (_, ch) => {
    const map = { d: "°", D: "°", c: "Ø", C: "Ø", p: "±", P: "±" };
    return map[ch] || "";
  });
  // Font, height, colour, width, tracking, stacking: \f...; \H...; \C...;
  s = s.replace(/\\[A-Za-z][^;\\]*;/g, "");
  s = s.replace(/[{}]/g, "");
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
}

function isClosed(flag) {
  return ((flag || 0) & 1) !== 0 || ((flag || 0) & 512) !== 0;
}

function transformPoint(x, y, insert, base) {
  const sx = insert.xScale || 1;
  const sy = insert.yScale || 1;
  const r = insert.rotation || 0;
  const dx = (x - (base?.x || 0)) * sx;
  const dy = (y - (base?.y || 0)) * sy;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const ix = insert.insertionPoint?.x || 0;
  const iy = insert.insertionPoint?.y || 0;
  return [round(ix + dx * c - dy * s), round(iy + dx * s + dy * c)];
}

function polylineRecord(ent, xf) {
  const verts = (ent.vertices || []).map((v) => (xf ? xf(v.x, v.y) : pt(v)));
  if (verts.length < 2) return null;
  return {
    kind: "polyline",
    layer: ent.layer || "",
    closed: isClosed(ent.flag),
    vertices: verts,
  };
}

function lineRecord(ent, xf) {
  const a = ent.startPoint;
  const b = ent.endPoint;
  if (!a || !b) return null;
  const p1 = xf ? xf(a.x, a.y) : pt(a);
  const p2 = xf ? xf(b.x, b.y) : pt(b);
  return { kind: "line", layer: ent.layer || "", x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] };
}

function textRecord(ent, xf) {
  const raw = ent.text || "";
  const p = ent.insertionPoint || ent.startPoint;
  if (!p) return null;
  const xy = xf ? xf(p.x, p.y) : pt(p);
  return {
    kind: "text",
    layer: ent.layer || "",
    text: cleanText(raw),
    raw,
    x: xy[0],
    y: xy[1],
    height: round(ent.textHeight || ent.height || 0),
  };
}

function hatchLoops(ent, xf) {
  const loops = [];
  for (const path of ent.boundaryPaths || []) {
    if (path.vertices) {
      const vertices = path.vertices.map((v) => (xf ? xf(v.x, v.y) : pt(v)));
      if (vertices.length >= 3) loops.push({ closed: path.isClosed !== false, vertices });
      continue;
    }
    const vertices = [];
    for (const edge of path.edges || []) {
      if (!edge || edge.type !== 1 || !edge.start || !edge.end) continue;
      {
        const a = xf ? xf(edge.start.x, edge.start.y) : pt(edge.start);
        if (!vertices.length) vertices.push(a);
        vertices.push(xf ? xf(edge.end.x, edge.end.y) : pt(edge.end));
      }
    }
    if (vertices.length >= 3) loops.push({ closed: true, vertices });
  }
  return loops;
}

function hatchRecord(ent, xf) {
  const loops = hatchLoops(ent, xf);
  if (!loops.length) return null;
  return {
    kind: "hatch",
    layer: ent.layer || "",
    pattern: ent.patternName || "",
    solid: ent.solidFill === 1,
    loops,
  };
}

function convertEntity(ent, xf) {
  if (!ent || ent.isVisible === false) return [];
  if (ent.type === "LWPOLYLINE" || ent.type === "POLYLINE") {
    const rec = polylineRecord(ent, xf);
    return rec ? [rec] : [];
  }
  if (ent.type === "LINE") {
    const rec = lineRecord(ent, xf);
    return rec ? [rec] : [];
  }
  if (ent.type === "MTEXT" || ent.type === "TEXT") {
    const rec = textRecord(ent, xf);
    return rec && rec.text ? [rec] : [];
  }
  if (ent.type === "HATCH") {
    const rec = hatchRecord(ent, xf);
    return rec ? [rec] : [];
  }
  return [];
}

function blockMap(database) {
  const table = database.tables?.BLOCK_RECORD;
  const entries = table?.entries || [];
  const map = new Map();
  for (const block of entries) {
    if (block?.name) map.set(block.name, block);
  }
  return map;
}

function expandInsert(insert, blocks, out, stack) {
  const name = insert.name;
  if (!name || stack.has(name)) return;
  const block = blocks.get(name);
  if (!block) return;
  stack.add(name);
  const base = block.basePoint;
  const xf = (x, y) => transformPoint(x, y, insert, base);
  for (const ent of block.entities || []) {
    if (ent.type === "INSERT") {
      // Nested insert: transform its insertion point into the parent, then expand.
      const ip = ent.insertionPoint || { x: 0, y: 0 };
      const [nx, ny] = xf(ip.x, ip.y);
      const nested = {
        ...ent,
        insertionPoint: { x: nx, y: ny, z: 0 },
        rotation: (ent.rotation || 0) + (insert.rotation || 0),
        xScale: (ent.xScale || 1) * (insert.xScale || 1),
        yScale: (ent.yScale || 1) * (insert.yScale || 1),
      };
      expandInsert(nested, blocks, out, stack);
      continue;
    }
    for (const rec of convertEntity(ent, xf)) {
      rec.source = "insert";
      rec.block = name;
      rec.insertLayer = insert.layer || "";
      rec.insertX = round(insert.insertionPoint?.x || 0);
      rec.insertY = round(insert.insertionPoint?.y || 0);
      out.push(rec);
    }
  }
  stack.delete(name);
}

export function databaseToDump(database, file) {
  const entities = [];
  const blocks = blockMap(database);
  let inserts = 0;
  let insertsExpanded = 0;
  for (const ent of database.entities || []) {
    if (ent.type === "INSERT") {
      inserts += 1;
      const before = entities.length;
      expandInsert(ent, blocks, entities, new Set());
      if (entities.length > before) insertsExpanded += 1;
      entities.push({
        kind: "insert",
        layer: ent.layer || "",
        block: ent.name || "",
        x: round(ent.insertionPoint?.x || 0),
        y: round(ent.insertionPoint?.y || 0),
        rotation: round(ent.rotation || 0),
        xScale: ent.xScale || 1,
        yScale: ent.yScale || 1,
      });
      continue;
    }
    for (const rec of convertEntity(ent, null)) {
      rec.source = "model";
      entities.push(rec);
    }
  }
  return { file, entities, inserts, insertsExpanded };
}

export function summarize(dump) {
  const lines = [];
  const byKind = new Map();
  for (const e of dump.entities) byKind.set(e.kind, (byKind.get(e.kind) || 0) + 1);
  lines.push(`file ${dump.file}`);
  lines.push(`entities ${dump.entities.length} inserts ${dump.inserts} expanded ${dump.insertsExpanded}`);
  lines.push(`kinds ${[...byKind.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`);
  const layers = new Map();
  for (const e of dump.entities) {
    if (e.kind !== "polyline") continue;
    const key = `${e.source === "insert" ? "insert" : "model"} ${e.layer}`;
    if (!layers.has(key)) layers.set(key, { closed: 0, open: 0 });
    layers.get(key)[e.closed ? "closed" : "open"] += 1;
  }
  const rows = [...layers.entries()].sort((a, b) => (b[1].closed + b[1].open) - (a[1].closed + a[1].open));
  for (const [key, n] of rows) {
    if (n.closed + n.open < 1) continue;
    lines.push(`  poly ${key}: closed=${n.closed} open=${n.open}`);
  }
  return lines.join("\n");
}

function readDwgBytes(path) {
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export async function dumpFile(dwgPath) {
  const lib = await LibreDwg.create(wasmDir.replaceAll("\\", "/"));
  const ptr = lib.dwg_read_data(readDwgBytes(dwgPath), Dwg_File_Type.DWG);
  if (!ptr) throw new Error(`LibreDWG could not read ${dwgPath}`);
  try {
    const { database, stats } = lib.convertEx(ptr);
    const dump = databaseToDump(database, dwgPath);
    dump.unknownEntities = stats?.unknownEntityCount ?? 0;
    return dump;
  } finally {
    lib.dwg_free(ptr);
  }
}

const invoked = (process.argv[1] || "").replaceAll("\\", "/").endsWith("/dump.mjs");

if (invoked) {
  const [dwgPath, jsonPath] = process.argv.slice(2);
  if (!dwgPath || !jsonPath) {
    console.error("usage: node dump.mjs <file.dwg> <out.json>");
    process.exit(1);
  }
  const dump = await dumpFile(dwgPath);
  writeFileSync(jsonPath, JSON.stringify(dump));
  console.log(summarize(dump));
  console.log(`wrote ${jsonPath}`);
}
