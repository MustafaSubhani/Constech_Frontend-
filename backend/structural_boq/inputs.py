"""Inputs register: what the drawing set supplied, what is missing, and what the QS set by hand.

Every entry is derived from the discovery manifest. Nothing is assumed per project.
"""
import json
from pathlib import Path

from .rules import MANUAL_RULE_KEYS, load_manual_rules


def _inputs_path(project):
    return Path(project) / "out" / "project-inputs.json"


def load_inputs(project):
    path = _inputs_path(project)
    if not path.is_file():
        return {"values": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"values": {}}
    data.setdefault("values", {})
    return data


def save_inputs(project, values):
    data = load_inputs(project)
    for key, value in (values or {}).items():
        if key not in MANUAL_RULE_KEYS:
            raise ValueError(f"'{key}' cannot be set by hand")
        if value in (None, ""):
            data["values"].pop(key, None)
            continue
        number = float(value)
        if not 0 < number < 2000:
            raise ValueError(f"{key} must be between 0 and 2000 mm")
        data["values"][key] = int(round(number))
    path = _inputs_path(project)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return data


def _sheets_where(manifest, roles=(), signals=()):
    hits = []
    for sheet in manifest.get("sheets") or []:
        if (sheet.get("role") in roles) or (set(sheet.get("signals") or []) & set(signals)):
            hits.append({
                "stem": sheet.get("stem") or "",
                "file": sheet.get("file") or "",
                "role": (sheet.get("role") or "").replace("_", " "),
            })
    return hits


def _entry(key, label, group, feeds, sheets, *, upload=None, manual=None, missing_note="", partial=False):
    status = "found" if sheets else "missing"
    if sheets and partial:
        status = "partial"
    return {
        "key": key,
        "label": label,
        "group": group,
        "feeds": feeds,
        "status": status,
        "sheets": sheets[:8],
        "sheetCount": len(sheets),
        "upload": upload,
        "manual": manual,
        "missingNote": missing_note,
    }


_MEASURED_EVIDENCE = {
    "footing_schedule": ({"footing"}, "schedule"),
    "slab_notes": ({"suspended_slab", "slab_on_grade"}, None),
    "levels": ({"column_storey", "wall_storey"}, None),
    "wall_marks": ({"wall_storey", "shear_wall", "core_wall"}, None),
    "beam_schedule": ({"grade_beam", "beam", "framed_beam"}, None),
}


def _measured_sheets(records, types, role):
    sheets = {}
    for record in records or []:
        if record.get("element_type") not in types or not record.get("sheet"):
            continue
        if role and not any(s.get("role") == role for s in record.get("sources") or []):
            continue
        sheets[record["sheet"]] = {"stem": record["sheet"], "file": "", "role": "used by the engine"}
    return list(sheets.values())


def inputs_register(project, manifest, bill_rel="", records=()):
    """records: measurement records, so an input the engine demonstrably used counts as found."""
    project = Path(project)
    manual_rules = load_manual_rules(project)
    rules = manifest.get("rules_from_notes") or {}
    caps = {c.get("id"): c for c in manifest.get("capabilities") or []}
    dwg_pdf = {"accept": ".dwg,.pdf", "hint": "DWG or searchable PDF"}
    entries = [
        _entry(
            "foundation_plan", "Foundation plan", "Drawings", ["Footings", "Rafts", "Blinding"],
            _sheets_where(manifest, roles=("foundation_plan", "foundation_layout")),
            upload=dwg_pdf, missing_note="Footing and raft outlines are measured on this sheet.",
        ),
        _entry(
            "floor_plans", "Floor and framing plans", "Drawings", ["Columns", "Slabs", "Beams", "Walls"],
            _sheets_where(manifest, roles=("floor_plan", "framing_plan")),
            upload=dwg_pdf, missing_note="Superstructure quantities come from these plans.",
        ),
        _entry(
            "reinforcement_plans", "Reinforcement plans", "Drawings", ["Slab steel"],
            _sheets_where(manifest, roles=("reinforcement_plan",)),
            upload=dwg_pdf, missing_note="Slab mesh weights are read from reinforcement plans.",
        ),
        _entry(
            "footing_schedule", "Footing schedule", "Schedules", ["Footing concrete", "Footing steel"],
            _sheets_where(manifest, roles=("footing_schedule",), signals=("footing_schedule_table",)),
            upload=dwg_pdf,
            missing_note="Without it, footing depth and bars cannot be read.",
            partial=(caps.get("footings_isolated") or {}).get("status") == "partial",
        ),
        _entry(
            "column_schedule", "Column schedule", "Schedules", ["Column steel"],
            _sheets_where(manifest, roles=("column_schedule",)),
            upload=dwg_pdf, missing_note="Column bars and ties come from the column schedule.",
        ),
        _entry(
            "beam_schedule", "Beam schedule or sized beam labels", "Schedules", ["Beams"],
            _sheets_where(manifest, roles=("beam_schedule",), signals=("beam_labels_sized",)),
            upload=dwg_pdf, missing_note="Beam sections are read from labels like GB1(250X400) or a schedule.",
        ),
        _entry(
            "wall_marks", "Wall marks or wall schedule", "Schedules", ["Walls"],
            _sheets_where(manifest, roles=("wall_schedule",), signals=("wall_marks",)),
            upload=dwg_pdf, missing_note="Walls are measured from W-marks on plans.",
        ),
        _entry(
            "slab_notes", "Slab thickness notes", "Notes on plans", ["Slabs"],
            _sheets_where(manifest, signals=("slab_thk_notes", "slab_thickness_text")),
            upload=dwg_pdf, missing_note="Slab volume needs 'SLAB THK = n mm' notes on the plans.",
        ),
        _entry(
            "levels", "Storey levels (SSL)", "Notes on plans", ["Columns", "Walls"],
            _sheets_where(manifest, signals=("ssl_spot_levels", "other_level_marks")),
            upload=dwg_pdf, missing_note="Storey heights are read from SSL spot levels.",
            partial="storey_heights_ssl" not in caps,
        ),
    ]
    ref_roles = {
        "footing_schedule": "footing_schedule",
        "column_schedule": "column_schedule",
        "beam_schedule": "beam_schedule",
        "wall_marks": "wall_schedule",
    }
    for entry in entries:
        role = ref_roles.get(entry["key"])
        refs = [r for r in manifest.get("references") or [] if r.get("role") == role]
        if refs:
            found_ref = next((r for r in refs if r.get("stem")), None)
            missing_ref = next((r for r in refs if not r.get("stem")), None)
            if found_ref:
                entry["detail"] = f"Linked from {found_ref['from']} ('{found_ref['text']}')"
            elif missing_ref and entry["status"] == "missing":
                entry["missingNote"] = (
                    f"{missing_ref['from']} refers to sheet {missing_ref['token']} ('{missing_ref['text']}'), "
                    f"but that sheet is not in the project. Upload it."
                )
    for entry in entries:
        spec = _MEASURED_EVIDENCE.get(entry["key"])
        if not spec or entry["status"] != "missing":
            continue
        used = _measured_sheets(records, *spec)
        if used:
            entry["status"] = "found"
            entry["sheets"] = used[:8]
            entry["sheetCount"] = len(used)
            entry["detail"] = "Not flagged by discovery, but the engine measured from it"
    notes_sheets = _sheets_where(manifest, roles=("general_notes",))
    for key, label, feeds in (
        ("blinding_mm", "Blinding thickness", ["Blinding"]),
        ("footing_cover_mm", "Footing bar cover", ["Footing steel"]),
    ):
        value = rules.get(key)
        source = rules.get("blinding_source" if key == "blinding_mm" else "cover_source") or ""
        entry = _entry(
            key, label, "General notes", feeds,
            notes_sheets if value is not None else [],
            upload={"accept": ".pdf,.dwg,.txt,.md", "hint": "General notes sheet or a notes text file"},
            manual={"unit": "mm", "value": manual_rules.get(key)},
            missing_note="Read from the general notes. Upload the notes or set the value.",
        )
        if key in manual_rules:
            entry["status"] = "manual"
        entry["value"] = manual_rules.get(key, value)
        entry["source"] = source
        entries.append(entry)
    entries.append({
        "key": "bill",
        "label": "Consultant bill",
        "group": "Commercial",
        "feeds": ["Bill comparison"],
        "status": "found" if bill_rel else "missing",
        "sheets": [{"stem": "", "file": bill_rel, "role": "bill"}] if bill_rel else [],
        "sheetCount": 1 if bill_rel else 0,
        "upload": {"accept": ".xlsx,.csv", "hint": "Bill of quantities (.xlsx or .csv)", "target": "bills"},
        "manual": None,
        "missingNote": "Upload a bill to compare measured quantities against.",
    })
    return entries
