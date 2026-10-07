"""Split measured bill quantities by storey.

A record's storey comes from the engine's own inputs when it wrote one, otherwise from the sheet it was
measured on. Substructure (footings, rafts, necks, pits) sits below the lowest storey and is grouped as
foundations. Whatever the element records do not account for in a line total is kept as "not split by
floor", so the floors always add up to the project figure and nothing is spread by guesswork.
"""
import re

from .sheets import FLOOR_ORDER, floor_of

FOUNDATIONS = "foundations"
UNSPLIT = "unsplit"

_SUBSTRUCTURE = {
    "footing", "footing_steel", "raft", "raft_steel", "column_neck", "neck_steel", "blinding",
    "lift_pit_wall", "pile", "pile_cap",
}
# Bill lines that are substructure by definition: their whole quantity sits under foundations.
_SUBSTRUCTURE_LINES = re.compile(r"^(blinding|footing|raft|neck|neck_wall|pile|pile_cap|lift_pit_wall)_(m3|m2|kg)$")
# Element types that have a bill line of their own; a broader line must not count them again.
_OWN_LINE = {
    "grade_beam": "grade_beam",
    "boundary_beam": "boundary_beam",
    "slab_on_grade": "sog",
    "suspended_slab": "suspended",
    "shear_wall": "shear_wall",
    "core_wall": "core_wall",
    "tank_wall": "tank_wall",
    "lift_pit_wall": "lift_pit_wall",
    "upstand": "upstand",
}
_SUBSTRUCTURE_SHEET = re.compile(r"FOUND|FOOTING|\bPILE", re.I)

_NAMES = {
    FOUNDATIONS: "Foundations",
    UNSPLIT: "Not split by floor",
    "basement3": "Basement 3",
    "basement2": "Basement 2",
    "basement": "Basement",
    "lower_ground": "Lower ground floor",
    "ground": "Ground floor",
    "mezzanine": "Mezzanine",
    "roof": "Roof",
    "upper": "Upper roof",
}


def floor_label(key):
    if key in _NAMES:
        return _NAMES[key]
    return f"{key.replace('_', ' ').capitalize()} floor"


def floor_rank(key):
    if key == FOUNDATIONS:
        return -1
    if key == UNSPLIT:
        return len(FLOOR_ORDER) + 1
    return FLOOR_ORDER.index(key) if key in FLOOR_ORDER else len(FLOOR_ORDER)


def _named_floor(value):
    if not isinstance(value, str) or not value.strip():
        return ""
    value = value.strip()
    if value.lower() in FLOOR_ORDER:
        return value.lower()
    if value.lower() in (FOUNDATIONS, "foundation", "substructure"):
        return FOUNDATIONS
    return floor_of(value)


def record_floor(record):
    inputs = record.get("inputs") or {}
    for value in (record.get("floor"), inputs.get("floor"), inputs.get("storey"), inputs.get("level")):
        key = _named_floor(value)
        if key:
            return key
    if (record.get("element_type") or "") in _SUBSTRUCTURE:
        return FOUNDATIONS
    sheet = record.get("sheet") or ""
    key = floor_of(sheet)
    if key:
        return key
    if _SUBSTRUCTURE_SHEET.search(sheet):
        return FOUNDATIONS
    return UNSPLIT


def split_quantity(total, digits, parts):
    """{floor: quantity} for one line. parts are (floor, quantity) from its element records."""
    if total is None:
        return {}
    shares = {}
    for floor, qty in parts:
        if qty:
            shares[floor] = shares.get(floor, 0.0) + qty
    rest = total - sum(shares.values())
    tolerance = max(abs(total) * 0.0005, 0.5 * 10 ** -(digits if digits is not None else 2))
    if rest < -tolerance:
        # The records add up to more than the line: they describe something broader, so do not split.
        return {UNSPLIT: round(total, 4)} if total else {}
    if abs(rest) > tolerance:
        shares[UNSPLIT] = shares.get(UNSPLIT, 0.0) + rest
    elif shares:
        # Rounding only: keep the floors summing exactly to the line total.
        largest = max(shares, key=lambda key: abs(shares[key]))
        shares[largest] += rest
    elif total:
        shares[UNSPLIT] = total
    return {key: round(value, 4) for key, value in shares.items() if abs(value) > 1e-9}


def apply_floor_split(rows, records):
    """Attach `floors` to each comparison row and return the ordered floor list for the project."""
    by_id = {record.get("id"): record for record in records or [] if record.get("id")}
    line_ids = {row.get("id") for row in rows}
    seen = set()
    for row in rows:
        line = row.get("id") or ""
        if row.get("custom"):
            key = _named_floor(row.get("floor") or "") or UNSPLIT
            row["floors"] = {key: row["ours"]} if row.get("ours") else {}
        elif _SUBSTRUCTURE_LINES.match(line):
            row["floors"] = {FOUNDATIONS: row["ours"]} if row.get("ours") else {}
        else:
            unit = line.rsplit("_", 1)[-1]
            parts = []
            for placement in row.get("placements") or []:
                record = by_id.get(placement.get("measurementId")) or {}
                own = _OWN_LINE.get(record.get("element_type") or "")
                if own and f"{own}_{unit}" != line and f"{own}_{unit}" in line_ids:
                    continue
                parts.append((record_floor(record) if record else UNSPLIT, placement.get("quantity") or 0.0))
            row["floors"] = split_quantity(row.get("ours"), row.get("digits"), parts)
        if not row.get("hidden"):
            seen.update(row["floors"])
    return [{"key": key, "label": floor_label(key)} for key in sorted(seen, key=floor_rank)]
