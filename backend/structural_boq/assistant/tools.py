"""Tools the assistant can call. Read tools return compact JSON; propose_* tools record proposals."""
import json
import re
from pathlib import Path

from ..bill_lines import _ROLLUP
from ..formula import FormulaError, evaluate
from . import proposals

MAX_RESULT_CHARS = 12000
_SIZE = re.compile(r"\d+\s*[xX×]\s*\d+")
_BAR = re.compile(r"\bT\s*\d+\s*[-@]\s*\d+", re.I)

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
    def __init__(self, project_dir, payload_fn, thread_id=""):
        self.project = Path(project_dir)
        self.out = self.project / "out"
        self.payload_fn = payload_fn
        self.thread_id = thread_id
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
            self._payload = self.payload_fn()
        return self._payload

    def invalidate(self):
        self._payload = None

    def sheets(self):
        return self.manifest.get("sheets") or []

    def resolve_sheet(self, name):
        if not name:
            return None
        key = name.strip().lower()
        stems = [s.get("stem") or "" for s in self.sheets()]
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


def _compact(obj):
    text = json.dumps(obj, ensure_ascii=False, default=str)
    if len(text) > MAX_RESULT_CHARS:
        text = text[:MAX_RESULT_CHARS] + '..." (truncated; narrow the query)'
    return text


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


# Read tools ---------------------------------------------------------------

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
    limit = min(int(args.get("limit") or 40), 120)
    only = ctx.resolve_sheet(args.get("sheet")) if args.get("sheet") else None
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
    for path in ctx.notes_files():
        if only:
            break
        for n, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
            if pattern.search(line):
                hits.append({"file": path.name, "line": n, "text": line.strip()[:200]})
    return {"query": query, "sheets_searched": searched, "matches": hits, "found": bool(hits)}


def read_sheet(ctx, args):
    stem = ctx.resolve_sheet(args.get("sheet"))
    if not stem:
        return {"error": f"No sheet matches '{args.get('sheet')}'. Use list_sheets."}
    entries = ctx.texts(stem)
    near = args.get("near")
    if isinstance(near, dict) and "x" in near and "y" in near:
        radius = float(near.get("radius") or 4000)
        entries = [t for t in entries if abs(t["x"] - near["x"]) <= radius and abs(t["y"] - near["y"]) <= radius]
    contains = (args.get("contains") or "").strip().lower()
    lines = _rows(entries)
    if contains:
        lines = [line for line in lines if contains in line["text"].lower()]
    offset = int(args.get("offset") or 0)
    limit = min(int(args.get("limit") or 120), 300)
    return {"sheet": stem, "total_lines": len(lines), "offset": offset, "lines": lines[offset:offset + limit]}


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
    rows = []
    for r in ctx.payload.get("comparison") or []:
        if query and query not in f"{r.get('label')} {r.get('section')} {r.get('id')}".lower():
            continue
        bill, ours = r.get("bill"), r.get("ours")
        rows.append({
            "id": r["id"], "section": r.get("section"), "label": r.get("label"), "unit": r.get("unit"),
            "bill": bill, "measured": ours,
            "variance_pct": round((ours - bill) / bill * 100, 1) if bill and ours is not None else None,
            "adjusted": bool(r.get("adjusted")), "hidden": bool(r.get("hidden")), "custom": bool(r.get("custom")),
        })
    return {"bill": (ctx.payload.get("billSource") or {}).get("name"), "lines": rows}


def get_bill_line(ctx, args):
    line = next((r for r in ctx.payload.get("comparison") or [] if r["id"] == args.get("line_id")), None)
    if not line:
        return {"error": f"No bill line '{args.get('line_id')}'. Use list_bill_lines."}
    placements = line.get("placements") or []
    return {
        **{k: line.get(k) for k in ("id", "section", "label", "unit", "bill", "ours", "engineOurs", "note", "formula", "expression", "variables", "adjusted", "adjustmentReason", "measureDelta")},
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
        rows.append({k: m.get(k) for k in ("id", "elementType", "tag", "sheet", "status", "quantities")})
    limit = min(int(args.get("limit") or 60), 200)
    types = sorted({m.get("elementType") for m in ctx.payload.get("measurements") or []})
    return {"total": len(rows), "element_types_in_project": types, "measurements": rows[:limit]}


def get_measurement(ctx, args):
    m = next((r for r in ctx.payload.get("measurements") or [] if r["id"] == args.get("measurement_id")), None)
    if not m:
        return {"error": f"No measurement '{args.get('measurement_id')}'."}
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


def evaluate_formula(ctx, args):
    try:
        return {"value": round(evaluate(args.get("expression") or "", args.get("variables") or {}), 6)}
    except FormulaError as exc:
        return {"error": str(exc)}


# Propose tools ------------------------------------------------------------

def _propose(kind):
    def run(ctx, args):
        try:
            proposal = proposals.create(ctx, kind, args)
        except (ValueError, FormulaError) as exc:
            return {"error": str(exc)}
        ctx.invalidate()
        return {
            "proposal_id": proposal["id"],
            "status": "waiting for the QS",
            "summary": proposal["summary"],
            "evidence_verified": all(e.get("verified") for e in proposal["evidence"]) if proposal["evidence"] else False,
        }

    return run


TOOLS = [
    {"name": "list_sheets", "fn": list_sheets,
     "description": "List every sheet with its role, storey, title and content signals, plus cross references between sheets and any notes files.",
     "schema": {"type": "object", "properties": {}}},
    {"name": "search_text", "fn": search_text,
     "description": "Search the text of all sheets (and notes files) for a phrase or regex. Use to find schedules, tags, notes, levels.",
     "schema": {"type": "object", "properties": {
         "query": {"type": "string"}, "regex": {"type": "boolean"}, "sheet": {"type": "string"}, "limit": {"type": "integer"}},
         "required": ["query"]}},
    {"name": "read_sheet", "fn": read_sheet,
     "description": "Read a sheet's text as lines in reading order. Narrow with 'contains' or 'near' {x, y, radius} (drawing units) to read a table or note in place.",
     "schema": {"type": "object", "properties": {
         "sheet": {"type": "string"}, "contains": {"type": "string"},
         "near": {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "radius": {"type": "number"}}},
         "offset": {"type": "integer"}, "limit": {"type": "integer"}}, "required": ["sheet"]}},
    {"name": "find_schedules", "fn": find_schedules,
     "description": "Find schedule tables anywhere in the set (title plus rows of sizes or bar marks). Optionally filter by element: FOOTING, COLUMN, BEAM, WALL, SLAB.",
     "schema": {"type": "object", "properties": {"element": {"type": "string"}}}},
    {"name": "list_bill_lines", "fn": list_bill_lines,
     "description": "Bill comparison lines with bill and measured quantities and variance.",
     "schema": {"type": "object", "properties": {"query": {"type": "string"}}}},
    {"name": "get_bill_line", "fn": get_bill_line,
     "description": "One bill line in full: engine basis, rollup, the measured elements behind it, sources and adjustments.",
     "schema": {"type": "object", "properties": {"line_id": {"type": "string"}}, "required": ["line_id"]}},
    {"name": "list_measurements", "fn": list_measurements,
     "description": "Measured element records, filtered by element_type, sheet or tag.",
     "schema": {"type": "object", "properties": {
         "element_type": {"type": "string"}, "sheet": {"type": "string"}, "tag": {"type": "string"}, "limit": {"type": "integer"}}}},
    {"name": "get_measurement", "fn": get_measurement,
     "description": "One element record: inputs, formula, quantities, the text it was read from, and the bill lines it feeds.",
     "schema": {"type": "object", "properties": {"measurement_id": {"type": "string"}}, "required": ["measurement_id"]}},
    {"name": "get_project_rules", "fn": get_project_rules,
     "description": "Rules read from the notes (blinding, cover), values set by hand, capabilities and which sheet feeds each engine module.",
     "schema": {"type": "object", "properties": {}}},
    {"name": "evaluate_formula", "fn": evaluate_formula,
     "description": "Evaluate an arithmetic formula with named variables, exactly as the engine will.",
     "schema": {"type": "object", "properties": {
         "expression": {"type": "string"}, "variables": {"type": "object", "additionalProperties": {"type": "number"}}},
         "required": ["expression"]}},
    {"name": "propose_measurement_change", "fn": _propose("measurement_change"),
     "description": "Propose a new formula for one quantity of an element (field: concrete_m3, formwork_m2, rebar_kg, area_m2, blinding_m3).",
     "schema": {"type": "object", "properties": {
         "measurement_id": {"type": "string"}, "field": {"type": "string"}, "formula": EXPRESSION_SCHEMA,
         "reason": {"type": "string"}, "evidence": EVIDENCE_SCHEMA},
         "required": ["measurement_id", "field", "formula", "reason", "evidence"]}},
    {"name": "propose_exclude_measurement", "fn": _propose("exclude"),
     "description": "Propose removing an element from the takeoff (duplicate, wrong outline, not part of this scope).",
     "schema": {"type": "object", "properties": {
         "measurement_id": {"type": "string"}, "reason": {"type": "string"}, "evidence": EVIDENCE_SCHEMA},
         "required": ["measurement_id", "reason", "evidence"]}},
    {"name": "propose_new_element", "fn": _propose("new_element"),
     "description": "Propose an element the engine missed, with its quantities as formulas.",
     "schema": {"type": "object", "properties": {
         "element_type": {"type": "string", "enum": ["footing", "raft", "column_storey", "column_neck", "wall_storey", "suspended_slab", "slab_on_grade", "grade_beam", "beam", "other"]},
         "tag": {"type": "string"}, "sheet": {"type": "string"},
         "formulas": {"type": "object", "additionalProperties": EXPRESSION_SCHEMA, "description": "field -> formula"},
         "reason": {"type": "string"}, "evidence": EVIDENCE_SCHEMA},
         "required": ["element_type", "tag", "sheet", "formulas", "reason", "evidence"]}},
    {"name": "propose_bill_line_override", "fn": _propose("bill_override"),
     "description": "Propose overriding a bill line's measured quantity. Use only when element changes cannot express it.",
     "schema": {"type": "object", "properties": {
         "line_id": {"type": "string"}, "formula": EXPRESSION_SCHEMA, "reason": {"type": "string"}, "evidence": EVIDENCE_SCHEMA},
         "required": ["line_id", "formula", "reason", "evidence"]}},
    {"name": "propose_project_input", "fn": _propose("project_input"),
     "description": "Propose a project value read from the notes: blinding_mm or footing_cover_mm.",
     "schema": {"type": "object", "properties": {
         "key": {"type": "string", "enum": ["blinding_mm", "footing_cover_mm"]}, "value": {"type": "number"},
         "reason": {"type": "string"}, "evidence": EVIDENCE_SCHEMA},
         "required": ["key", "value", "reason", "evidence"]}},
    {"name": "propose_sheet_role", "fn": _propose("sheet_role"),
     "description": "Propose the role of a sheet the register has wrong or unknown (footing_schedule, column_schedule, beam_schedule, wall_schedule, foundation_plan, floor_plan, reinforcement_plan, section_detail, general_notes).",
     "schema": {"type": "object", "properties": {
         "sheet": {"type": "string"},
         "role": {"type": "string", "enum": ["footing_schedule", "column_schedule", "beam_schedule", "wall_schedule", "foundation_plan", "floor_plan", "framing_plan", "reinforcement_plan", "section_detail", "general_notes", "other"]},
         "floor": {"type": "string"}, "reason": {"type": "string"}, "evidence": EVIDENCE_SCHEMA},
         "required": ["sheet", "role", "reason", "evidence"]}},
]

BY_NAME = {t["name"]: t for t in TOOLS}


def run_tool(ctx, name, args):
    tool = BY_NAME.get(name)
    if not tool:
        return _compact({"error": f"Unknown tool '{name}'"}), True
    if not isinstance(args, dict) or "_invalid_json" in args:
        return _compact({"error": "Tool input was not valid JSON."}), True
    try:
        result = tool["fn"](ctx, args)
    except Exception as exc:  # a tool failure goes back to the model, it does not end the turn
        return _compact({"error": f"{type(exc).__name__}: {str(exc)[:300]}"}), True
    return _compact(result), bool(isinstance(result, dict) and result.get("error"))
