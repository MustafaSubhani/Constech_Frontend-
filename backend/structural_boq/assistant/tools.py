"""Tools the assistant can call.

Read tools return compact JSON. Change tools (propose_*) record a proposal; in review mode
the QS accepts or rejects it, in apply mode it is applied at once and can be undone.
show_in_workspace moves the QS's view to what the answer is about.
"""
import json
import re
from pathlib import Path

from ..bill_lines import _ROLLUP
from ..formula import FormulaError, evaluate
from . import proposals

MAX_RESULT_CHARS = 14000
_SIZE = re.compile(r"\d+\s*[xX×]\s*\d+")
_BAR = re.compile(r"\bT\s*\d+\s*[-@]\s*\d+", re.I)
_PAGE_NAMES = {"drawings": "Drawings", "bill": "Bill comparison", "rates": "Rates and estimate", "inputs": "Schedules and inputs"}

EVIDENCE_SCHEMA = {
    "type": "array",
    "description": "Where the values come from: the sheet (name or stem) and the exact text read on it.",
    "items": {
        "type": "object",
        "properties": {"sheet": {"type": "string"}, "text": {"type": "string"}},
        "required": ["sheet", "text"],
    },
}
EXPRESSION_SCHEMA = {
    "type": "object",
    "properties": {
        "expression": {"type": "string", "description": "e.g. width_mm * height_mm * depth_mm / 1e9"},
        "variables": {"type": "object", "additionalProperties": {"type": "number"}},
    },
    "required": ["expression", "variables"],
}


class ToolContext:
    def __init__(self, project_dir, payload_fn, thread_id="", auto_apply=False):
        self.project = Path(project_dir)
        self.out = self.project / "out"
        self.payload_fn = payload_fn
        self.thread_id = thread_id
        self.auto_apply = auto_apply
        self.changed = False  # set when a change was applied during this run
        self._payload = None
        self._dumps = {}
        self.manifest = {}
        path = self.out / "project-manifest.json"
        if path.is_file():
            try:
                self.manifest = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                self.manifest = {}

    @property
    def payload(self):
        if self._payload is None:
            self._payload = self.payload_fn() or {}
        return self._payload

    def invalidate(self):
        self._payload = None

    def sheets(self):
        return self.manifest.get("sheets") or []

    def resolve_sheet(self, name):
        if not name:
            return None
        key = str(name).strip().lower()
        stems = [s.get("stem") or "" for s in self.sheets()]
        stems += [s.get("id") for s in self.payload.get("sheets") or [] if s.get("id") and s.get("id") not in stems]
        for stem in stems:
            if stem.lower() == key:
                return stem
        hits = [stem for stem in stems if key in stem.lower()]
        return hits[0] if len(hits) == 1 else (min(hits, key=len) if hits else None)

    def texts(self, stem):
        if stem not in self._dumps:
            path = self.out / f"{stem}.json"
            entries = []
            if path.is_file():
                try:
                    dump = json.loads(path.read_text(encoding="utf-8"))
                    for e in dump.get("entities") or []:
                        if e.get("kind") == "text" and (e.get("text") or "").strip():
                            entries.append({"text": " ".join(e["text"].split()), "x": round(e.get("x", 0)), "y": round(e.get("y", 0))})
                except (json.JSONDecodeError, OSError):
                    pass
            self._dumps[stem] = entries
        return self._dumps[stem]

    def notes_files(self):
        files = []
        for path in sorted(self.project.rglob("*")):
            if path.is_file() and path.suffix.lower() in (".txt", ".md") and "out" not in path.relative_to(self.project).parts:
                files.append(path)
        return files

    def line(self, line_id):
        return next((r for r in self.payload.get("comparison") or [] if r["id"] == line_id), None)

    def measurement(self, mid):
        return next((m for m in self.payload.get("measurements") or [] if m["id"] == mid), None)


def _compact(obj):
    text = json.dumps(obj, ensure_ascii=False, default=str)
    if len(text) > MAX_RESULT_CHARS:
        text = text[:MAX_RESULT_CHARS] + '..." [truncated: narrow the query with a filter, offset or limit]'
    return text


def _int(value, default, low, high):
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return default


def _pct(bill, ours):
    return round((ours - bill) / bill * 100, 1) if bill and ours is not None else None


def _rows(entries, tolerance=None):
    """Group texts into reading-order lines (top to bottom, left to right)."""
    if not entries:
        return []
    ordered = sorted(entries, key=lambda t: (-t["y"], t["x"]))
    tol = tolerance or 120
    lines = [[ordered[0]]]
    for t in ordered[1:]:
        if abs(t["y"] - lines[-1][0]["y"]) <= tol:
            lines[-1].append(t)
        else:
            lines.append([t])
    return [{"y": line[0]["y"], "x": min(t["x"] for t in line), "text": "  ".join(t["text"] for t in sorted(line, key=lambda t: t["x"]))} for line in lines]


# The view the QS has open -------------------------------------------------

def describe_view(ctx, view):
    """A short, factual description of what the QS is looking at, sent with each message.

    Built on the server from ids so the model sees the current numbers, not what the
    browser happened to cache.
    """
    if not view:
        return ""
    lines = []
    page = view.get("page") or "drawings"
    lines.append(f"Page: {_PAGE_NAMES.get(page, page)}")
    payload = ctx.payload
    sheet_id = view.get("sheet")
    sheet = next((s for s in payload.get("sheets") or [] if s.get("id") == sheet_id), None) if sheet_id else None
    if page == "drawings" and not sheet:
        sheet = next((s for s in payload.get("sheets") or [] if s.get("measurable") and s.get("shapes")), None)
    if sheet:
        counts = {}
        for shape in sheet.get("shapes") or []:
            if not shape.get("hidden"):
                counts[shape.get("kind")] = counts.get(shape.get("kind"), 0) + 1
        parts = ", ".join(f"{n} {k}" for k, n in sorted(counts.items(), key=lambda kv: -kv[1]))
        lines.append(f"Sheet open: {sheet.get('id')} ({sheet.get('role') or 'sheet'}{', floor ' + sheet['floor'] if sheet.get('floor') else ''}); outlines: {parts or 'none'}")
    shape_id = view.get("shape")
    if shape_id and sheet:
        shape = next((s for s in sheet.get("shapes") or [] if s.get("id") == shape_id), None)
        record = ctx.measurement(shape.get("measurementId")) if shape and shape.get("measurementId") else None
        if record:
            qty = ", ".join(f"{k} {v}" for k, v in (record.get("quantities") or {}).items() if v not in (None, ""))
            lines.append(
                f"Selected element: {record.get('tag') or shape.get('label')} ({record.get('elementType')}, id {record['id']}, "
                f"status {record.get('status')}); {qty or 'no quantities'}"
            )
        elif shape:
            lines.append(f"Selected outline: {shape.get('label')} (no measurement record)")
    line_id = view.get("bill_line")
    if line_id:
        row = ctx.line(line_id)
        if row:
            pct = _pct(row.get("bill"), row.get("ours"))
            lines.append(
                f"Selected bill line: {row.get('label')} (id {row['id']}, {row.get('unit')}): bill {row.get('bill')}, measured {row.get('ours')}"
                + (f", variance {pct:+.1f}%" if pct is not None else "")
                + (", adjusted" if row.get("adjusted") else "")
            )
    if page == "rates":
        from ..rates import load_rates

        doc = load_rates(ctx.project)
        rows = [r for r in payload.get("comparison") or [] if not r.get("hidden") and r.get("ours") is not None]
        priced = [r for r in rows if r["id"] in doc["rates"]]
        direct = sum(r["ours"] * doc["rates"][r["id"]] for r in priced)
        lines.append(
            f"Estimate: {len(priced)} of {len(rows)} lines priced, direct works {doc['currency']} {direct:,.2f}, "
            f"overheads and profit {doc['markupPercent']:g}%"
        )
    if view.get("scope") and view.get("scope") != "project":
        lines.append(f"Table scope: {view['scope']}")
    mode = "apply (changes are applied immediately; each can be undone)" if ctx.auto_apply else "review (each change waits for the QS to accept it)"
    lines.append(f"Change mode: {mode}")
    return "<view>\n" + "\n".join(lines) + "\n</view>"


# Read tools ---------------------------------------------------------------

def get_project_overview(ctx, args):
    p = ctx.payload
    rows = [r for r in p.get("comparison") or [] if not r.get("hidden")]
    bands = {"within_5pct": 0, "within_15pct": 0, "over_15pct": 0, "no_bill_value": 0}
    for r in rows:
        pct = _pct(r.get("bill"), r.get("ours"))
        if pct is None:
            bands["no_bill_value"] += 1
        elif abs(pct) <= 5:
            bands["within_5pct"] += 1
        elif abs(pct) <= 15:
            bands["within_15pct"] += 1
        else:
            bands["over_15pct"] += 1
    types = {}
    for m in p.get("measurements") or []:
        types[m.get("elementType")] = types.get(m.get("elementType"), 0) + 1
    pending = [x for x in proposals.load_all(ctx.project) if x.get("status") == "pending"]
    return {
        "project": p.get("name"), "place": p.get("place"),
        "bill": (p.get("billSource") or {}).get("name"),
        "engine_runs": p.get("runs"),
        "bill_lines": len(rows), "variance_bands": bands,
        "floors": [f.get("label") for f in p.get("floors") or []],
        "sheets_with_outlines": sum(1 for s in p.get("sheets") or [] if s.get("shapes")),
        "elements_by_type": types,
        "review_items": len(p.get("reviewQueue") or []),
        "capabilities": [{"id": c.get("id"), "status": c.get("status")} for c in p.get("capabilities") or []],
        "pending_proposals": len(pending),
    }


def list_sheets(ctx, args):
    out = []
    for s in ctx.sheets():
        out.append({
            "sheet": s.get("stem"),
            "role": s.get("role"),
            "floor": s.get("floor") or None,
            "title": (s.get("title") or "")[:80],
            "format": s.get("source_format"),
            "signals": s.get("signals") or [],
            "text_items": s.get("text_entity_count"),
        })
    refs = ctx.manifest.get("references") or []
    notes = [str(p.relative_to(ctx.project)) for p in ctx.notes_files()]
    return {"sheets": out, "cross_references": refs, "notes_files": notes}


def search_text(ctx, args):
    query = (args.get("query") or "").strip()
    if not query:
        return {"error": "query is required"}
    try:
        pattern = re.compile(query, re.I) if args.get("regex") else re.compile(re.escape(query), re.I)
    except re.error as exc:
        return {"error": f"invalid regex: {exc}"}
    limit = _int(args.get("limit"), 40, 1, 120)
    only = ctx.resolve_sheet(args.get("sheet")) if args.get("sheet") else None
    if args.get("sheet") and not only:
        return {"error": f"No sheet matches '{args.get('sheet')}'. Use list_sheets."}
    hits = []
    searched = 0
    for s in ctx.sheets():
        stem = s.get("stem")
        if only and stem != only:
            continue
        searched += 1
        for t in ctx.texts(stem):
            if pattern.search(t["text"]):
                hits.append({"sheet": stem, "text": t["text"][:200], "x": t["x"], "y": t["y"]})
                if len(hits) >= limit:
                    break
        if len(hits) >= limit:
            break
    if not only:
        for path in ctx.notes_files():
            for n, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
                if pattern.search(line) and len(hits) < limit + 20:
                    hits.append({"file": path.name, "line": n, "text": line.strip()[:200]})
    return {"query": query, "sheets_searched": searched, "matches": hits, "found": bool(hits), "limited": len(hits) >= limit}


def read_sheet(ctx, args):
    stem = ctx.resolve_sheet(args.get("sheet"))
    if not stem:
        return {"error": f"No sheet matches '{args.get('sheet')}'. Use list_sheets."}
    entries = ctx.texts(stem)
    near = args.get("near")
    if isinstance(near, dict) and "x" in near and "y" in near:
        try:
            radius = float(near.get("radius") or 4000)
            cx, cy = float(near["x"]), float(near["y"])
        except (TypeError, ValueError):
            return {"error": "near needs numeric x, y and radius"}
        entries = [t for t in entries if abs(t["x"] - cx) <= radius and abs(t["y"] - cy) <= radius]
    contains = (args.get("contains") or "").strip().lower()
    lines = _rows(entries)
    if contains:
        lines = [line for line in lines if contains in line["text"].lower()]
    offset = _int(args.get("offset"), 0, 0, 100000)
    limit = _int(args.get("limit"), 120, 1, 300)
    return {"sheet": stem, "total_lines": len(lines), "offset": offset, "lines": lines[offset:offset + limit],
            "more": offset + limit < len(lines)}


def find_schedules(ctx, args):
    """Tables anywhere in the set: a SCHEDULE/TABLE title with rows of sizes or bar marks under it."""
    element = (args.get("element") or "").strip().upper()
    found = []
    searched = 0
    for s in ctx.sheets():
        stem = s.get("stem")
        entries = ctx.texts(stem)
        if not entries:
            continue
        searched += 1
        titles = [t for t in entries if re.search(r"SCHEDULE|\bTABLE\b", t["text"], re.I) and len(t["text"]) <= 80]
        for title in titles:
            if element and element not in title["text"].upper():
                continue
            below = [t for t in entries if 0 < title["y"] - t["y"] <= 6000 and abs(t["x"] - title["x"]) <= 9000]
            rows = _rows(below)
            data_rows = [r for r in rows if _SIZE.search(r["text"]) or _BAR.search(r["text"])]
            if not data_rows:
                continue
            found.append({
                "sheet": stem,
                "title": title["text"],
                "at": {"x": title["x"], "y": title["y"]},
                "rows_with_sizes_or_bars": len(data_rows),
                "sample_rows": [r["text"][:160] for r in data_rows[:6]],
            })
    refs = [r for r in ctx.manifest.get("references") or [] if not element or r.get("element", "").upper().startswith(element[:4])]
    return {
        "element": element or "any",
        "sheets_searched": searched,
        "schedules": found[:40],
        "cross_references": refs,
        "found": bool(found),
        "note": "" if found else "No table with a schedule title and size or bar rows was found in the readable sheets.",
    }


def list_bill_lines(ctx, args):
    query = (args.get("query") or "").lower()
    band = args.get("band")
    rows = []
    for r in ctx.payload.get("comparison") or []:
        if query and query not in f"{r.get('label')} {r.get('section')} {r.get('id')}".lower():
            continue
        if r.get("hidden") and not args.get("include_hidden"):
            continue
        bill, ours = r.get("bill"), r.get("ours")
        pct = _pct(bill, ours)
        if band == "over_15pct" and not (pct is not None and abs(pct) > 15):
            continue
        if band == "no_bill_value" and pct is not None:
            continue
        rows.append({
            "id": r["id"], "section": r.get("section"), "label": r.get("label"), "unit": r.get("unit"),
            "bill": bill, "measured": ours, "variance_pct": pct,
            "adjusted": bool(r.get("adjusted")), "hidden": bool(r.get("hidden")), "custom": bool(r.get("custom")),
        })
    return {"bill": (ctx.payload.get("billSource") or {}).get("name"), "count": len(rows), "lines": rows}


def get_bill_line(ctx, args):
    line = ctx.line(args.get("line_id"))
    if not line:
        return {"error": f"No bill line '{args.get('line_id')}'. Use list_bill_lines."}
    placements = line.get("placements") or []
    return {
        **{k: line.get(k) for k in ("id", "section", "label", "unit", "bill", "ours", "engineOurs", "note", "formula", "expression", "variables", "adjusted", "adjustmentReason", "measureDelta", "floors")},
        "rollup": line.get("inputs") or {},
        "element_count": len(placements),
        "elements": [{k: p.get(k) for k in ("measurementId", "tag", "sheetId", "quantity", "widthMm", "heightMm", "depthMm", "areaM2")} for p in placements[:60]],
        "sources": line.get("sources") or [],
    }


def list_measurements(ctx, args):
    etype, sheet, tag = args.get("element_type"), args.get("sheet"), (args.get("tag") or "").upper()
    stem = ctx.resolve_sheet(sheet) if sheet else None
    rows = []
    for m in ctx.payload.get("measurements") or []:
        if etype and m.get("elementType") != etype:
            continue
        if stem and m.get("sheet") != stem:
            continue
        if tag and (m.get("tag") or "").upper() != tag:
            continue
        if args.get("status") and m.get("status") != args.get("status"):
            continue
        rows.append({k: m.get(k) for k in ("id", "elementType", "tag", "sheet", "status", "quantities")})
    limit = _int(args.get("limit"), 60, 1, 200)
    offset = _int(args.get("offset"), 0, 0, 100000)
    types = sorted({m.get("elementType") for m in ctx.payload.get("measurements") or []})
    return {"total": len(rows), "offset": offset, "element_types_in_project": types, "measurements": rows[offset:offset + limit]}


def get_measurement(ctx, args):
    m = ctx.measurement(args.get("measurement_id"))
    if not m:
        return {"error": f"No measurement '{args.get('measurement_id')}'. Use list_measurements."}
    evidence = []
    for sheet in ctx.payload.get("sheets") or []:
        for shape in sheet.get("shapes") or []:
            if shape.get("measurementId") == m["id"]:
                evidence = [{"label": e.get("label"), "text": e.get("text")} for e in shape.get("evidence") or []]
    lines = [k for k, (types, _f) in _ROLLUP.items() if m.get("elementType") in types]
    return {**m, "evidence": evidence, "feeds_bill_lines": lines}


def get_project_rules(ctx, args):
    from ..inputs import load_inputs

    return {
        "rules_from_notes": ctx.manifest.get("rules_from_notes") or {},
        "set_by_hand": load_inputs(ctx.project).get("values") or {},
        "capabilities": ctx.manifest.get("capabilities") or [],
        "sheet_joins": ctx.manifest.get("sheet_joins") or [],
    }


def get_rates(ctx, args):
    from ..rates import load_rates

    doc = load_rates(ctx.project)
    rows = []
    direct = 0.0
    for r in ctx.payload.get("comparison") or []:
        if r.get("hidden") or r.get("ours") is None:
            continue
        rate = doc["rates"].get(r["id"])
        amount = r["ours"] * rate if rate is not None else None
        direct += amount or 0.0
        rows.append({"id": r["id"], "label": r.get("label"), "unit": r.get("unit"), "quantity": r["ours"], "rate": rate,
                     "amount": round(amount, 2) if amount is not None else None})
    markup = doc["markupPercent"]
    return {
        "currency": doc["currency"], "markup_percent": markup, "source": doc.get("source"),
        "lines": rows, "priced": sum(1 for r in rows if r["rate"] is not None), "unpriced": sum(1 for r in rows if r["rate"] is None),
        "direct_works": round(direct, 2), "total_estimate": round(direct * (1 + markup / 100), 2),
    }


def list_proposals(ctx, args):
    status = args.get("status")
    items = [p for p in proposals.load_all(ctx.project) if not status or p.get("status") == status]
    return {"proposals": [{k: p.get(k) for k in ("id", "kind", "status", "summary", "created")} for p in items[-40:]]}


def evaluate_formula(ctx, args):
    try:
        return {"value": round(evaluate(args.get("expression") or "", args.get("variables") or {}), 6)}
    except FormulaError as exc:
        return {"error": str(exc)}


# Change tools ---------------------------------------------------------------

def _propose(kind):
    def run(ctx, args):
        try:
            proposal = proposals.create(ctx, kind, args)
        except (ValueError, FormulaError) as exc:
            return {"error": str(exc)}
        result = {"proposal_id": proposal["id"], "summary": proposal["summary"]}
        if proposal.get("duplicate") and not ctx.auto_apply:
            result["status"] = "already proposed and still waiting for the QS; not created again"
            return result
        if kind not in proposals.NO_EVIDENCE_KINDS:
            result["evidence_verified"] = all(e.get("verified") for e in proposal["evidence"]) if proposal["evidence"] else False
        if ctx.auto_apply:
            try:
                proposals.apply(ctx.project, proposal["id"])
            except (ValueError, KeyError) as exc:
                result["status"] = f"recorded but could not be applied: {exc}"
                return result
            ctx.changed = True
            ctx.invalidate()
            result["status"] = "applied; the QS can undo it from the card"
        else:
            result["status"] = "waiting for the QS to accept or reject"
        return result

    return run


def revert_change(ctx, args):
    pid = args.get("proposal_id")
    item = next((p for p in proposals.load_all(ctx.project) if p.get("id") == pid), None)
    if not item:
        return {"error": f"No change '{pid}'. Use list_proposals."}
    try:
        if item["status"] == "applied":
            proposals.undo(ctx.project, pid)
            ctx.changed = True
            ctx.invalidate()
            return {"proposal_id": pid, "status": "undone", "summary": item.get("summary")}
        if item["status"] == "pending":
            proposals.reject(ctx.project, pid)
            return {"proposal_id": pid, "status": "withdrawn", "summary": item.get("summary")}
    except ValueError as exc:
        return {"error": str(exc)}
    return {"error": f"That change is already {item['status']}."}


def show_in_workspace(ctx, args):
    """Validated navigation the browser carries out (open a sheet and select an element, open a bill line)."""
    target = args.get("target")
    if target == "element":
        m = ctx.measurement(args.get("measurement_id"))
        if not m:
            return {"error": f"No measurement '{args.get('measurement_id')}'."}
        for sheet in ctx.payload.get("sheets") or []:
            for shape in sheet.get("shapes") or []:
                if shape.get("measurementId") == m["id"] and not shape.get("hidden"):
                    return {"action": {"type": "element", "sheet": sheet["id"], "shape": shape["id"]},
                            "summary": f"Showed {m.get('tag') or m['id']} on {sheet['id']}"}
        return {"error": f"{m.get('tag') or m['id']} has no outline on a sheet; open its bill line instead."}
    if target == "sheet":
        stem = ctx.resolve_sheet(args.get("sheet"))
        sheet = next((s for s in ctx.payload.get("sheets") or [] if s.get("id") == stem), None)
        if not sheet:
            return {"error": f"No viewable sheet matches '{args.get('sheet')}'."}
        return {"action": {"type": "sheet", "sheet": sheet["id"]}, "summary": f"Opened sheet {sheet['id']}"}
    if target == "bill_line":
        row = ctx.line(args.get("line_id"))
        if not row:
            return {"error": f"No bill line '{args.get('line_id')}'."}
        return {"action": {"type": "bill_line", "line": row["id"]}, "summary": f"Opened bill line {row.get('label')}"}
    if target == "rates":
        return {"action": {"type": "rates", "line": args.get("line_id") or ""}, "summary": "Opened rates and estimate"}
    return {"error": "target must be element, sheet, bill_line or rates"}


_REASON = {"type": "string", "description": "One line: why this change is right."}

TOOLS = [
    {"name": "get_project_overview", "fn": get_project_overview,
     "description": "Project summary: bill used, variance bands, floors, element counts by type, review items, engine runs and pending proposals. A good first call for broad questions.",
     "schema": {"type": "object", "properties": {}}},
    {"name": "list_sheets", "fn": list_sheets,
     "description": "List every sheet with its role, storey, title and content signals, plus cross references between sheets and any notes files.",
     "schema": {"type": "object", "properties": {}}},
    {"name": "search_text", "fn": search_text,
     "description": "Search the text of all sheets (and notes files) for a phrase or regex. Use to find schedules, tags, notes, levels.",
     "schema": {"type": "object", "properties": {
         "query": {"type": "string"}, "regex": {"type": "boolean"}, "sheet": {"type": "string"}, "limit": {"type": "integer"}},
         "required": ["query"]}},
    {"name": "read_sheet", "fn": read_sheet,
     "description": "Read a sheet's text as lines in reading order. Narrow with 'contains' or 'near' {x, y, radius} (drawing units) to read a table or note in place; page with offset.",
     "schema": {"type": "object", "properties": {
         "sheet": {"type": "string"}, "contains": {"type": "string"},
         "near": {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "radius": {"type": "number"}}},
         "offset": {"type": "integer"}, "limit": {"type": "integer"}}, "required": ["sheet"]}},
    {"name": "find_schedules", "fn": find_schedules,
     "description": "Find schedule tables anywhere in the set (title plus rows of sizes or bar marks). Optionally filter by element: FOOTING, COLUMN, BEAM, WALL, SLAB.",
     "schema": {"type": "object", "properties": {"element": {"type": "string"}}}},
    {"name": "list_bill_lines", "fn": list_bill_lines,
     "description": "Bill comparison lines with bill and measured quantities and variance. Filter by text, or band over_15pct / no_bill_value.",
     "schema": {"type": "object", "properties": {
         "query": {"type": "string"}, "band": {"type": "string", "enum": ["over_15pct", "no_bill_value"]}, "include_hidden": {"type": "boolean"}}}},
    {"name": "get_bill_line", "fn": get_bill_line,
     "description": "One bill line in full: engine basis, rollup, split by floor, the measured elements behind it, sources and adjustments.",
     "schema": {"type": "object", "properties": {"line_id": {"type": "string"}}, "required": ["line_id"]}},
    {"name": "list_measurements", "fn": list_measurements,
     "description": "Measured element records, filtered by element_type, sheet, tag or status (auto, review, adjusted, excluded, manual).",
     "schema": {"type": "object", "properties": {
         "element_type": {"type": "string"}, "sheet": {"type": "string"}, "tag": {"type": "string"}, "status": {"type": "string"},
         "limit": {"type": "integer"}, "offset": {"type": "integer"}}}},
    {"name": "get_measurement", "fn": get_measurement,
     "description": "One element record: inputs, formula, quantities, the text it was read from, and the bill lines it feeds.",
     "schema": {"type": "object", "properties": {"measurement_id": {"type": "string"}}, "required": ["measurement_id"]}},
    {"name": "get_project_rules", "fn": get_project_rules,
     "description": "Rules read from the notes (blinding, cover), values set by hand, capabilities and which sheet feeds each engine module.",
     "schema": {"type": "object", "properties": {}}},
    {"name": "get_rates", "fn": get_rates,
     "description": "The estimate: currency, overheads and profit, the rate and amount of every measured line, direct works and total.",
     "schema": {"type": "object", "properties": {}}},
    {"name": "list_proposals", "fn": list_proposals,
     "description": "Changes proposed in this project and their status (pending, applied, rejected, undone). Check before proposing again.",
     "schema": {"type": "object", "properties": {"status": {"type": "string", "enum": ["pending", "applied", "rejected", "undone"]}}}},
    {"name": "evaluate_formula", "fn": evaluate_formula,
     "description": "Evaluate an arithmetic formula with named variables, exactly as the engine will.",
     "schema": {"type": "object", "properties": {
         "expression": {"type": "string"}, "variables": {"type": "object", "additionalProperties": {"type": "number"}}},
         "required": ["expression"]}},
    {"name": "show_in_workspace", "fn": show_in_workspace,
     "description": "Move the QS's screen to what you are talking about: select an element on its sheet, open a sheet, a bill line, or the rates page. Use once per answer, for the most relevant item.",
     "schema": {"type": "object", "properties": {
         "target": {"type": "string", "enum": ["element", "sheet", "bill_line", "rates"]},
         "measurement_id": {"type": "string"}, "sheet": {"type": "string"}, "line_id": {"type": "string"}},
         "required": ["target"]}},
    {"name": "propose_measurement_change", "fn": _propose("measurement_change"),
     "description": "Change one quantity of an element with a new formula (field: concrete_m3, formwork_m2, rebar_kg, area_m2, blinding_m3).",
     "schema": {"type": "object", "properties": {
         "measurement_id": {"type": "string"}, "field": {"type": "string", "enum": ["concrete_m3", "formwork_m2", "rebar_kg", "area_m2", "blinding_m3"]},
         "formula": EXPRESSION_SCHEMA, "reason": _REASON, "evidence": EVIDENCE_SCHEMA},
         "required": ["measurement_id", "field", "formula", "reason", "evidence"]}},
    {"name": "propose_exclude_measurement", "fn": _propose("exclude"),
     "description": "Remove an element from the takeoff (duplicate, wrong outline, not part of this scope).",
     "schema": {"type": "object", "properties": {
         "measurement_id": {"type": "string"}, "reason": _REASON, "evidence": EVIDENCE_SCHEMA},
         "required": ["measurement_id", "reason", "evidence"]}},
    {"name": "propose_new_element", "fn": _propose("new_element"),
     "description": "Add an element the engine missed, with its quantities as formulas.",
     "schema": {"type": "object", "properties": {
         "element_type": {"type": "string", "enum": ["footing", "raft", "column_storey", "column_neck", "wall_storey", "suspended_slab", "slab_on_grade", "grade_beam", "beam", "other"]},
         "tag": {"type": "string"}, "sheet": {"type": "string"},
         "formulas": {"type": "object", "additionalProperties": EXPRESSION_SCHEMA, "description": "field -> formula"},
         "reason": _REASON, "evidence": EVIDENCE_SCHEMA},
         "required": ["element_type", "tag", "sheet", "formulas", "reason", "evidence"]}},
    {"name": "propose_bill_line_override", "fn": _propose("bill_override"),
     "description": "Override a bill line's measured quantity. Use only when element changes cannot express it.",
     "schema": {"type": "object", "properties": {
         "line_id": {"type": "string"}, "formula": EXPRESSION_SCHEMA, "reason": _REASON, "evidence": EVIDENCE_SCHEMA},
         "required": ["line_id", "formula", "reason", "evidence"]}},
    {"name": "propose_custom_line", "fn": _propose("custom_line"),
     "description": "Add a bill line the engine does not produce (e.g. an item measured by hand), with its quantity as a formula and optionally its bill value.",
     "schema": {"type": "object", "properties": {
         "label": {"type": "string"}, "section": {"type": "string"}, "unit": {"type": "string"}, "floor": {"type": "string"},
         "bill": {"type": "number"}, "formula": EXPRESSION_SCHEMA, "reason": _REASON, "evidence": EVIDENCE_SCHEMA},
         "required": ["label", "unit", "formula", "reason"]}},
    {"name": "propose_line_visibility", "fn": _propose("line_visibility"),
     "description": "Hide a bill line from the comparison and estimate (out of scope, duplicated), or show a hidden one again.",
     "schema": {"type": "object", "properties": {
         "line_id": {"type": "string"}, "hidden": {"type": "boolean"}, "reason": _REASON},
         "required": ["line_id", "hidden", "reason"]}},
    {"name": "propose_rates", "fn": _propose("rates"),
     "description": "Set unit rates for bill lines, and optionally the overheads and profit percentage or the currency. Rates come from the QS or a rates sheet, never invent them.",
     "schema": {"type": "object", "properties": {
         "rates": {"type": "array", "items": {"type": "object", "properties": {"line_id": {"type": "string"}, "rate": {"type": "number"}}, "required": ["line_id", "rate"]}},
         "markup_percent": {"type": "number"}, "currency": {"type": "string"}, "reason": _REASON},
         "required": ["reason"]}},
    {"name": "propose_project_input", "fn": _propose("project_input"),
     "description": "Set a project value read from the notes: blinding_mm or footing_cover_mm.",
     "schema": {"type": "object", "properties": {
         "key": {"type": "string", "enum": ["blinding_mm", "footing_cover_mm"]}, "value": {"type": "number"},
         "reason": _REASON, "evidence": EVIDENCE_SCHEMA},
         "required": ["key", "value", "reason", "evidence"]}},
    {"name": "propose_sheet_role", "fn": _propose("sheet_role"),
     "description": "Correct the role of a sheet the register has wrong or unknown.",
     "schema": {"type": "object", "properties": {
         "sheet": {"type": "string"},
         "role": {"type": "string", "enum": ["footing_schedule", "column_schedule", "beam_schedule", "wall_schedule", "foundation_plan", "floor_plan", "framing_plan", "reinforcement_plan", "section_detail", "general_notes", "other"]},
         "floor": {"type": "string"}, "reason": _REASON, "evidence": EVIDENCE_SCHEMA},
         "required": ["sheet", "role", "reason", "evidence"]}},
    {"name": "revert_change", "fn": revert_change,
     "description": "Undo an applied change, or withdraw a pending proposal, by its proposal id.",
     "schema": {"type": "object", "properties": {"proposal_id": {"type": "string"}}, "required": ["proposal_id"]}},
]

BY_NAME = {t["name"]: t for t in TOOLS}
_TYPES = {"string": str, "number": (int, float), "integer": int, "boolean": bool, "object": dict, "array": list}


def _validate(schema, args):
    """Required fields and top-level types, so a malformed call gets a precise error back."""
    missing = [k for k in schema.get("required") or [] if args.get(k) in (None, "")]
    if missing:
        return f"Missing required field{'s' if len(missing) > 1 else ''}: {', '.join(missing)}"
    for key, spec in (schema.get("properties") or {}).items():
        if key not in args or args[key] is None:
            continue
        expected = _TYPES.get(spec.get("type"))
        value = args[key]
        if expected and (not isinstance(value, expected) or (spec.get("type") in ("number", "integer") and isinstance(value, bool))):
            return f"Field '{key}' must be a {spec.get('type')}"
        if spec.get("enum") and value not in spec["enum"]:
            return f"Field '{key}' must be one of: {', '.join(map(str, spec['enum']))}"
    return None


def run_tool(ctx, name, args):
    """Returns (result_text, is_error, result_dict)."""
    tool = BY_NAME.get(name)
    if not tool:
        result = {"error": f"Unknown tool '{name}'. Available: {', '.join(BY_NAME)}"}
        return _compact(result), True, result
    if not isinstance(args, dict) or "_invalid_json" in args:
        result = {"error": "Tool input was not valid JSON. Send the arguments again as a JSON object."}
        return _compact(result), True, result
    problem = _validate(tool["schema"], args)
    if problem:
        result = {"error": problem}
        return _compact(result), True, result
    try:
        result = tool["fn"](ctx, args)
    except Exception as exc:  # a tool failure goes back to the model, it does not end the turn
        result = {"error": f"{type(exc).__name__}: {str(exc)[:300]}"}
    is_error = bool(isinstance(result, dict) and result.get("error"))
    return _compact(result), is_error, result
