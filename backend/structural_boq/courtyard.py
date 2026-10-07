"""Read Constech Courtyard quantity takeoff SUMMARY sheet into engine keys."""
from .bill import _load


def _float(raw):
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _subsection_label(desc):
    text = (desc or "").strip().lower()
    if text == "plain concrete":
        return "plain"
    if text == "reinforced concrete":
        return "rc"
    if text == "reinforcement":
        return "kg"
    if text == "shuttering":
        return "m2"
    return None


def _major_section(desc):
    text = (desc or "").strip().upper()
    if text == "SUBSTRUCTURE":
        return "sub"
    if text == "SUPERSTRUCTURE":
        return "super"
    return None


def _map_line(desc, subsection, major):
    text = (desc or "").strip().lower()
    if not text or subsection is None:
        return None
    if subsection == "plain" and "blinding" in text:
        return "blinding_m3"
    if subsection == "rc":
        if major == "sub":
            if text == "raft":
                return "raft_m3"
            if text == "footing":
                return "footing_m3"
            if "column neck" in text:
                return "neck_m3"
            if text == "wall":
                return "wall_m3"
            if "grade beam" in text:
                return "grade_beam_m3"
            if "tank wall" in text:
                return "tank_wall_m3"
            if "lift pit" in text:
                return "lift_pit_wall_m3"
            if "slab on grade" in text:
                return "sog_m3"
        if major == "super":
            if text == "column":
                return "column_m3"
            if "suspended slab" in text:
                return "suspended_m3"
            if "beam" in text and "capping" in text:
                return "beam_m3"
            if "shear wall" in text:
                return "shear_wall_m3"
            if "core wall" in text:
                return "core_wall_m3"
            if text == "upstand":
                return "upstand_m3"
    if subsection == "kg":
        if major == "sub":
            if text == "raft":
                return "raft_kg"
            if text == "footing":
                return "footing_kg"
            if "column neck" in text:
                return "neck_kg"
            if text == "wall":
                return "wall_kg"
            if "grade beam" in text:
                return "grade_beam_kg"
            if "tank wall" in text:
                return "tank_wall_kg"
            if "lift pit" in text:
                return "lift_pit_wall_kg"
            if "slab on grade" in text:
                return "sog_kg"
        if major == "super":
            if text == "column":
                return "column_kg"
            if "suspended slab" in text:
                return "suspended_kg"
            if "shear wall" in text:
                return "shear_wall_kg"
            if "core wall" in text:
                return "core_wall_kg"
    if subsection == "m2":
        if "to sides of raft" in text:
            return "raft_m2"
        if "to sides of footing" in text:
            return "footing_m2"
        if "column neck" in text:
            return "neck_m2"
        if "to sides of wall" in text and major == "sub":
            return "wall_m2"
        if "grade beam" in text:
            return "grade_beam_m2"
        if "tank wall" in text:
            return "tank_wall_m2"
        if "lift pit" in text:
            return "lift_pit_wall_m2"
        if text == "slab on grade" and major == "sub":
            return "sog_m2"
        if major == "super":
            if "to sides of column" in text:
                return "column_m2"
            if "suspended slab" in text:
                return "suspended_m2"
            if "beam" in text and "capping" in text:
                return "beam_m2"
            if "shear wall" in text:
                return "shear_wall_m2"
            if "core wall" in text:
                return "core_wall_m2"
            if "upstand" in text:
                return "upstand_m2"
    return None


def courtyard_summary_baseline(path):
    """CONSTECH column on the Courtyard SUMMARY sheet, keyed like the engine."""
    data = _load(path)
    rows = data.get("SUMMARY")
    if not rows:
        return {}
    found = {}
    subsection = None
    major = None
    in_concrete = False
    for row in sorted(rows):
        desc = str(rows[row].get("B") or "").strip()
        constech = _float(rows[row].get("C"))
        if not desc and constech is None:
            continue
        section = _major_section(desc)
        if section:
            major = section
            continue
        if desc.upper() == "CONCRETE WORK":
            in_concrete = True
            continue
        if not in_concrete:
            continue
        sub = _subsection_label(desc)
        if sub:
            subsection = sub
            continue
        key = _map_line(desc, subsection, major)
        if key and constech is not None and key not in found:
            found[key] = constech
    return found


def find_courtyard_workbook(project):
    from pathlib import Path

    project = Path(project)
    skip = {"out", "node_modules", ".git"}
    candidates = []
    for book in project.rglob("*.xlsx"):
        if set(book.parts) & skip or book.name.startswith("~$"):
            continue
        low = book.name.lower()
        if "courtyard" in low:
            candidates.append(book)
        elif "quantity takeoff" in low and "structural" in low:
            candidates.append(book)
    return sorted(candidates, key=lambda p: p.name)[0] if candidates else None
