"""The takeoff workspace page. The sheet fills the middle. Detections sit on it."""

PAGE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Takeoff workspace</title>
<style>
  :root {
    --ink: #1c1917;
    --muted: #78716c;
    --line: #e7e5e4;
    --paper: #fafaf9;
    --stage: #d6d3d1;
    --green: #166534;
    --green-bg: #ecfdf3;
    --amber: #9a3412;
    --amber-bg: #fff7ed;
    --red: #991b1b;
    --red-bg: #fef2f2;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    font: 13px/1.4 "Segoe UI", sans-serif;
    color: var(--ink);
    background: var(--paper);
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }
  header {
    height: 48px;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line);
    background: white;
    flex: none;
  }
  header strong { font-size: 14px; }
  header span { color: var(--muted); }
  header button {
    margin-left: auto;
    border: 1px solid var(--line);
    background: white;
    border-radius: 8px;
    padding: 5px 10px;
    font: inherit;
    cursor: pointer;
  }
  .body { flex: 1; display: flex; min-height: 0; }
  aside.sheets {
    width: 200px;
    border-right: 1px solid var(--line);
    overflow: auto;
    padding: 10px;
    background: #fff;
    flex: none;
  }
  aside.sheets button {
    display: block;
    width: 100%;
    text-align: left;
    border: 1px solid transparent;
    background: transparent;
    border-radius: 8px;
    padding: 8px 10px;
    margin-bottom: 4px;
    font: inherit;
    cursor: pointer;
  }
  aside.sheets button.active { background: #f5f5f4; border-color: var(--line); }
  aside.sheets small { display: block; color: var(--muted); }
  .stage {
    flex: 1;
    position: relative;
    background: var(--stage);
    overflow: hidden;
    cursor: grab;
  }
  .stage.dragging { cursor: grabbing; }
  .world { position: absolute; transform-origin: 0 0; }
  .world img { display: block; user-select: none; pointer-events: none; }
  .world svg { position: absolute; left: 0; top: 0; }
  polygon {
    fill-opacity: 0.28;
    stroke-width: 2.5px;
    vector-effect: non-scaling-stroke;
    cursor: pointer;
  }
  polygon.dim { fill-opacity: 0.06; stroke-opacity: 0.35; }
  polygon.on {
    fill-opacity: 0.55;
    stroke: #111;
    stroke-width: 4px;
    filter: drop-shadow(0 0 2px #fff);
  }
  aside.list {
    width: 280px;
    border-left: 1px solid var(--line);
    background: #fff;
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: none;
  }
  aside.list h2 {
    margin: 0;
    padding: 12px 12px 8px;
    font-size: 12px;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .scroll { overflow: auto; flex: 1; }
  .item {
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
    cursor: pointer;
    display: flex;
    gap: 8px;
    align-items: stretch;
  }
  .item:hover, .item.on { background: #f5f5f4; }
  .swatch { width: 8px; border-radius: 4px; flex: none; }
  .item .name { flex: 1; }
  .compare {
    flex: none;
    height: 280px;
    border-top: 1px solid var(--line);
    background: white;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .compare header {
    height: 36px;
    padding: 0 12px;
    font-size: 12px;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .compare .scroll { overflow: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
  th {
    position: sticky;
    top: 0;
    background: #fafaf9;
    font-size: 11px;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: 650;
  }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.section td {
    background: #f5f5f4;
    font-weight: 650;
    font-size: 12px;
    letter-spacing: .03em;
    text-transform: uppercase;
    color: var(--muted);
  }
  tr.close td { background: var(--green-bg); }
  tr.near td { background: var(--amber-bg); }
  tr.far td { background: var(--red-bg); }
  .close { color: var(--green); }
  .near { color: var(--amber); }
  .far { color: var(--red); }
  .note { color: var(--muted); font-size: 12px; max-width: 360px; }
  .hint { padding: 12px; color: var(--muted); }
  .group {
    padding: 10px 12px 4px;
    font-size: 11px;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .caption {
    position: absolute;
    left: 12px;
    top: 12px;
    z-index: 2;
    display: none;
    background: white;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 6px 10px;
    pointer-events: none;
  }
  .caption.show { display: block; }
  .register {
    padding: 10px 12px;
    border-bottom: 1px solid var(--line);
    background: #fafaf9;
    font-size: 12px;
  }
  .register h3 {
    margin: 0 0 8px;
    font-size: 11px;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: 650;
  }
  .caps { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .cap {
    border-radius: 999px;
    padding: 3px 8px;
    border: 1px solid var(--line);
    background: white;
    max-width: 100%;
  }
  .cap.ready { border-color: #bbf7d0; background: var(--green-bg); }
  .cap.partial { border-color: #fed7aa; background: var(--amber-bg); }
  .cap.blocked { border-color: #fecaca; background: var(--red-bg); }
  .cap b { font-weight: 650; }
  .register .meta { color: var(--muted); }
  .review-item {
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
    cursor: pointer;
    font-size: 12px;
  }
  .review-item.error { border-left: 3px solid var(--red); }
  .review-item.warning { border-left: 3px solid var(--amber); }
  .review-item.info { border-left: 3px solid #94a3b8; }
  .review-item:hover { background: #f5f5f4; }
  .detail { padding: 8px 12px; font-size: 12px; color: var(--ink); }
  .detail dl { margin: 0; }
  .detail dt { color: var(--muted); margin-top: 6px; }
  .manual { padding: 8px 12px; border-top: 1px solid var(--line); }
  .manual input, .manual textarea {
    width: 100%;
    margin: 4px 0 8px;
    font: inherit;
    padding: 6px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
  }
  .manual button {
    width: 100%;
    padding: 8px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: white;
    cursor: pointer;
    font: inherit;
  }
</style>
</head>
<body>
<header>
  <strong id="title">Takeoff</strong>
  <span id="sheet-name"></span>
  <button id="fit" type="button">Fit sheet</button>
</header>
<div class="body">
  <aside class="sheets" id="sheets"></aside>
  <div class="stage" id="stage">
    <div class="caption" id="caption"></div>
    <div class="world" id="world">
      <img id="img" alt="">
      <svg id="svg"></svg>
    </div>
  </div>
  <aside class="list">
    <h2>Detected on this sheet</h2>
    <div class="scroll" id="panel" style="max-height:35%"></div>
    <h2>Review queue</h2>
    <div class="scroll" id="review" style="max-height:25%"></div>
    <h2>Provenance</h2>
    <div class="detail" id="measurement-detail"><p class="hint">Select a shape or review item.</p></div>
    <div class="manual">
      <strong>Add manual quantity</strong>
      <input id="m-tag" placeholder="Tag (e.g. F9)">
      <input id="m-sheet" placeholder="Sheet stem">
      <input id="m-m3" type="number" step="0.001" placeholder="Concrete m³">
      <textarea id="m-reason" rows="2" placeholder="Reason / source"></textarea>
      <button type="button" id="m-save">Save manual entry</button>
    </div>
  </aside>
</div>
<section class="compare">
  <header>Quantity comparison · bill · Courtyard · engine</header>
  <div class="register" id="register"></div>
  <div class="scroll" id="compare"></div>
</section>
<script>
const state = { data: null, sheet: 0, selected: null, scale: 0.2, x: 40, y: 40 };
const BILL_ORDER = [
  "footing_m3", "footing_m2", "footing_kg",
  "raft_m3", "raft_m2", "raft_kg",
  "blinding_m3",
  "sog_m3", "sog_kg",
  "column_m3", "column_m2",
  "grade_beam_m3",
  "suspended_m2", "suspended_kg", "suspended_m3",
  "grade_beam_m2",
  "beam_m3", "beam_m2",
  "neck_m3", "neck_m2", "neck_kg",
  "tank_wall_m3", "lift_pit_wall_m3",
  "shear_wall_m3", "core_wall_m3", "upstand_m3",
  "column_kg", "grade_beam_kg",
];
const KIND_NAME = {
  footing: "Footings",
  missed: "Footings not in the schedule",
  raft: "Rafts",
  column: "Columns",
  wall: "Walls",
  slab: "Slabs",
  beam: "Beams",
};

function band(pct) {
  if (pct === null || pct === undefined || pct === "") return "open";
  const n = Math.abs(Number(pct));
  if (Number.isNaN(n)) return "open";
  if (n <= 5) return "close";
  if (n <= 15) return "near";
  return "far";
}
function fmt(v, d) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
}
function signed(v, d) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  const text = fmt(Math.abs(n), d);
  if (n > 0) return "+" + text;
  if (n < 0) return "−" + text;
  return text;
}

function apply() {
  document.getElementById("world").style.transform =
    `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
}

function fit() {
  const sheet = state.data.sheets[state.sheet];
  const stage = document.getElementById("stage");
  state.scale = Math.min(stage.clientWidth / sheet.width, stage.clientHeight / sheet.height) * 0.96;
  state.x = (stage.clientWidth - sheet.width * state.scale) / 2;
  state.y = (stage.clientHeight - sheet.height * state.scale) / 2;
  apply();
}

function focusShape(shape) {
  const xs = shape.points.map(p => p[0]);
  const ys = shape.points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 40);
  const h = Math.max(maxY - minY, 40);
  const stage = document.getElementById("stage");
  const pad = 120;
  state.scale = Math.min(3, Math.max(0.15, Math.min(
    (stage.clientWidth - pad) / w,
    (stage.clientHeight - pad) / h
  )));
  state.x = stage.clientWidth / 2 - ((minX + maxX) / 2) * state.scale;
  state.y = stage.clientHeight / 2 - ((minY + maxY) / 2) * state.scale;
  apply();
}

function showMeasurement(mid) {
  const el = document.getElementById("measurement-detail");
  if (!mid || !state.data.measurements) {
    el.innerHTML = '<p class="hint">Select a shape or review item.</p>';
    return;
  }
  const m = state.data.measurements.find(x => x.id === mid);
  if (!m) {
    el.innerHTML = `<p class="hint">No record for ${mid}</p>`;
    return;
  }
  const q = m.quantities || {};
  const src = (m.sources || []).map(s => `${s.role}: ${s.detail || s.sheet || ""}`).join("<br>");
  el.innerHTML = `<dl>
    <dt>${m.tag} · ${m.element_type} · ${m.status}</dt>
    <dd>${m.formula || "—"}</dd>
    <dt>Quantities</dt>
    <dd>m³ ${fmt(q.concrete_m3, 3)} · m² ${fmt(q.formwork_m2, 2)} · kg ${fmt(q.rebar_kg, 1)}</dd>
    <dt>Inputs</dt>
    <dd>${JSON.stringify(m.inputs || {})}</dd>
    <dt>Sources</dt>
    <dd>${src || "—"}</dd>
    <dt>Note</dt>
    <dd>${m.note || "—"}</dd>
  </dl>`;
}

function selectShape(id) {
  state.selected = id;
  const sheet = state.data.sheets[state.sheet];
  const shape = sheet.shapes.find(s => s.id === id);
  const caption = document.getElementById("caption");
  caption.textContent = shape ? shape.label : "";
  caption.classList.toggle("show", Boolean(shape));
  if (shape && shape.measurement_id) showMeasurement(shape.measurement_id);
  draw();
  renderPanel();
  if (shape) focusShape(shape);
  const row = document.querySelector(`.item[data-id="${CSS.escape(id)}"]`);
  if (row) row.scrollIntoView({ block: "nearest" });
}

function draw() {
  const sheet = state.data.sheets[state.sheet];
  document.getElementById("sheet-name").textContent = sheet.title;
  const img = document.getElementById("img");
  if (img.getAttribute("src") !== sheet.image) img.src = sheet.image;
  img.width = sheet.width;
  img.height = sheet.height;
  const svg = document.getElementById("svg");
  svg.setAttribute("width", sheet.width);
  svg.setAttribute("height", sheet.height);
  svg.setAttribute("viewBox", `0 0 ${sheet.width} ${sheet.height}`);
  const chosen = state.selected;
  svg.innerHTML = sheet.shapes.map(shape => {
    const pts = shape.points.map(p => p.join(",")).join(" ");
    const on = chosen === shape.id;
    const cls = on ? "on" : (chosen ? "dim" : "");
    const dash = shape.dashed ? ' stroke-dasharray="8 5"' : "";
    return `<polygon data-id="${shape.id}" class="${cls}" points="${pts}" fill="${shape.color}" stroke="${shape.color}"${dash}></polygon>`;
  }).join("");
  document.getElementById("sheets").querySelectorAll("button").forEach((btn, i) => {
    btn.classList.toggle("active", i === state.sheet);
  });
}

function renderSheets() {
  document.getElementById("sheets").innerHTML = state.data.sheets.map((sheet, i) =>
    `<button type="button" data-i="${i}"><b>${sheet.title}</b><small>${sheet.shapes.length} detected</small></button>`
  ).join("");
  document.getElementById("sheets").querySelectorAll("button").forEach(btn => {
    btn.onclick = () => {
      state.sheet = Number(btn.dataset.i);
      state.selected = null;
      document.getElementById("caption").classList.remove("show");
      draw();
      fit();
      renderPanel();
    };
  });
}

function renderPanel() {
  const sheet = state.data.sheets[state.sheet];
  const panel = document.getElementById("panel");
  const groups = [];
  sheet.shapes.forEach(shape => {
    const name = KIND_NAME[shape.kind] || "Other";
    let group = groups.find(item => item.name === name);
    if (!group) {
      group = { name, shapes: [] };
      groups.push(group);
    }
    group.shapes.push(shape);
  });
  panel.innerHTML = groups.map(group =>
    `<div class="group">${group.name} · ${group.shapes.length}</div>` +
    group.shapes.map(shape =>
      `<div class="item${state.selected === shape.id ? " on" : ""}" data-id="${shape.id}">
        <div class="swatch" style="background:${shape.color}"></div>
        <div class="name">${shape.label}</div>
      </div>`
    ).join("")
  ).join("") || '<p class="hint">Nothing detected on this sheet.</p>';
  panel.querySelectorAll(".item").forEach(el => {
    el.onclick = () => selectShape(el.dataset.id);
  });
}

function ordered(rows) {
  const rank = key => {
    const index = BILL_ORDER.indexOf(key);
    return index === -1 ? BILL_ORDER.length : index;
  };
  return rows.slice().sort((a, b) => rank(a.key) - rank(b.key));
}

function renderReview() {
  const items = state.data.review_queue || [];
  const el = document.getElementById("review");
  if (!items.length) {
    el.innerHTML = '<p class="hint">Nothing flagged for review.</p>';
    return;
  }
  el.innerHTML = items.map(item => {
    const sev = item.severity || "info";
    const tag = item.tag ? ` · ${item.tag}` : "";
    return `<div class="review-item ${sev}" data-mid="${item.measurement_id || ""}" data-sheet="${item.sheet || ""}">
      <b>${item.kind}</b>${tag}<br><span class="hint">${item.message || ""}</span>
    </div>`;
  }).join("");
  el.querySelectorAll(".review-item").forEach(node => {
    node.onclick = () => {
      const mid = node.dataset.mid;
      if (mid) showMeasurement(mid);
      const sheetId = node.dataset.sheet;
      const idx = state.data.sheets.findIndex(s => s.id === sheetId);
      if (idx >= 0) {
        state.sheet = idx;
        state.selected = null;
        draw();
        fit();
        renderPanel();
      }
    };
  });
}

function renderRegister() {
  const m = state.data.manifest || {};
  const el = document.getElementById("register");
  if (!m.capabilities || !m.capabilities.length) {
    el.innerHTML = '<p class="meta">No drawing register yet. Run <code>discover</code> or open workspace again to build project-manifest.json.</p>';
    return;
  }
  const caps = m.capabilities.map(cap =>
    `<span class="cap ${cap.status}" title="${cap.reason.replace(/"/g, "&quot;")}"><b>${cap.id}</b> · ${cap.status}</span>`
  ).join("");
  const pairs = (m.plan_reinf_pairs || []).filter(p => p.plan).length;
  el.innerHTML = `<h3>Drawing register</h3>
    <div class="caps">${caps}</div>
    <p class="meta">${m.drawing_count || "—"} sheets · ${pairs} plan↔reinf pairs${m.bill_workbook ? " · bill " + m.bill_workbook : ""}</p>`;
}

function renderCompare() {
  const threeWay = state.data.compare_three_way && (state.data.full_compare || []).length;
  let thead;
  let body;
  if (threeWay) {
    const rows = ordered(state.data.full_compare || []);
    thead = `<tr>
      <th>Item</th><th>Unit</th>
      <th class="num">Bill</th><th class="num">Courtyard</th><th class="num">Ours</th>
      <th class="num">Δ Bill</th><th class="num">%</th>
      <th class="num">Δ Courtyard</th><th class="num">%</th>
      <th>Note</th>
    </tr>`;
    body = rows.map(row => {
      const kind = band(row.pct);
      const kindC = band(row.pct_courtyard);
      return `<tr class="${kind}">
        <td>${row.label}</td>
        <td>${row.unit}</td>
        <td class="num">${fmt(row.bill, row.digits)}</td>
        <td class="num">${fmt(row.courtyard, row.digits)}</td>
        <td class="num">${fmt(row.ours, row.digits)}</td>
        <td class="num ${kind}">${signed(row.difference, row.digits)}</td>
        <td class="num ${kind}">${row.pct === null || row.pct === "" ? "—" : signed(row.pct, 1) + "%"}</td>
        <td class="num ${kindC}">${signed(row.diff_courtyard, row.digits)}</td>
        <td class="num ${kindC}">${row.pct_courtyard === null || row.pct_courtyard === "" ? "—" : signed(row.pct_courtyard, 1) + "%"}</td>
        <td class="note">${row.note || ""}</td>
      </tr>`;
    }).join("");
  } else {
    const sections = [
      ["Foundations", ordered(state.data.foundations || [])],
      ["Rest of the structural bill", ordered(state.data.structure || [])],
    ];
    body = sections.map(([title, rows]) => {
      const head = `<tr class="section"><td colspan="7">${title}</td></tr>`;
      const lines = rows.map(row => {
        const kind = band(row.pct);
        return `<tr class="${kind}">
          <td>${row.label}</td>
          <td>${row.unit}</td>
          <td class="num">${fmt(row.bill, row.digits)}</td>
          <td class="num">${fmt(row.ours, row.digits)}</td>
          <td class="num ${kind}">${signed(row.difference, row.digits)}</td>
          <td class="num ${kind}">${row.pct === null || row.pct === "" ? "—" : signed(row.pct, 1) + "%"}</td>
          <td class="note">${row.note || ""}</td>
        </tr>`;
      }).join("");
      return head + lines;
    }).join("");
    thead = `<tr>
      <th>Item</th><th>Unit</th>
      <th class="num">Bill</th><th class="num">Ours</th>
      <th class="num">Difference</th><th class="num">%</th><th>Note</th>
    </tr>`;
  }
  document.getElementById("compare").innerHTML = `<table>
    <thead>${thead}</thead>
    <tbody>${body}</tbody>
  </table>`;
}

document.getElementById("fit").onclick = fit;

document.getElementById("m-save").onclick = () => {
  const body = {
    tag: document.getElementById("m-tag").value.trim(),
    sheet: document.getElementById("m-sheet").value.trim(),
    reason: document.getElementById("m-reason").value.trim(),
    quantities: { concrete_m3: Number(document.getElementById("m-m3").value) || 0 },
  };
  fetch("/api/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(r => r.json())
    .then(() => fetch("/api/takeoff"))
    .then(r => r.json())
    .then(data => {
      state.data = data;
      renderReview();
      renderRegister();
      alert("Manual entry saved. Refresh totals after re-running foundations if needed.");
    })
    .catch(err => alert(String(err)));
};

const stage = document.getElementById("stage");
let drag = null;
stage.addEventListener("pointerdown", (event) => {
  const poly = event.target.closest && event.target.closest("polygon");
  if (poly) {
    selectShape(poly.dataset.id);
    return;
  }
  drag = { x: event.clientX, y: event.clientY, ox: state.x, oy: state.y, moved: false };
  stage.setPointerCapture(event.pointerId);
});
stage.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) {
    drag.moved = true;
    stage.classList.add("dragging");
  }
  if (!drag.moved) return;
  state.x = drag.ox + dx;
  state.y = drag.oy + dy;
  apply();
});
stage.addEventListener("pointerup", () => {
  drag = null;
  stage.classList.remove("dragging");
});
stage.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = stage.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  const next = Math.min(4, Math.max(0.05, state.scale * (event.deltaY < 0 ? 1.1 : 0.9)));
  state.x = px - (px - state.x) * (next / state.scale);
  state.y = py - (py - state.y) * (next / state.scale);
  state.scale = next;
  apply();
}, { passive: false });

fetch("/api/takeoff").then(r => r.json()).then(data => {
  state.data = data;
  document.getElementById("title").textContent = data.project || "Takeoff";
  renderSheets();
  renderRegister();
  renderReview();
  renderCompare();
  draw();
  fit();
  renderPanel();
  const cur = state.data.sheets[state.sheet];
  if (cur) document.getElementById("m-sheet").value = cur.id;
});
</script>
</body>
</html>
"""
