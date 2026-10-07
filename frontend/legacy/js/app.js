(function () {
  const api = window.BOQ_API;
  const KIND = {
    footing: { name: "Footings", color: "#2B0266" },
    raft: { name: "Rafts", color: "#6D28A8" },
    missed: { name: "Not in the schedule", color: "#9B2C2C" },
    column: { name: "Columns", color: "#1F6B82" },
    wall: { name: "Walls", color: "#2E8F79" },
    slab: { name: "Slabs", color: "#A6844A" },
    beam: { name: "Beams", color: "#3C3A66" },
  };
  const KIND_ORDER = ["footing", "raft", "missed", "column", "wall", "slab", "beam"];

  const state = {
    route: "projects",
    projectId: null,
    sheetId: null,
    selected: null,
    filter: "all",
    panel: true,
    scale: 0,
    x: 24,
    y: 24,
    query: "",
    compareOpen: true,
    compareBand: "all",
    busy: null,
  };

  let drag = null;
  let toastTimer = 0;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
    });
  }

  function project() {
    return state.projectId ? api.get(state.projectId) : null;
  }

  function sheetsWithShapes(item) {
    return (item.sheets || []).filter(function (sheet) {
      return sheet.shapes && sheet.shapes.length;
    });
  }

  function currentSheet() {
    const item = project();
    if (!item) return null;
    const drawn = sheetsWithShapes(item);
    return drawn.find(function (sheet) { return sheet.id === state.sheetId; }) || drawn[0] || null;
  }

  function sheetRasterUrl(sheet) {
    if (!sheet) return "";
    if (sheet.image) return sheet.image;
    const item = project();
    if (!item || !sheet.id) return "";
    return "/api/projects/" + encodeURIComponent(item.id) + "/sheets/" + encodeURIComponent(sheet.id + ".png");
  }

  function bandOf(row) {
    if (row.bill == null || row.ours == null || !row.bill) return "open";
    const pct = Math.abs((row.ours - row.bill) / row.bill * 100);
    if (pct <= 5) return "close";
    if (pct <= 15) return "near";
    return "far";
  }

  function pctOf(row) {
    if (row.bill == null || row.ours == null || !row.bill) return null;
    return (row.ours - row.bill) / row.bill * 100;
  }

  function tally(rows) {
    const bands = { close: 0, near: 0, far: 0 };
    (rows || []).forEach(function (row) {
      const band = bandOf(row);
      if (bands[band] != null) bands[band] += 1;
    });
    return bands;
  }

  function fmt(value, digits) {
    if (value == null || value === "") return "—";
    return Number(value).toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function signed(value, digits) {
    if (value == null || Number.isNaN(value)) return "—";
    const text = fmt(Math.abs(value), digits);
    if (value > 0) return "+" + text;
    if (value < 0) return "−" + text;
    return text;
  }

  var THEME_KEY = "constech.theme";

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    var toggle = document.getElementById("theme-toggle");
    if (!toggle) return;
    var dark = theme === "dark";
    toggle.setAttribute("aria-pressed", dark ? "true" : "false");
    toggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }

  function toast(message) {
    const el = document.getElementById("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 3200);
  }

  function hashFor(route, id) {
    if (!id || route === "projects") return "#/projects";
    if (route === "bill" || route === "register") return "#/p/" + encodeURIComponent(id) + "/" + route;
    return "#/p/" + encodeURIComponent(id);
  }

  let loaderJob = null;
  let loaderStarted = 0;
  let hideTimer = 0;

  function showLoader() {
    if (loaderJob) return;
    const el = document.getElementById("loader");
    el.hidden = false;
    el.classList.remove("out");
    loaderStarted = performance.now();
    loaderJob = {
      reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
  }

  function hideLoader() {
    const el = document.getElementById("loader");
    if (!loaderJob) return;
    const job = loaderJob;
    const min = job.reduced ? 120 : 700;
    const wait = Math.max(0, min - (performance.now() - loaderStarted));
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      el.classList.add("out");
      setTimeout(function () {
        el.hidden = true;
        el.classList.remove("out");
        loaderJob = null;
      }, job.reduced ? 0 : 260);
    }, wait);
  }

  function playTabShift() {
    const main = document.getElementById("main");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    main.classList.remove("tab-in");
    if (reduced) return;
    void main.offsetWidth;
    main.classList.add("tab-in");
  }

  function reveal() {
    const fromRoute = state.route;
    const fromProject = state.projectId;
    readHash();
    const tabs = fromRoute === "drawings" || fromRoute === "bill" || fromRoute === "register";
    const nextTab = state.route === "drawings" || state.route === "bill" || state.route === "register";
    if (tabs && nextTab && fromProject === state.projectId) {
      playTabShift();
      render();
      return;
    }
    showLoader();
    render();
    hideLoader();
  }

  function navigate(route, id) {
    const next = hashFor(route, id == null ? state.projectId : id);
    if (location.hash === next) render();
    else location.hash = next;
  }

  function readHash() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const previous = state.projectId;
    if (parts[0] === "p" && parts[1]) {
      state.projectId = parts[1];
      state.route = parts[2] === "bill" || parts[2] === "register" ? parts[2] : "drawings";
      if (previous !== state.projectId) {
        state.sheetId = null;
        state.selected = null;
        state.filter = "all";
        state.scale = 0;
        state.query = "";
        state.compareBand = "all";
      }
    } else {
      state.route = "projects";
      state.projectId = null;
    }
  }

  function countUp() {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelectorAll("#login [data-count]").forEach(function (el, index) {
      const target = Number(el.dataset.count);
      const digits = Number(el.dataset.digits || 0);
      const show = function (value) {
        el.textContent = value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
      };
      if (still) {
        show(target);
        return;
      }
      show(0);
      const start = performance.now() + 3200 + index * 400;
      const span = 1500;
      function tick(now) {
        const t = Math.min(1, Math.max(0, (now - start) / span));
        show(target * (1 - Math.pow(1 - t, 3)));
        if (t < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  function showLogin() {
    const login = document.getElementById("login");
    login.classList.remove("leaving");
    login.hidden = false;
    document.getElementById("app").hidden = true;
    countUp();
  }

  function shake() {
    const card = document.getElementById("login-form");
    card.classList.remove("shake");
    void card.offsetWidth;
    card.classList.add("shake");
  }

  function render() {
    const user = api.session();
    if (!user) {
      showLogin();
      return;
    }
    document.getElementById("login").hidden = true;
    document.getElementById("app").hidden = false;
    const item = project();
    const sub = document.getElementById("subbar");
    if (!item || state.route === "projects") {
      sub.hidden = true;
      sub.innerHTML = "";
      renderProjects();
      return;
    }
    sub.hidden = false;
    renderSubbar(item);
    if (state.route === "bill") renderBill(item);
    else if (state.route === "register") renderRegister(item);
    else renderWorkspace(item);
  }

  function renderSubbar(item) {
    const runs = item.runs || {};
    function runButton(kind, label) {
      const busy = state.busy === kind;
      const done = runs[kind] ? " · done" : "";
      return '<button class="btn ' + (kind === "structure" ? "btn-primary" : "btn-ghost") + '" type="button" data-action="run" data-run="' + kind + '"' + (state.busy ? " disabled" : "") + ">" + (busy ? "Reading drawings…" : label + done) + "</button>";
    }
    document.getElementById("subbar").innerHTML =
      '<div class="crumbs"><button class="btn-text" type="button" data-action="projects">Projects</button><strong>' + esc(item.name) + "</strong></div>" +
      '<nav class="tabs">' +
        tab("drawings", "Drawings") +
        tab("bill", "Bill") +
        tab("register", "Register") +
      "</nav>" +
      '<div class="actions">' +
        runButton("discover", "Discover") +
        runButton("foundations", "Foundations") +
        runButton("structure", "Structure") +
      "</div>";
  }

  function tab(route, label) {
    const active = state.route === route || (route === "drawings" && state.route === "drawings");
    return '<button type="button" data-action="tab" data-tab="' + route + '" class="' + (state.route === route ? "active" : "") + '">' + label + "</button>";
  }

  function renderProjects() {
    const cards = api.list().map(function (item) {
      const caps = (item.capabilities || []).slice(0, 4).map(function (cap) {
        return '<span class="cap ' + esc(cap.status) + '">' + esc(cap.id) + "</span>";
      }).join("");
      const bands = item.compared
        ? '<div class="bands"><span class="band close">' + item.close + ' within 5%</span><span class="band near">' + item.near + ' within 15%</span><span class="band far">' + item.far + " further</span></div>"
        : '<div class="meta">No bill comparison yet</div>';
      return '<article class="card"><div><h2>' + esc(item.name) + '</h2><p class="place">' + esc(item.place) + '</p></div>' +
        '<div class="meta">' + item.drawings + " drawings · " + (item.bill ? esc(item.bill) : "No bill yet") + "</div>" +
        '<div class="caps">' + (caps || '<span class="cap">Waiting for discover</span>') + "</div>" +
        bands +
        '<button class="btn btn-primary" type="button" data-action="open" data-id="' + esc(item.id) + '">Open takeoff</button></article>';
    }).join("");
    document.getElementById("main").innerHTML =
      '<section class="projects"><div class="projects-head"><div><h1>Projects</h1><p>Open a drawing set to review the measured quantities.</p></div>' +
      '<button class="btn btn-ghost" type="button" data-action="new-project">New project</button></div><div class="cards">' +
      cards + "</div></section>";
  }

  function renderWorkspace(item) {
    const drawn = sheetsWithShapes(item);
    const sheet = currentSheet();
    if (sheet) state.sheetId = sheet.id;
    if (!drawn.length) {
      document.getElementById("main").innerHTML =
        '<section class="bill"><div class="empty"><h2>No outlines on these sheets yet</h2><p>Discover reads the drawing set. Foundations and Structure measure the quantities and draw them here.</p></div></section>';
      return;
    }
    const buttons = drawn.map(function (entry) {
      return '<button class="sheet-btn' + (entry.id === sheet.id ? " active" : "") + '" type="button" data-action="sheet" data-id="' + esc(entry.id) + '"><b>' + esc(entry.code) + "</b><span>" + esc(entry.title) + "</span><small>" + entry.shapes.length + " detected</small></button>";
    }).join("");
    const kinds = KIND_ORDER.filter(function (kind) {
      return sheet.shapes.some(function (shape) { return shape.kind === kind; });
    });
    const chips = '<button class="chip' + (state.filter === "all" ? " on" : "") + '" type="button" data-action="filter" data-kind="all">All</button>' +
      kinds.map(function (kind) {
        return '<button class="chip' + (state.filter === kind ? " on" : "") + '" type="button" data-action="filter" data-kind="' + kind + '"><i style="background:' + KIND[kind].color + '"></i>' + esc(KIND[kind].name) + "</button>";
      }).join("");
    const tallyBands = tally(item.comparison);
    function pill(band, label) {
      return '<button class="compare-pill ' + band + (state.compareBand === band ? " on" : "") + '" type="button" data-action="compare-band" data-band="' + band + '">' + label + "</button>";
    }
    const dock = item.comparison.length
      ? '<div class="compare' + (state.compareOpen ? "" : " collapsed") + '"><div class="compare-bar">' +
          pill("all", "All " + item.comparison.length) +
          pill("close", tallyBands.close + " within 5%") +
          pill("near", tallyBands.near + " within 15%") +
          pill("far", tallyBands.far + " further out") +
          '<input class="search compare-search" id="bill-search" type="search" placeholder="Search lines" value="' + esc(state.query) + '">' +
          '<button class="btn btn-ghost compare-toggle" type="button" data-action="compare">' + (state.compareOpen ? "Hide" : "Show") + "</button></div>" +
          '<div class="compare-body" id="bill-table"></div></div>'
      : '<div class="compare collapsed"><div class="compare-bar"><span>No bill comparison on this project yet</span></div></div>';
    document.getElementById("main").innerHTML =
      '<section class="workspace' + (state.panel ? "" : " panel-hidden") + '">' +
        '<aside class="sheets"><p class="kicker">Sheets</p><div class="sheet-scroll">' + buttons + '</div><p class="sheet-note">' + drawn.length + " of " + item.sheets.length + " sheets have measured outlines. Schedules and notes are in the register.</p></aside>" +
        '<div class="stage-wrap"><div class="stage-tools"><span class="code">' + esc(sheet.code) + "</span><span>" + esc(sheet.title) + '</span><span class="zoom" id="zoom">Fit</span><button class="btn btn-ghost" type="button" data-action="fit">Fit sheet</button><button class="btn btn-ghost" type="button" data-action="panel">' + (state.panel ? "Hide list" : "Show list") + '</button></div>' +
        '<div class="stage" id="stage"><div class="caption" id="caption"></div><div class="world" id="world"></div></div>' +
        dock + "</div>" +
        '<aside class="panel"><div class="panel-head"><h2>On this sheet</h2><div class="filters">' + chips + '</div></div><div class="detect-scroll" id="detections"></div></aside>' +
      "</section>";
    drawSheet(sheet);
    renderDetections(sheet);
    if (item.comparison.length) renderBillRows(item);
    bindStage();
    if (!state.scale) requestAnimationFrame(function () { requestAnimationFrame(fit); });
    else applyView();
    paint();
  }

  function drawSheet(sheet) {
    const rasterUrl = sheetRasterUrl(sheet);
    const hasRaster = Boolean(rasterUrl);
    const guides = (sheet.guides || []).map(function (line) {
      return '<line x1="' + line[0] + '" y1="' + line[1] + '" x2="' + line[2] + '" y2="' + line[3] + '" stroke="#c8c1d2" stroke-width="1.25"></line>';
    }).join("");
    let grid = "";
    if (!hasRaster) {
      for (let x = 40; x < sheet.width; x += 40) {
        grid += '<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + sheet.height + '" stroke="#f3f0f6" stroke-width="1"></line>';
      }
      for (let y = 40; y < sheet.height; y += 40) {
        grid += '<line x1="0" y1="' + y + '" x2="' + sheet.width + '" y2="' + y + '" stroke="#f3f0f6" stroke-width="1"></line>';
      }
    }
    const openings = (sheet.openings || []).map(function (box) {
      const x = box[0];
      const y = box[1];
      const w = box[2];
      const h = box[3];
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="white" stroke="#9b2c2c" stroke-width="1.2"></rect>' +
        '<line x1="' + x + '" y1="' + y + '" x2="' + (x + w) + '" y2="' + (y + h) + '" stroke="#9b2c2c" stroke-width="1"></line>' +
        '<line x1="' + (x + w) + '" y1="' + y + '" x2="' + x + '" y2="' + (y + h) + '" stroke="#9b2c2c" stroke-width="1"></line>';
    }).join("");
    const polys = sheet.shapes.map(function (shape) {
      const color = (KIND[shape.kind] || { color: "#444" }).color;
      const points = shape.points.map(function (p) { return p[0] + "," + p[1]; }).join(" ");
      const dash = shape.dashed ? ' stroke-dasharray="8 5"' : "";
      const fill = shape.dashed ? color + "33" : color + "55";
      return '<polygon data-shape="' + esc(shape.id) + '" data-kind="' + esc(shape.kind) + '" points="' + points + '" fill="' + fill + '" stroke="' + color + '" stroke-width="2"' + dash + "></polygon>";
    }).join("");
    const raster = hasRaster
      ? '<img class="sheet-raster" src="' + esc(rasterUrl) + '" width="' + sheet.width + '" height="' + sheet.height + '" alt="" draggable="false" decoding="async">'
      : "";
    const svgBg = hasRaster ? "" : '<rect width="100%" height="100%" fill="white"></rect>';
    const mockTitle = hasRaster
      ? ""
      : '<g pointer-events="none">' + openings +
          '<text x="640" y="662" fill="#6f6876" font-family="Roboto, sans-serif" font-size="12">CONSTECH</text>' +
          '<text x="640" y="688" fill="#200060" font-family="Roboto Condensed, sans-serif" font-size="22" font-weight="600">' + esc(sheet.code) + "</text>" +
          '<text x="640" y="710" fill="#353535" font-family="Roboto, sans-serif" font-size="13">' + esc(sheet.title) + "</text>" +
        "</g>";
    const world = document.getElementById("world");
    world.classList.toggle("has-raster", hasRaster);
    world.innerHTML =
      '<div class="sheet-stack" style="width:' + sheet.width + "px;height:" + sheet.height + 'px">' +
        raster +
        '<svg class="sheet-vector" width="' + sheet.width + '" height="' + sheet.height + '" viewBox="0 0 ' + sheet.width + " " + sheet.height + '">' +
          svgBg + grid +
          '<g pointer-events="none">' + guides + "</g>" +
          polys +
          (hasRaster ? '<g pointer-events="none">' + openings + "</g>" : mockTitle) +
        "</svg></div>";
    const img = world.querySelector(".sheet-raster");
    if (img) {
      img.addEventListener("load", function () { fit(); });
      img.addEventListener("error", function () {
        toast("Sheet image failed to load. Stop the takeoff app (Ctrl+C), start it again, then hard-refresh this page (Ctrl+Shift+R).");
        world.classList.remove("has-raster");
      });
    }
  }

  function renderDetections(sheet) {
    const groups = [];
    sheet.shapes.forEach(function (shape) {
      let group = groups.find(function (item) { return item.kind === shape.kind; });
      if (!group) {
        group = { kind: shape.kind, shapes: [] };
        groups.push(group);
      }
      group.shapes.push(shape);
    });
    groups.sort(function (a, b) { return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind); });
    document.getElementById("detections").innerHTML = groups.map(function (group) {
      const meta = KIND[group.kind] || { name: group.kind, color: "#444" };
      const rows = group.shapes.map(function (shape) {
        return '<button class="item" type="button" data-action="select" data-id="' + esc(shape.id) + '" data-kind="' + esc(shape.kind) + '"><i class="swatch" style="background:' + meta.color + '"></i><span class="name">' + esc(shape.label) + "</span></button>";
      }).join("");
      return '<div class="group" data-kind="' + esc(group.kind) + '"><div class="group-label">' + esc(meta.name) + "</div>" + rows + "</div>";
    }).join("");
  }

  function applyView() {
    const world = document.getElementById("world");
    if (!world) return;
    world.style.transform = "translate(" + state.x + "px, " + state.y + "px) scale(" + state.scale + ")";
    const zoom = document.getElementById("zoom");
    if (zoom) zoom.textContent = Math.round(state.scale * 100) + "%";
  }

  function fit() {
    const sheet = currentSheet();
    const stage = document.getElementById("stage");
    if (!sheet || !stage) return;
    const pad = 36;
    state.scale = Math.min((stage.clientWidth - pad) / sheet.width, (stage.clientHeight - pad) / sheet.height);
    state.x = (stage.clientWidth - sheet.width * state.scale) / 2;
    state.y = (stage.clientHeight - sheet.height * state.scale) / 2;
    applyView();
  }

  function focusShape(shape) {
    const stage = document.getElementById("stage");
    const xs = shape.points.map(function (p) { return p[0]; });
    const ys = shape.points.map(function (p) { return p[1]; });
    const minX = Math.min.apply(null, xs);
    const maxX = Math.max.apply(null, xs);
    const minY = Math.min.apply(null, ys);
    const maxY = Math.max.apply(null, ys);
    const w = Math.max(maxX - minX, 48);
    const h = Math.max(maxY - minY, 48);
    const pad = 160;
    state.scale = Math.min(2.8, Math.max(0.18, Math.min((stage.clientWidth - pad) / w, (stage.clientHeight - pad) / h)));
    state.x = stage.clientWidth / 2 - ((minX + maxX) / 2) * state.scale;
    state.y = stage.clientHeight / 2 - ((minY + maxY) / 2) * state.scale;
    applyView();
  }

  function paint() {
    const sheet = currentSheet();
    document.querySelectorAll("polygon[data-shape]").forEach(function (poly) {
      const on = poly.dataset.shape === state.selected;
      const hiddenKind = state.filter !== "all" && poly.dataset.kind !== state.filter;
      poly.classList.toggle("on", on);
      poly.classList.toggle("dim", hiddenKind || (state.selected && !on));
    });
    document.querySelectorAll(".item[data-id]").forEach(function (item) {
      item.classList.toggle("on", item.dataset.id === state.selected);
      item.hidden = state.filter !== "all" && item.dataset.kind !== state.filter;
    });
    document.querySelectorAll(".group[data-kind]").forEach(function (group) {
      group.hidden = state.filter !== "all" && group.dataset.kind !== state.filter;
    });
    document.querySelectorAll(".chip[data-kind]").forEach(function (chip) {
      chip.classList.toggle("on", chip.dataset.kind === state.filter);
    });
    const caption = document.getElementById("caption");
    if (!caption || !sheet) return;
    const shape = sheet.shapes.find(function (entry) { return entry.id === state.selected; });
    caption.textContent = shape ? shape.label : "";
    caption.classList.toggle("show", Boolean(shape));
  }

  function selectShape(id, shouldFocus) {
    state.selected = id;
    paint();
    const sheet = currentSheet();
    const shape = sheet && sheet.shapes.find(function (entry) { return entry.id === id; });
    if (shouldFocus && shape) focusShape(shape);
    const row = document.querySelector('.item[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (row) row.scrollIntoView({ block: "nearest" });
  }

  function bindStage() {
    const stage = document.getElementById("stage");
    if (!stage) return;
    stage.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) return;
      stage.setPointerCapture(event.pointerId);
      drag = {
        x: event.clientX,
        y: event.clientY,
        ox: state.x,
        oy: state.y,
        moved: false,
        shape: event.target.closest("polygon"),
      };
    });
    stage.addEventListener("pointermove", function (event) {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) {
        drag.moved = true;
        stage.classList.add("dragging");
      }
      if (drag.moved) {
        state.x = drag.ox + dx;
        state.y = drag.oy + dy;
        applyView();
      }
    });
    stage.addEventListener("pointerup", function () {
      if (drag && !drag.moved && drag.shape) {
        const kind = drag.shape.dataset.kind;
        if (state.filter === "all" || kind === state.filter) selectShape(drag.shape.dataset.shape, true);
      }
      drag = null;
      stage.classList.remove("dragging");
    });
    stage.addEventListener("wheel", function (event) {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const next = Math.min(3.2, Math.max(0.12, state.scale * (event.deltaY < 0 ? 1.08 : 0.92)));
      state.x = px - ((px - state.x) * next) / state.scale;
      state.y = py - ((py - state.y) * next) / state.scale;
      state.scale = next;
      applyView();
    }, { passive: false });
  }

  function renderBill(item) {
    const bands = tally(item.comparison);
    const banner = item.sample
      ? '<div class="banner">These figures are sample data so the screen can be reviewed. The measure API will replace them.</div>'
      : "";
    const summary = item.comparison.length
      ? bands.close + " within 5% · " + bands.near + " within 15% · " + bands.far + " further out"
      : "Nothing to compare yet";
    document.getElementById("main").innerHTML =
      '<section class="bill"><div class="page-head"><div><h1>Bill comparison</h1><p>' + esc(summary) + "</p></div>" +
      '<input class="search" id="bill-search" type="search" placeholder="Search lines" value="' + esc(state.query) + '"></div>' +
      banner + '<div id="bill-table"></div></section>';
    renderBillRows(item);
  }

  function renderBillRows(item) {
    const host = document.getElementById("bill-table");
    if (!host) return;
    const source = item || project();
    if (!source || !source.comparison.length) {
      host.innerHTML = '<div class="empty"><h2>No comparison yet</h2><p>Run Foundations and Structure once the bill workbook is on the project. Each line will show the consultant quantity beside the measured one.</p></div>';
      return;
    }
    const compact = host.classList.contains("compare-body");
    const query = state.query.trim().toLowerCase();
    const rows = source.comparison.filter(function (row) {
      if (compact && state.compareBand !== "all" && bandOf(row) !== state.compareBand) return false;
      if (!query) return true;
      return (row.label + " " + row.section + " " + row.note).toLowerCase().indexOf(query) !== -1;
    });
    const cols = compact ? 5 : 6;
    let section = "";
    const body = rows.map(function (row) {
      const band = bandOf(row);
      const pct = pctOf(row);
      const head = row.section !== section
        ? (section = row.section, '<tr class="section"><td colspan="' + cols + '">' + esc(row.section) + "</td></tr>")
        : "";
      const note = compact ? "" : '<td class="note">' + esc(row.note) + "</td>";
      return head + '<tr class="' + band + '"><td title="' + esc(row.note) + '">' + esc(row.label) + '</td><td class="num">' + fmt(row.bill, row.digits) + " " + esc(row.unit) + '</td><td class="num">' + fmt(row.ours, row.digits) + " " + esc(row.unit) + '</td><td class="num">' + signed(row.ours - row.bill, row.digits) + '</td><td class="num pct ' + band + '">' + (pct == null ? "—" : signed(pct, 1) + "%") + "</td>" + note + "</tr>";
    }).join("");
    const headCells = compact
      ? "<th>Item</th><th class=\"num\">Bill</th><th class=\"num\">Measured</th><th class=\"num\">Difference</th><th class=\"num\">%</th>"
      : "<th>Item</th><th class=\"num\">Bill</th><th class=\"num\">Measured</th><th class=\"num\">Difference</th><th class=\"num\">%</th><th>How it was measured</th>";
    host.innerHTML = "<table><thead><tr>" + headCells + "</tr></thead><tbody>" +
      (body || '<tr><td colspan="' + cols + '">No lines match that search.</td></tr>') + "</tbody></table>";
  }

  function renderRegister(item) {
    const caps = (item.capabilities || []).map(function (cap) {
      return '<div class="cap-row"><span class="cap ' + esc(cap.status) + '">' + esc(cap.status) + "</span><b>" + esc(cap.id) + "</b><span>" + esc(cap.reason) + "</span></div>";
    }).join("");
    const rows = (item.sheets || []).map(function (sheet) {
      return "<tr><td><b>" + esc(sheet.code) + "</b></td><td>" + esc(sheet.title) + "</td><td>" + esc(sheet.role) + "</td><td>" + (sheet.shapes.length ? sheet.shapes.length + " outlines" : "—") + '</td><td class="signals">' + esc((sheet.signals || []).join(" · ")) + "</td></tr>";
    }).join("");
    document.getElementById("main").innerHTML =
      '<section class="register"><div class="page-head"><div><h1>Drawing register</h1><p>' + esc(item.name) + " · " + item.sheets.length + " sheets" + (item.bill ? " · " + esc(item.bill) : "") + "</p></div></div>" +
      (caps ? '<div class="cap-list">' + caps + "</div>" : '<div class="empty"><h2>Discover has not been run</h2><p>Discover reads filenames and the drawing text, then lists what this set can measure.</p></div>') +
      '<table><thead><tr><th>Sheet</th><th>Title</th><th>Role</th><th>Measured</th><th>Signals</th></tr></thead><tbody>' + rows + "</tbody></table></section>";
  }

  async function runMeasure(kind) {
    if (state.busy || !state.projectId) return;
    state.busy = kind;
    renderSubbar(project());
    try {
      const result = await api.run(state.projectId, kind);
      toast(result.message || "Finished.");
    } catch (err) {
      toast(err.message);
    } finally {
      state.busy = null;
      render();
    }
  }

  document.addEventListener("click", function (event) {
    const el = event.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;
    if (action === "projects") navigate("projects");
    else if (action === "open") navigate("drawings", el.dataset.id);
    else if (action === "tab") navigate(el.dataset.tab);
    else if (action === "sheet") {
      state.sheetId = el.dataset.id;
      state.selected = null;
      state.filter = "all";
      state.scale = 0;
      render();
    } else if (action === "filter") {
      state.filter = el.dataset.kind;
      if (state.selected) {
        const sheet = currentSheet();
        const shape = sheet && sheet.shapes.find(function (entry) { return entry.id === state.selected; });
        if (shape && state.filter !== "all" && shape.kind !== state.filter) state.selected = null;
      }
      paint();
    } else if (action === "select") selectShape(el.dataset.id, true);
    else if (action === "fit") fit();
    else if (action === "compare" || action === "compare-band") {
      if (action === "compare-band") {
        state.compareBand = el.dataset.band;
        state.compareOpen = true;
      } else state.compareOpen = !state.compareOpen;
      const dock = document.querySelector(".compare");
      if (dock) {
        dock.classList.toggle("collapsed", !state.compareOpen);
        dock.querySelectorAll("[data-action='compare-band']").forEach(function (btn) {
          btn.classList.toggle("on", btn.dataset.band === state.compareBand);
        });
        const toggle = dock.querySelector("[data-action='compare']");
        if (toggle) toggle.textContent = state.compareOpen ? "Hide" : "Show";
      }
      if (state.compareOpen) renderBillRows(project());
      requestAnimationFrame(fit);
    } else if (action === "panel") {
      state.panel = !state.panel;
      const workspace = document.querySelector(".workspace");
      if (workspace) {
        workspace.classList.toggle("panel-hidden", !state.panel);
        el.textContent = state.panel ? "Hide list" : "Show list";
        requestAnimationFrame(fit);
      }
    } else if (action === "run") runMeasure(el.dataset.run);
    else if (action === "logout") {
      api.logout().then(function () {
        location.hash = "#/projects";
        showLogin();
      });
    } else if (action === "new-project") {
      document.getElementById("new-error").hidden = true;
      document.getElementById("new-project").showModal();
    } else if (action === "close-dialog") document.getElementById("new-project").close();
  });

  document.addEventListener("input", function (event) {
    if (event.target.id !== "bill-search") return;
    state.query = event.target.value;
    renderBillRows();
  });

  document.getElementById("login-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const error = document.getElementById("login-error");
    const button = document.getElementById("login-submit");
    if (!email.includes("@") || password.length < 4) {
      error.hidden = false;
      error.textContent = "Enter a work email and a password of at least 4 characters.";
      shake();
      return;
    }
    button.disabled = true;
    showLoader();
    try {
      await api.login(email, password);
      error.hidden = true;
      if (!location.hash || location.hash === "#") location.hash = "#/projects";
      else reveal();
    } catch (err) {
      hideLoader();
      error.hidden = false;
      error.textContent = err.message;
      shake();
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("fill-preview").addEventListener("click", function () {
    document.getElementById("email").value = "demo@constech-uae.com";
    document.getElementById("password").value = "preview";
    document.getElementById("login-error").hidden = true;
  });

  document.getElementById("toggle-password").addEventListener("click", function () {
    const input = document.getElementById("password");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    this.textContent = show ? "Hide" : "Show";
  });

  document.getElementById("new-project-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    const name = document.getElementById("new-name").value.trim();
    const place = document.getElementById("new-place").value.trim();
    const error = document.getElementById("new-error");
    if (!name) {
      error.hidden = false;
      error.textContent = "Give the project a name.";
      return;
    }
    try {
      const created = await api.createProject(name, place);
      document.getElementById("new-project").close();
      event.target.reset();
      navigate("drawings", created.id);
    } catch (err) {
      error.hidden = false;
      error.textContent = err.message;
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && state.selected && state.route === "drawings") {
      state.selected = null;
      paint();
    }
  });

  window.addEventListener("hashchange", function () {
    if (!api.session()) return;
    reveal();
  });

  window.addEventListener("resize", function () {
    if (state.route === "drawings" && document.getElementById("stage")) fit();
  });

  document.getElementById("theme-toggle").addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
  applyTheme(document.documentElement.getAttribute("data-theme") || "light");

  api.load().then(function () {
    if (!api.session()) {
      showLogin();
      return;
    }
    if (!location.hash || location.hash === "#") location.hash = "#/projects";
    else reveal();
  });
})();
