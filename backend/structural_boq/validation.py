"""Three-way structural validation: tender bill, Courtyard takeoff, engine."""
import csv
import json
from pathlib import Path

from .bill import foundation_baseline
from .courtyard import courtyard_summary_baseline, find_courtyard_workbook
from .foundations import _find_bill
from .structure import _structure_bill

FULL_COMPARE_NAME = "full-structural-compare.csv"

KEY_ORDER = [
    "blinding_m3",
    "raft_m3", "raft_m2", "raft_kg",
    "footing_m3", "footing_m2", "footing_kg",
    "neck_m3", "neck_m2", "neck_kg",
    "wall_m3", "wall_m2", "wall_kg",
    "grade_beam_m3", "grade_beam_m2", "grade_beam_kg",
    "tank_wall_m3", "tank_wall_m2", "tank_wall_kg",
    "lift_pit_wall_m3", "lift_pit_wall_m2", "lift_pit_wall_kg",
    "sog_m3", "sog_m2", "sog_kg",
    "column_m3", "column_m2", "column_kg",
    "suspended_m3", "suspended_m2", "suspended_kg",
    "beam_m3", "beam_m2",
    "shear_wall_m3", "shear_wall_m2", "shear_wall_kg",
    "core_wall_m3", "core_wall_m2", "core_wall_kg",
    "upstand_m3", "upstand_m2",
    "boundary_beam_m3", "boundary_beam_m2",
]


def _parse_compare_csv(path):
    ours = {}
    bill = {}
    notes = {}
    if not path.is_file():
        return ours, bill, notes
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            key = (row.get("item") or "").strip()
            if not key:
                continue
            note = row.get("note") or row.get("reason") or ""
            if note:
                notes[key] = note
            for field, target in (("bill", bill), ("ours", ours)):
                raw = row.get(field)
                if raw is None or raw == "":
                    continue
                try:
                    target[key] = float(raw)
                except ValueError:
                    pass
    return ours, bill, notes


def _ordered_keys(*dicts):
    seen = set()
    keys = []
    for key in KEY_ORDER:
        if any(key in d for d in dicts):
            keys.append(key)
            seen.add(key)
    for d in dicts:
        for key in d:
            if key not in seen:
                keys.append(key)
                seen.add(key)
    return keys


def write_full_compare(path, bill, courtyard, ours, notes=None):
    notes = notes or {}
    keys = _ordered_keys(bill, courtyard, ours)
    table = [[
        "item", "bill", "courtyard", "ours",
        "diff_bill", "pct_bill", "diff_courtyard", "pct_courtyard", "note",
    ]]
    for key in keys:
        b = bill.get(key)
        c = courtyard.get(key)
        o = ours.get(key)
        note = notes.get(key, "")
        if o is None and b is None and c is None:
            continue
        diff_b = pct_b = diff_c = pct_c = ""
        if o is not None and b is not None:
            diff_b = o - b
            pct_b = diff_b / b * 100 if b else 0
        if o is not None and c is not None:
            diff_c = o - c
            pct_c = diff_c / c * 100 if c else 0
        table.append([
            key,
            "" if b is None else f"{b:.3f}",
            "" if c is None else f"{c:.3f}",
            "" if o is None else f"{o:.3f}",
            "" if diff_b == "" else f"{diff_b:.3f}",
            "" if pct_b == "" else f"{pct_b:.1f}",
            "" if diff_c == "" else f"{diff_c:.3f}",
            "" if pct_c == "" else f"{pct_c:.1f}",
            note,
        ])
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        csv.writer(handle).writerows(table)
    return table


_STEEL_COMPARE_KEYS = {
    "footing_steel": "footing_kg",
    "sog_steel": "sog_kg",
    "suspended_steel": "suspended_kg",
    "raft": "raft_kg",
}


def write_steel_basis(project):
    """Summarize measured vs estimated steel lines for compare and review."""
    path = Path(project) / "out" / "measurements.json"
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    lines = {}
    for rec in data.get("measurements") or []:
        if rec.get("tag") != "TOTAL":
            continue
        compare_key = _STEEL_COMPARE_KEYS.get(rec.get("element_type") or "")
        if not compare_key:
            continue
        qty = (rec.get("quantities") or {}).get("rebar_kg")
        lines[compare_key] = {
            "kg": qty,
            "basis": rec.get("rebar_basis") or "unknown",
            "flags": rec.get("rebar_flags") or [],
            "note": rec.get("note") or "",
        }
    out_path = Path(project) / "out" / "steel-basis.json"
    out_path.write_text(json.dumps({"lines": lines}, indent=2), encoding="utf-8")
    return lines


def run_full_compare(project):
    project = Path(project)
    out_dir = project / "out"
    bill_path = _find_bill(project)
    courtyard_path = find_courtyard_workbook(project)

    bill = {}
    if bill_path:
        bill = {**foundation_baseline(bill_path), **_structure_bill(bill_path)}

    courtyard = courtyard_summary_baseline(courtyard_path) if courtyard_path else {}

    f_ours, _f_bill, f_notes = _parse_compare_csv(out_dir / "foundations-compare.csv")
    s_ours, _s_bill, s_notes = _parse_compare_csv(out_dir / "structure-compare.csv")
    ours = {**f_ours, **s_ours}
    notes = {**f_notes, **s_notes}
    steel = write_steel_basis(project)
    for key, meta in steel.items():
        basis = meta.get("basis") or "unknown"
        flags = meta.get("flags") or []
        tag = f"[steel basis: {basis}" + (f"; {', '.join(flags[:4])}]" if flags else "]")
        notes[key] = (notes.get(key) or "").strip()
        notes[key] = f"{notes[key]} {tag}".strip() if notes[key] else tag

    path = out_dir / FULL_COMPARE_NAME
    table = write_full_compare(path, bill, courtyard, ours, notes)

    print("full structural compare", flush=True)
    if courtyard_path:
        print(f"  courtyard {courtyard_path.name}", flush=True)
    else:
        print("  courtyard workbook not found in project folder", flush=True)
    for row in table[1:]:
        if len(row) < 4:
            continue
        key, b, c, o = row[0], row[1], row[2], row[3]
        if not o:
            continue
        bits = []
        if b:
            bits.append(f"bill {row[4]} ({row[5]}%)")
        if c:
            bits.append(f"courtyard {row[6]} ({row[7]}%)")
        if bits:
            print(f"  {key}: ours {o}  " + "  ".join(bits), flush=True)
    print(f"wrote {path}", flush=True)
    return path


def run_validate(project):
    from .discovery import run_discover
    from .foundations import run_foundations
    from .structure import run_structure

    project = Path(project)
    run_discover(project, quick=False)
    run_foundations(project)
    run_structure(project)
    return run_full_compare(project)
