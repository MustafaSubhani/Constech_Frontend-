"""Bar quantities: mass per metre, mats clipped to an outline, laps and hooks.

Lap and hook lengths belong to the lap table the drawings point to. Until that
table is read, only the lengths typed in below are priced. Any other lap or
hook is counted and reported, not guessed.
"""
import math
import re

_MARK = re.compile(r"T\s*(\d+)\s*@\s*(\d+)\s*-\s*[TB]\d+", re.I)
_LENGTH = re.compile(r"L\s*=\s*(\d+(?:\.\d+)?)\s*m", re.I)

STOCK_MM = 12000.0
STOCK_SOURCE = "12 m supply length (assumed; no sheet states it)"

LAP_TABLE = {12: {"lap": 560.0, "hook": 150.0}}
LAP_SOURCE = "S-010 detail 9, class B, 35 MPa row (typed in, not read from the sheet)"


def kg_per_m(diameter):
    return diameter ** 2 / 162.0


def _lengths(geometry):
    if geometry.is_empty:
        return []
    kind = geometry.geom_type
    if kind == "LineString":
        return [geometry.length]
    if kind in ("MultiLineString", "GeometryCollection"):
        found = []
        for part in geometry.geoms:
            found.extend(_lengths(part))
        return found
    return []


def bar_pieces(polygon, spacing, cover=0.0):
    """Bar lengths of one mat in both directions, clipped to the outline inside the cover.

    A bar stops at a hole, so each piece is a separate bar.
    """
    from shapely.geometry import LineString

    inner = polygon.buffer(-cover, join_style=2) if cover else polygon
    if inner.is_empty or spacing <= 0:
        return [], []
    minx, miny, maxx, maxy = inner.bounds
    along_x, along_y = [], []
    y = miny
    while y <= maxy + 1e-6:
        along_x.extend(_lengths(LineString([(minx - 1, y), (maxx + 1, y)]).intersection(inner)))
        y += spacing
    x = minx
    while x <= maxx + 1e-6:
        along_y.extend(_lengths(LineString([(x, miny - 1), (x, maxy + 1)]).intersection(inner)))
        x += spacing
    return along_x, along_y


def mat_steel(polygon, diameter, spacing, mats=1, cover=0.0, hooked=False):
    """Mass of a bar mesh over an outline, with laps where a bar is longer than stock."""
    along_x, along_y = bar_pieces(polygon, spacing, cover)
    pieces = [length for length in along_x + along_y if length > 0]
    laps = sum(max(0, math.ceil(length / STOCK_MM) - 1) for length in pieces)
    hooks = 2 * len(pieces) if hooked else 0
    length = sum(pieces)
    table = LAP_TABLE.get(diameter)
    unpriced_laps = unpriced_hooks = 0
    if table:
        length += laps * table["lap"] + hooks * table["hook"]
    else:
        unpriced_laps, unpriced_hooks = laps, hooks
    return {
        "kg": length / 1000.0 * kg_per_m(diameter) * mats,
        "bars": len(pieces) * mats,
        "laps": laps * mats,
        "hooks": hooks * mats,
        "unpriced_laps": unpriced_laps * mats,
        "unpriced_hooks": unpriced_hooks * mats,
    }


def _claim(marks, pool, limit, key):
    """Give each mark the nearest unused item, closest pairs first."""
    pairs = []
    for index, mark in enumerate(marks):
        for item in pool:
            dist = math.hypot(mark["x"] - item["x"], mark["y"] - item["y"])
            if dist <= limit:
                pairs.append((dist, index, item))
    pairs.sort(key=lambda pair: pair[0])
    used_marks = set()
    used_items = set()
    for dist, index, item in pairs:
        if index in used_marks or id(item) in used_items:
            continue
        marks[index][key] = item
        used_marks.add(index)
        used_items.add(id(item))


def extra_marked_kg(dump, contains=None):
    """Additional bars written as T16@200-T2 with a length and a range line.

    The base mesh note has no -T1/-B2 suffix and is not included here. A mark
    with no length, or no distribution line of its own, is left out.
    """
    marks = []
    lengths = []
    for text in dump.get("entities", []):
        if text.get("kind") != "text" or not text.get("text"):
            continue
        flat = " ".join(text["text"].replace("\n", " ").split())
        if contains and not contains(text["x"], text["y"]):
            continue
        found = _MARK.search(flat)
        if found:
            marks.append({
                "dia": int(found.group(1)),
                "spacing": int(found.group(2)),
                "x": text["x"],
                "y": text["y"],
            })
        length = _LENGTH.search(flat)
        if length:
            lengths.append({"metres": float(length.group(1)), "x": text["x"], "y": text["y"]})
    ranges = []
    for entity in dump.get("entities", []):
        if entity.get("kind") != "line" or "DETL" not in entity.get("layer", "").upper():
            continue
        span = math.hypot(entity["x2"] - entity["x1"], entity["y2"] - entity["y1"])
        if not 400 <= span <= 20000:
            continue
        ranges.append({
            "mm": span,
            "x": (entity["x1"] + entity["x2"]) / 2,
            "y": (entity["y1"] + entity["y2"]) / 2,
        })
    _claim(marks, lengths, 1200, "cut")
    _claim(marks, ranges, 2200, "span")
    total = 0.0
    counted = 0
    for mark in marks:
        if "cut" not in mark or "span" not in mark:
            continue
        count = int(mark["span"]["mm"] / mark["spacing"]) + 1
        total += count * mark["cut"]["metres"] * kg_per_m(mark["dia"])
        counted += 1
    return total, counted, len(marks)
