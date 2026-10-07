"""Bill comparison line traceability and manual measured-quantity adjustments."""
import json
from pathlib import Path

from .measurements import load_measurement_bundle

FOUNDATION_KEYS = frozenset({
    "blinding_m3",
    "footing_m3",
    "footing_m2",
    "footing_kg",
    "raft_m3",
    "raft_m2",
    "raft_kg",
    "neck_wall_m3",
})

# element_types set -> quantity field on each measurement record
_ROLLUP = {
    "footing_m3": ({"footing"}, "concrete_m3"),
    "footing_m2": ({"footing"}, "formwork_m2"),
    "footing_kg": ({"footing"}, "rebar_kg"),
    "raft_m3": ({"raft"}, "concrete_m3"),
    "raft_m2": ({"raft"}, "formwork_m2"),
    "raft_kg": ({"raft"}, "rebar_kg"),
    "blinding_m3": ({"footing"}, "blinding_m3"),
    "neck_m3": ({"column_neck"}, "concrete_m3"),
    "neck_m2": ({"column_neck"}, "formwork_m2"),
    "neck_kg": ({"column_neck"}, "rebar_kg"),
    "column_m3": ({"column", "column_storey"}, "concrete_m3"),
    "column_m2": ({"column", "column_storey"}, "formwork_m2"),
    "column_kg": ({"column", "column_steel", "column_neck"}, "rebar_kg"),
    "wall_m3": ({"wall", "wall_storey", "shear_wall", "core_wall"}, "concrete_m3"),
    "wall_m2": ({"wall", "wall_storey"}, "formwork_m2"),
    "wall_kg": ({"wall", "wall_steel"}, "rebar_kg"),
    "shear_wall_m3": ({"wall_storey", "shear_wall"}, "concrete_m3"),
    "shear_wall_m2": ({"wall_storey", "shear_wall"}, "formwork_m2"),
    "core_wall_m3": ({"wall_storey", "core_wall"}, "concrete_m3"),
    "core_wall_m2": ({"wall_storey", "core_wall"}, "formwork_m2"),
    "slab_m3": ({"slab", "slab_on_grade", "suspended_slab"}, "concrete_m3"),
    "slab_m2": ({"slab", "slab_on_grade", "suspended_slab"}, "area_m2"),
    "slab_kg": ({"slab", "sog_steel", "suspended_steel"}, "rebar_kg"),
    "sog_m3": ({"slab_on_grade"}, "concrete_m3"),
    "sog_m2": ({"slab_on_grade"}, "area_m2"),
    "sog_kg": ({"sog_steel"}, "rebar_kg"),
    "suspended_m3": ({"suspended_slab"}, "concrete_m3"),
    "suspended_m2": ({"suspended_slab"}, "area_m2"),
    "suspended_kg": ({"suspended_steel"}, "rebar_kg"),
    "beam_m3": ({"beam", "grade_beam", "framed_beam"}, "concrete_m3"),
    "beam_m2": ({"beam", "grade_beam", "framed_beam"}, "formwork_m2"),
    "beam_kg": ({"beam", "beam_steel"}, "rebar_kg"),
    "grade_beam_m3": ({"grade_beam"}, "concrete_m3"),
    "grade_beam_m2": ({"grade_beam"}, "formwork_m2"),
    "boundary_beam_m3": ({"boundary_beam"}, "concrete_m3"),
    "boundary_beam_m2": ({"boundary_beam"}, "formwork_m2"),
    "tank_wall_m3": ({"tank_wall"}, "concrete_m3"),
    "tank_wall_m2": ({"tank_wall"}, "formwork_m2"),
    "lift_pit_wall_m3": ({"lift_pit_wall"}, "concrete_m3"),
    "lift_pit_wall_m2": ({"lift_pit_wall"}, "formwork_m2"),
    "upstand_m3": ({"upstand"}, "concrete_m3"),
    "upstand_m2": ({"upstand"}, "formwork_m2"),
}

_FORMULA_HINT = {
    "footing_m3": "Sum of footing concrete: area from plan outline × depth from footing schedule (per tag).",
    "footing_m2": "Sum of footing formwork: perimeter × schedule depth per outline.",
    "footing_kg": "Sum of footing steel from schedule bars (both ways, inside cover).",
    "blinding_m3": "Pad blinding from schedule + plan areas under slabs/rafts per project rules.",
    "raft_m3": "Raft concrete: closed outline area × thickness from raft note.",
    "raft_m2": "Raft edge formwork from outline length × thickness.",
    "raft_kg": "Raft mesh from note inside each raft outline.",
    "column_m3": "Plan area of column marks × storey height minus the beam depth on the floor above.",
    "column_m2": "Sum of column perimeters × clear storey height for formwork.",
    "column_kg": "Column longitudinal bars + ties from column schedule × floor height.",
    "slab_m3": "Bay outline area × slab thickness from notes / callouts.",
    "slab_m2": "Soffit area of slab panels + perimeter edge formwork.",
    "slab_kg": "Top and bottom reinforcement mesh / bars per m² from drawings.",
    "sog_m3": "Outline around each slab-on-grade note, raft footprint removed × thickness.",
    "sog_m2": "Slab on grade top surface area.",
    "sog_kg": "Slab-on-grade mesh from reinforcement plan laid over area.",
    "suspended_m3": "Outline around each thickness note less openings × thickness + monolithic framed beams.",
    "suspended_m2": "Soffit of slab outline plus free edges and opening edges × thickness.",
    "suspended_kg": "Suspended slab mesh and additional marked bars.",
    "beam_m3": "Beam span length × width × depth from beam schedules and plan layout.",
    "beam_m2": "Beam soffit and sides (2 × depth + width) × clear span.",
    "beam_kg": "Beam top & bottom bars + links per schedule × span.",
    "grade_beam_m3": "Grade beam label size × paired edges.",
    "grade_beam_m2": "Two sides plus soffit of grade beam section.",
    "wall_m3": "All wall plan outlines × clear storey height.",
    "wall_m2": "Both faces contact area (2 × length × height) + end formwork.",
    "wall_kg": "Vertical & horizontal reinforcement distribution per wall schedule.",
    "shear_wall_m3": "Shear wall outlines × storey height × bar detail thickness.",
    "core_wall_m3": "Core wall outlines × storey height × bar detail thickness.",
    "neck_wall_m3": "From isolated footing top to ground beam underside.",
}


def _adjustments_path(project):
    return Path(project) / "out" / "bill-adjustments.json"


def load_bill_adjustments(project):
    path = _adjustments_path(project)
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("lines") or {}


def adjust_bill_line(project, item_key, patch):
    """Persist QS override to the measured (ours) quantity on a bill line."""
    project = Path(project)
    out = project / "out"
    out.mkdir(parents=True, exist_ok=True)
    path = _adjustments_path(project)
    data = {"lines": load_bill_adjustments(project)}
    entry = dict(data["lines"].get(item_key) or {})
    entry["item_key"] = item_key
    if patch.get("ours") is not None:
        entry["ours"] = float(patch["ours"])
    for key in ("formula", "note", "adjustment_reason"):
        if key in patch and patch[key] is not None:
            entry[key] = patch[key]
    entry["status"] = "adjusted"
    data["lines"][item_key] = entry
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return entry


def _manifest_sheets_for_key(manifest, key):
    sheets = manifest.get("sheets") or []
    if key in FOUNDATION_KEYS:
        roles = {"foundation_plan", "reinforcement_plan"}
        picked = [s for s in sheets if (s.get("role") or "") in roles]
        if key.endswith("_kg") and not picked:
            picked = [s for s in sheets if "reinf" in (s.get("stem") or "").lower()]
        return picked
    roles = {"floor_plan", "reinforcement_plan", "structural_plan", "column_schedule", "beam_schedule"}
    return [s for s in sheets if (s.get("role") or "") in roles or "plan" in (s.get("role") or "")]


def _file_sources(out_dir, manifest, key):
    rel = []
    bill = manifest.get("bill_workbook") or ""
    if bill:
        rel.append({"role": "consultant_bill", "file": bill, "detail": "Bill column in comparison"})
    if key in FOUNDATION_KEYS:
        rel.append({"role": "engine_output", "file": "out/foundations-compare.csv", "detail": "Foundations run"})
        rel.append({"role": "engine_output", "file": "out/measurements.json", "detail": "Per-footing dimensions and roll-up"})
    else:
        rel.append({"role": "engine_output", "file": "out/structure-compare.csv", "detail": "Structure run"})
        rel.append({"role": "engine_output", "file": "out/measurements.json", "detail": "Element measurements where available"})
    full = out_dir / "full-structural-compare.csv"
    if full.is_file():
        rel.append({"role": "engine_output", "file": "out/full-structural-compare.csv", "detail": "Merged comparison"})
    return rel


def _manifest_sheet_map(manifest):
    by_stem = {}
    for sheet in manifest.get("sheets") or []:
        stem = sheet.get("stem") or ""
        if stem:
            by_stem[stem] = sheet
    return by_stem


def placements_for_bill_key(project_dir, manifest, key, shape_index=None):
    """Each measured element that rolls into this bill line, with drawing placement when known."""
    spec = _ROLLUP.get(key)
    if not spec:
        return []
    element_types, field = spec
    if isinstance(element_types, str):
        element_types = {element_types}
    shape_index = shape_index or {}
    by_stem = _manifest_sheet_map(manifest)
    bundle = load_measurement_bundle(Path(project_dir))
    records = bundle.get("measurements") or []
    placements = []
    for record in records:
        rec_type = record.get("element_type") or ""
        if rec_type not in element_types:
            continue
        val = (record.get("quantities") or {}).get(field)
        if val in (None, ""):
            continue
        try:
            qty = float(val)
        except (TypeError, ValueError):
            continue
        mid = record.get("id") or ""
        sheet_stem = record.get("sheet") or ""
        linked = shape_index.get(mid) or {}
        if not linked.get("shapeId") and shape_index:
            prefix_match = next((item for k, item in shape_index.items() if (k.startswith(mid) or mid.startswith(k))), None)
            if prefix_match:
                linked = prefix_match
            else:
                target_kind = "column" if "col" in rec_type else ("slab" if "slab" in rec_type or "sog" in rec_type else ("beam" if "beam" in rec_type else ("wall" if "wall" in rec_type else ("footing" if "foot" in rec_type or "neck" in rec_type else ""))))
                if target_kind:
                    kind_match = next((item for item in shape_index.values() if item.get("sheetId") == sheet_stem and item.get("kind") == target_kind), None)
                    if kind_match:
                        linked = kind_match
        manifest_row = by_stem.get(sheet_stem) or {}
        inputs = record.get("inputs") or {}
        placements.append({
            "measurementId": mid,
            "shapeId": linked.get("shapeId") or "",
            "sheetId": linked.get("sheetId") or sheet_stem,
            "sheetCode": linked.get("sheetCode") or manifest_row.get("sheet_no") or "",
            "sourceFile": manifest_row.get("file") or f"{sheet_stem}.dwg",
            "sourceRole": manifest_row.get("role") or "",
            "tag": record.get("tag") or "",
            "label": linked.get("label") or record.get("tag") or "",
            "kind": linked.get("kind") or rec_type,
            "quantity": round(qty, 4),
            "quantityField": field,
            "widthMm": inputs.get("width_mm"),
            "heightMm": inputs.get("height_mm"),
            "depthMm": inputs.get("depth_mm"),
            "areaM2": inputs.get("area_m2"),
        })
    placements.sort(key=lambda row: (row.get("sheetId") or "", row.get("tag") or ""))
    return placements


def rollup_for_bill_key(project_dir, key):
    """Aggregate element records that feed a bill line."""
    spec = _ROLLUP.get(key)
    if not spec:
        return {}
    element_types, field = spec
    if isinstance(element_types, str):
        element_types = {element_types}
    bundle = load_measurement_bundle(Path(project_dir))
    records = bundle.get("measurements") or []
    total = 0.0
    count = 0
    sheets = set()
    formulas = []
    for record in records:
        if (record.get("element_type") or "") not in element_types:
            continue
        val = (record.get("quantities") or {}).get(field)
        if val in (None, ""):
            continue
        try:
            total += float(val)
        except (TypeError, ValueError):
            continue
        count += 1
        if record.get("sheet"):
            sheets.add(record["sheet"])
        if record.get("formula") and record["formula"] not in formulas:
            formulas.append(record["formula"])
    if not count:
        return {}
    return {
        "elementCount": count,
        "rolledTotal": round(total, 3),
        "quantityField": field,
        "elementType": next(iter(element_types)),
        "sheets": sorted(sheets),
        "perElementFormula": formulas[0] if len(formulas) == 1 else (formulas[0] if formulas else ""),
    }


def trace_for_bill_line(project_dir, manifest, key, note_from_csv, shape_index=None):
    """Structured traceability for one comparison row."""
    out_dir = Path(project_dir) / "out"
    formula = note_from_csv or _FORMULA_HINT.get(key) or ""
    sources = _file_sources(out_dir, manifest, key)
    for sheet in _manifest_sheets_for_key(manifest, key)[:8]:
        stem = sheet.get("stem") or ""
        sources.append({
            "role": "drawing",
            "file": sheet.get("file") or f"{stem}.dwg",
            "detail": f"{sheet.get('role', 'sheet').replace('_', ' ')} · {sheet.get('title') or stem}",
        })
    inputs = rollup_for_bill_key(project_dir, key)
    placements = placements_for_bill_key(project_dir, manifest, key, shape_index)
    return {
        "formula": formula,
        "sources": sources,
        "inputs": inputs,
        "placements": placements,
    }


def apply_bill_adjustments(rows, adjustments):
    if not adjustments:
        return rows
    out = []
    for row in rows:
        key = row.get("id") or row.get("key")
        patch = adjustments.get(key)
        if not patch:
            out.append(row)
            continue
        merged = dict(row)
        engine_ours = merged.get("engineOurs")
        if engine_ours is None and "engineOurs" not in merged:
            merged["engineOurs"] = merged.get("ours")
            engine_ours = merged["engineOurs"]
        if patch.get("ours") is not None:
            merged["ours"] = patch["ours"]
        merged["adjusted"] = True
        merged["adjustmentReason"] = patch.get("adjustment_reason") or patch.get("adjustmentReason") or ""
        if patch.get("formula"):
            merged["formula"] = patch["formula"]
        if patch.get("note"):
            merged["note"] = patch["note"]
        bill = merged.get("bill")
        ours = merged.get("ours")
        if bill is not None and ours is not None:
            merged["difference"] = ours - bill
            merged["pct"] = (ours - bill) / bill * 100 if bill else None
        sources = list(merged.get("sources") or [])
        reason = merged.get("adjustmentReason")
        if reason:
            sources.append({"role": "manual_adjustment", "detail": reason})
            merged["sources"] = sources
        out.append(merged)
    return out
