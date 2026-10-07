"""Foundations takeoff from a DWG dump.

Nothing here is named after a project, a file, or a CAD layer. A footing
schedule is whatever table on the sheet says it is a footing schedule and
then lists sizes. An outline is a footing when it matches one of those
sizes, or when a schedule tag sits inside it. The PDF, when one is beside
the DWG, is only the picture those outlines are drawn back onto.
"""
import csv
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import pymupdf

from .bill import foundation_baseline
from .geometry import bbox, bbox_size, centroid, perimeter, point_in_poly, shoelace, sizes_match
from .rebar import extra_marked_kg, kg_per_m, mat_steel
from .pdf_dump import dump_from_pdf
from .paths import DUMP_MJS
from .rules import find_rules

SIZE_RE = re.compile(r"(\d+)\s*[xX×]\s*(\d+)\s*[xX×]\s*(\d+)")
BAR_RE = re.compile(r"T\s*(\d+)\s*[-@]\s*(\d+)", re.I)
THK_RE = re.compile(r"(\d+(?:\.\d+)?)\s*mm", re.I)
TAG_RE = re.compile(r"^[A-Z]{1,3}\d{1,2}\*?$")
COVER_MM = 75


def _area_m2(vertices):
    return shoelace(vertices) / 1e6


def _texts(dump):
    return [e for e in dump["entities"] if e["kind"] == "text" and e.get("text")]


def _polylines(dump):
    return [e for e in dump["entities"] if e["kind"] == "polyline" and e.get("closed") and len(e.get("vertices") or []) >= 3]


def _median(values):
    ordered = sorted(values)
    if not ordered:
        return 0
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def _row_tolerance(cells):
    heights = [c.get("height") or 0 for c in cells if c.get("height")]
    if heights:
        return max(80, _median(heights) * 1.3)
    ys = sorted({round(c["y"]) for c in cells})
    gaps = [ys[i + 1] - ys[i] for i in range(len(ys) - 1) if ys[i + 1] - ys[i] > 1]
    return max(80, _median(gaps) * 0.45) if gaps else 200


def _cluster_rows(cells, tolerance):
    ordered = sorted(cells, key=lambda e: -e["y"])
    rows = []
    for cell in ordered:
        if not rows or abs(cell["y"] - _median([c["y"] for c in rows[-1]])) > tolerance:
            rows.append([cell])
        else:
            rows[-1].append(cell)
    return rows


_FOOTING_TITLE = re.compile(r"\b(FOOTINGS?|FOUNDATIONS?|PADS?|BASES?|PAD\s+FOOTINGS?)\b")
_OTHER_SCHEDULE = re.compile(r"\b(BEAMS?|COLUMNS?|WALLS?|SLABS?|LINTELS?|STAIRS?)\b")


def _is_footing_title(text):
    """'FOOTING SCHEDULE', 'SCHEDULE OF FOOTINGS', 'FOUNDATION SCHEDULE', 'PAD BASE SCHEDULE'...
    but not 'BEAM REINFORCEMENT SCHEDULE FOR FOUNDATION STRAP BEAMS'."""
    upper = " ".join(text.upper().split())
    if "SCHEDULE" not in upper:
        return False
    if "FOOTING" in upper:
        return True
    if len(upper) > 60:
        return False
    return bool(_FOOTING_TITLE.search(upper)) and not _OTHER_SCHEDULE.search(upper)


def _schedule_titles(dump):
    texts = _texts(dump)
    direct = [t for t in texts if _is_footing_title(t["text"])]
    if direct:
        return direct
    # Searchable PDFs often emit one word per token; merge each text row into a phrase.
    by_row = defaultdict(list)
    for text in texts:
        by_row[round(text["y"])].append(text)
    merged = []
    for row in by_row.values():
        phrase = " ".join(t["text"] for t in sorted(row, key=lambda e: e["x"]))
        upper = phrase.upper()
        if "SCHEDULE" in upper and (
            "FOOTING" in upper or (_FOOTING_TITLE.search(upper) and not _OTHER_SCHEDULE.search(upper))
        ):
            merged.append({
                "text": phrase,
                "x": min(t["x"] for t in row),
                "y": _median([t["y"] for t in row]),
            })
    return merged


def _schedule_cells(dump):
    """Texts that belong to the footing schedule, found from the title."""
    texts = _texts(dump)
    titles = _schedule_titles(dump)
    size_cells = [t for t in texts if SIZE_RE.search(t["text"].replace("\n", " "))]
    if not size_cells:
        return []
    if not titles:
        return size_cells
    title = min(titles, key=lambda t: t["y"])
    below = [c for c in size_cells if c["y"] < title["y"] + 100]
    below.sort(key=lambda c: -c["y"])
    if not below:
        return []
    ys = []
    for cell in below:
        if not ys or abs(ys[-1] - cell["y"]) > 30:
            ys.append(cell["y"])
    gaps = [ys[i] - ys[i + 1] for i in range(min(8, len(ys) - 1))]
    split = max(400, _median(gaps) * 3) if gaps else 1500
    kept_y = [ys[0]]
    for y in ys[1:]:
        if kept_y[-1] - y > split:
            break
        kept_y.append(y)
    low, high = min(kept_y), max(kept_y)
    tol = _row_tolerance(size_cells)
    on_rows = [t for t in texts if low - tol <= t["y"] <= high + tol]
    on_rows.sort(key=lambda t: t["x"])
    if not on_rows:
        return []
    # Split the row into tables. The footing schedule's columns sit a few
    # metres apart; another schedule further across the sheet is much further.
    groups = [[on_rows[0]]]
    for text in on_rows[1:]:
        if text["x"] - groups[-1][-1]["x"] > 4500:
            groups.append([text])
        else:
            groups[-1].append(text)
    def size_count(group):
        return sum(1 for text in group if SIZE_RE.search(text["text"].replace("\n", " ")))
    return max(groups, key=size_count)


_DIRECTION_WORDS = (
    ("both", re.compile(r"EACH\s+WAY|BOTH\s+WAYS|BOTH\s+DIRECTIONS|\bB\.\s*W\b|\bE\.\s*W\b")),
    ("long", re.compile(r"\bLONG")),
    ("short", re.compile(r"\bSHORT")),
    ("x", re.compile(r"\bX\s*-?\s*DIR|\(X\)|\bX\s+WAY")),
    ("y", re.compile(r"\bY\s*-?\s*DIR|\(Y\)|\bY\s+WAY")),
)


def _direction_of(text):
    flat = " ".join(text.upper().split())
    for name, pattern in _DIRECTION_WORDS:
        if pattern.search(flat):
            return name
    return None


def _bar_directions(dump, cells):
    """Direction written in the header over each bar column of the schedule.

    Returns a function from a cell's x to 'long', 'short', 'x', 'y', 'both',
    or None when the header does not say.
    """
    bar_xs = sorted(
        c["x"] for c in cells if BAR_RE.search(c["text"].replace("\n", " "))
    )
    if not bar_xs:
        return lambda x: None
    rows = _cluster_rows(cells, _row_tolerance(cells))
    tops = sorted((_median([c["y"] for c in row]) for row in rows), reverse=True)
    pitch = _median([tops[i] - tops[i + 1] for i in range(len(tops) - 1)]) if len(tops) > 1 else 0
    top = tops[0]
    titles = [t["y"] for t in _schedule_titles(dump) if t["y"] > top]
    ceiling = min(titles) if titles else top + 8 * (pitch or _row_tolerance(cells))
    columns = []
    gap = 2 * _row_tolerance(cells)
    for x in bar_xs:
        if not columns or x - columns[-1][-1] > gap:
            columns.append([x])
        else:
            columns[-1].append(x)
    centres = [_median(group) for group in columns]
    spacing = _median([centres[i + 1] - centres[i] for i in range(len(centres) - 1)]) if len(centres) > 1 else 0
    xs = sorted(c["x"] for c in cells)
    left, right = xs[0] - (spacing or 0), xs[-1] + (spacing or 0)
    headers = []
    for text in _texts(dump):
        if not (top < text["y"] < ceiling) or not (left <= text["x"] <= right):
            continue
        direction = _direction_of(text["text"])
        if direction:
            headers.append((text["x"], direction))

    def at(x):
        if not headers:
            return None
        hx, direction = min(headers, key=lambda item: abs(item[0] - x))
        if spacing and abs(hx - x) > spacing:
            return None
        return direction

    return at


def _parse_schedule(cells, direction_at=None):
    if not cells:
        return {}
    rows = _cluster_rows(cells, _row_tolerance(cells))
    table = {}
    for row in rows:
        row.sort(key=lambda e: e["x"])
        tag = _row_tag(row)
        if not tag:
            continue
        sizes = []
        for cell in row:
            match = SIZE_RE.search(cell["text"].replace("\n", " "))
            if match:
                sizes.append(tuple(int(n) for n in match.groups()))
        bars = []
        for cell in row:
            for match in BAR_RE.finditer(cell["text"].replace("\n", " ")):
                direction = direction_at(cell["x"]) if direction_at else None
                bars.append((int(match.group(1)), int(match.group(2)), direction))
        referred = any("REFER TO PLAN" in e["text"].upper() for e in row)
        table[tag] = {
            "tag": tag,
            "pcc": sizes[0] if sizes else None,
            "rc": sizes[1] if len(sizes) > 1 else (sizes[0] if sizes and not referred else None),
            "bars": bars,
            "refer_to_plan": referred and len(sizes) < 2,
        }
        if referred and len(sizes) >= 2:
            table[tag]["refer_to_plan"] = False
    return table


def _row_tag(row):
    for cell in row:
        token = cell["text"].strip()
        if TAG_RE.match(token):
            return token
    return None


def _shapes_for_schedule(dump, schedule, table_ids):
    """Closed outlines that match a scheduled plan size, plus any outline holding a tag."""
    rc_sizes = []
    for spec in schedule.values():
        if spec.get("rc"):
            rc_sizes.append(spec["rc"][:2])
    tags = _plan_tags(dump, schedule, table_ids)
    chosen = []
    seen = []
    for poly in _polylines(dump):
        width, height = bbox_size(poly["vertices"])
        matched = any(sizes_match(width, height, a, b) for a, b in rc_sizes)
        holds_tag = any(point_in_poly(tag["x"], tag["y"], poly["vertices"]) for tag in tags)
        if not matched and not holds_tag:
            continue
        box = (round(width), round(height), round(centroid(poly["vertices"])[0]), round(centroid(poly["vertices"])[1]))
        if any(abs(box[2] - s[2]) < 30 and abs(box[3] - s[3]) < 30 and abs(box[0] - s[0]) < 30 for s in seen):
            continue
        seen.append(box)
        chosen.append(poly)
    return chosen


def _plan_tags(dump, schedule, table_ids):
    """Schedule tags written on the plan, not the copy inside the schedule table."""
    table_ids = set(table_ids)
    tags = []
    for text in _texts(dump):
        if id(text) in table_ids:
            continue
        if text["text"] not in schedule:
            continue
        tags.append(text)
    return tags


def _pair(shapes, tags, schedule):
    options = []
    for si, shape in enumerate(shapes):
        width, height = bbox_size(shape["vertices"])
        cx, cy = centroid(shape["vertices"])
        for ti, tag in enumerate(tags):
            if point_in_poly(tag["x"], tag["y"], shape["vertices"]):
                dist = 0.0
            else:
                dist = ((tag["x"] - cx) ** 2 + (tag["y"] - cy) ** 2) ** 0.5
            limit = max(width, height, 1200) * 0.85
            if dist > limit:
                continue
            spec = schedule.get(tag["text"])
            penalty = 2
            if spec and spec.get("rc") and sizes_match(width, height, spec["rc"][0], spec["rc"][1]):
                penalty = 0
            elif spec and spec.get("pcc") and sizes_match(width, height, spec["pcc"][0], spec["pcc"][1]):
                penalty = 3
            elif spec and spec.get("refer_to_plan"):
                penalty = 1
            options.append((penalty, dist, si, ti))
    options.sort()
    used_shapes, used_tags = set(), set()
    assigned = {}
    for penalty, dist, si, ti in options:
        if si in used_shapes or ti in used_tags:
            continue
        used_shapes.add(si)
        used_tags.add(ti)
        assigned[si] = tags[ti]
    paired = [(shapes[i], assigned.get(i)) for i in range(len(shapes))]
    unused = [tags[i] for i in range(len(tags)) if i not in used_tags]
    return paired, unused


def _depth_near(shape, dump):
    """A thickness written on the outline, for rows the schedule leaves to the plan."""
    for text in _texts(dump):
        if not point_in_poly(text["x"], text["y"], shape["vertices"]):
            continue
        match = THK_RE.search(text["text"])
        if match and "RAFT" not in text["text"].upper():
            value = float(match.group(1))
            if 100 <= value <= 2000:
                return value
        size = SIZE_RE.search(text["text"].replace("\n", " "))
        if size:
            return float(size.group(3))
    return None


def _bar_run_kg(run_mm, across_mm, diameter, spacing, cover=COVER_MM):
    """Bars running one way, spaced across the other side inside the cover."""
    length = run_mm - 2 * cover
    clear = across_mm - 2 * cover
    if spacing <= 0 or length <= 0 or clear <= 0:
        return 0.0
    return (int(clear / spacing) + 1) * length / 1000.0 * kg_per_m(diameter)


def _bar_kg(length_mm, width_mm, diameter, spacing, cover=COVER_MM):
    """One mat in both directions."""
    return (
        _bar_run_kg(length_mm, width_mm, diameter, spacing, cover)
        + _bar_run_kg(width_mm, length_mm, diameter, spacing, cover)
    )


def _bar_set_kg(x_mm, y_mm, diameter, spacing, direction, cover=COVER_MM):
    """One schedule bar entry. A direction from the header means bars run that way only."""
    long_mm, short_mm = max(x_mm, y_mm), min(x_mm, y_mm)
    if direction == "long":
        return _bar_run_kg(long_mm, short_mm, diameter, spacing, cover)
    if direction == "short":
        return _bar_run_kg(short_mm, long_mm, diameter, spacing, cover)
    if direction == "x":
        return _bar_run_kg(x_mm, y_mm, diameter, spacing, cover)
    if direction == "y":
        return _bar_run_kg(y_mm, x_mm, diameter, spacing, cover)
    return _bar_kg(x_mm, y_mm, diameter, spacing, cover)


def _family_depth(schedule, tag):
    """A 'refer to plan' tag takes the depth of the other tags in the same family."""
    prefix = re.match(r"[A-Z]+", tag or "")
    if not prefix:
        return None
    depths = []
    for name, spec in schedule.items():
        if name == tag or not name.startswith(prefix.group(0)) or not spec.get("rc"):
            continue
        depths.append(spec["rc"][2])
    if not depths:
        return None
    if len(set(depths)) == 1:
        return depths[0]
    return _median(depths)


def _quantities(paired, schedule, dump, cover=COVER_MM):
    rows = []
    for shape, tag in paired:
        if tag is None:
            continue
        vertices = shape["vertices"]
        area = _area_m2(vertices)
        width, height = bbox_size(vertices)
        spec = schedule.get(tag["text"])
        note = ""
        depth = None
        plan_l = plan_w = None
        use_schedule_plan = False
        if spec and spec.get("rc") and sizes_match(width, height, spec["rc"][0], spec["rc"][1]):
            plan_l, plan_w, depth = spec["rc"]
            use_schedule_plan = True
        elif spec and spec.get("rc"):
            plan_l, plan_w, depth = spec["rc"]
            note = f"outline {width:.0f}x{height:.0f} differs from schedule {plan_l}x{plan_w}"
        elif spec and spec.get("refer_to_plan"):
            depth = _family_depth(schedule, tag["text"])
            plan_l, plan_w = width, height
            if depth:
                note = f"plan size, depth {depth:.0f} mm from the other {tag['text'][:2]} footings"
            else:
                depth = _depth_near(shape, dump)
                note = "size taken from the drawn outline"
                if depth is None:
                    note = "schedule says refer to plan, and no depth is written on the outline"
        elif spec and spec.get("pcc") and sizes_match(width, height, spec["pcc"][0], spec["pcc"][1]):
            note = "this outline is the blinding pad, not the footing"
        else:
            note = "tag is not in the footing schedule"
        if note.startswith("this outline is the blinding"):
            concrete = None
            depth = None
        elif depth and use_schedule_plan:
            concrete = (plan_l * plan_w * depth) / 1e9
        elif depth:
            concrete = area * depth / 1000
        else:
            concrete = None
        pcc = None
        if spec and spec.get("pcc") and concrete is not None:
            a, b, c = spec["pcc"]
            pcc = (a * b * c) / 1e9
        formwork = None
        if depth and use_schedule_plan:
            formwork = 2 * (plan_l + plan_w) / 1000 * depth / 1000
        elif depth:
            formwork = perimeter(vertices) / 1000 * depth / 1000
        steel = 0.0
        # Bars for a "refer to plan" footing need a size the schedule does not give.
        # Counting them on whatever outline the tag landed in overstates the steel.
        if spec and depth and concrete is not None and not spec.get("refer_to_plan"):
            if use_schedule_plan:
                upright = abs(width - plan_l) <= 40 and abs(height - plan_w) <= 40
                x_mm, y_mm = (plan_l, plan_w) if upright else (plan_w, plan_l)
            else:
                x_mm, y_mm = width, height
            for diameter, spacing, _direction in spec["bars"]:
                # Long/short and X/Y name the bar. Each entry is a mat in both directions:
                # bottom long plus bottom short is one reading, and counting each entry
                # both ways is the weight the schedule's four columns produce together
                # when the two bottom spacings match and the two top spacings match.
                steel += _bar_kg(x_mm, y_mm, diameter, spacing, cover)
        elif spec and spec.get("refer_to_plan"):
            note = (note + "; bars left out").strip("; ")
        rows.append({
            "missed": False,
            "tag": tag["text"],
            "source": shape.get("source", ""),
            "block": shape.get("block", ""),
            "width_mm": round(width),
            "height_mm": round(height),
            "area_m2": round(area, 3),
            "depth_mm": depth or "",
            "concrete_m3": round(concrete, 3) if concrete is not None else "",
            "blinding_m3": round(pcc, 3) if pcc is not None else "",
            "formwork_m2": round(formwork, 3) if formwork is not None else "",
            "rebar_kg": round(steel, 1) if steel else "",
            "note": note,
            "vertices": vertices,
        })
    return rows


def _same_place(shape, other, tol=400):
    ax, ay = centroid(shape["vertices"])
    bx, by = centroid(other["vertices"])
    return abs(ax - bx) < tol and abs(ay - by) < tol


def _nearest_label(shape, dump):
    cx, cy = centroid(shape["vertices"])
    best = None
    best_d = None
    for text in _texts(dump):
        token = text["text"].strip()
        if not token or len(token) > 12:
            continue
        dist = ((text["x"] - cx) ** 2 + (text["y"] - cy) ** 2) ** 0.5
        if best_d is None or dist < best_d:
            best, best_d = token, dist
    if best is None or best_d > 4000:
        return ""
    return best


def _missed_outlines(dump, rows):
    """Footing-sized outlines that were not measured. They stay out of the total and are drawn as missed."""
    used = [row["vertices"] for row in rows]
    missed = []
    seen = []
    if not used:
        return missed
    xs, ys = [], []
    for vertices in used:
        x0, y0, x1, y1 = bbox(vertices)
        xs += [x0, x1]
        ys += [y0, y1]
    margin = 8000
    x0, x1 = min(xs) - margin, max(xs) + margin
    y0, y1 = min(ys) - margin, max(ys) + margin
    for shape in _polylines(dump):
        area = _area_m2(shape["vertices"])
        if area < 0.8 or area > 20:
            continue
        cx, cy = centroid(shape["vertices"])
        if not (x0 <= cx <= x1 and y0 <= cy <= y1):
            continue
        if any(_same_place(shape, {"vertices": vertices}) for vertices in used):
            continue
        if any(_same_place(shape, other) for other in seen):
            continue
        seen.append(shape)
        label = _nearest_label(shape, dump)
        width, height = bbox_size(shape["vertices"])
        note = "missed: outline was not tied to a schedule tag, so it is not in the total"
        if label:
            note = f"{note}; nearest label {label}"
        missed.append({
            "missed": True,
            "tag": "MISSED",
            "source": shape.get("source", ""),
            "block": shape.get("block", ""),
            "width_mm": round(width),
            "height_mm": round(height),
            "area_m2": round(area, 3),
            "depth_mm": "",
            "concrete_m3": "",
            "blinding_m3": "",
            "formwork_m2": "",
            "rebar_kg": "",
            "note": note,
            "vertices": shape["vertices"],
        })
    return missed


def _shape(vertices):
    from shapely.geometry import Polygon

    polygon = Polygon(vertices)
    return polygon if polygon.is_valid else polygon.buffer(0)


def _pad_limits(schedule):
    """Largest footing pad, and the plain-concrete thickness the schedule uses."""
    areas = []
    thicknesses = []
    for spec in schedule.values():
        pad = spec.get("pcc")
        if not pad:
            continue
        areas.append(pad[0] * pad[1] / 1e6)
        thicknesses.append(pad[2])
    return (max(areas) if areas else 0), (_median(thicknesses) if thicknesses else 50)


def _slab_on_grade_outlines(dump):
    """Closed outlines that a slab-on-grade note sits inside, the smallest one per note."""
    notes = [t for t in _texts(dump) if "SLAB ON GRADE" in t["text"].upper()]
    polys = [e for e in _polylines(dump) if _area_m2(e["vertices"]) > 5]
    used = set()
    found = []
    for note in notes:
        hits = []
        for i, shape in enumerate(polys):
            if point_in_poly(note["x"], note["y"], shape["vertices"]):
                hits.append((i, _area_m2(shape["vertices"])))
        if not hits:
            continue
        hits.sort(key=lambda item: item[1])
        index, _area = hits[0]
        if index in used:
            continue
        used.add(index)
        found.append(polys[index]["vertices"])
    return found


def _raft_beds(dump, max_pad):
    """Plain-concrete beds bigger than a footing pad. Those are the raft blinding."""
    return [
        shape["vertices"] for shape in _polylines(dump)
        if ("PLAIN" in shape["layer"].upper() or "BLIND" in shape["layer"].upper())
        and _area_m2(shape["vertices"]) > max_pad * 1.05
    ]


def _beam_strips(dump):
    """Plan footprint of the ground beams on a sheet."""
    from .structure import _grade_beams

    return [segment["band"] for segment in _grade_beams(dump)["segments"]]


def _blinding_plan(dumps, rafts, max_pad, applies_to):
    """Plan area under blinding, each square metre once.

    The slab on grade stops at the raft, the raft has its own bed, and the
    ground beams are added where the note says they sit on blinding.
    """
    from shapely.ops import unary_union

    slabs = unary_union([_shape(v) for dump in dumps for v in _slab_on_grade_outlines(dump)])
    beds = unary_union([_shape(v) for dump in dumps for v in _raft_beds(dump, max_pad)])
    strips = unary_union([_shape(v) for dump in dumps for v in _beam_strips(dump)])
    # The raft sits in a deeper excavation, so its blinding is below the
    # ground-slab blinding. The two overlap on the plan and are both cast.
    shares = {}
    area = 0.0
    if "slabs" in applies_to and not slabs.is_empty:
        shares["slab on grade"] = slabs.area / 1e6
        area += shares["slab on grade"]
    if "foundations" in applies_to and not beds.is_empty:
        shares["raft beds"] = beds.area / 1e6
        area += shares["raft beds"]
    if "beams" in applies_to and not strips.is_empty:
        outside = strips.difference(slabs).difference(beds)
        if not outside.is_empty:
            shares["ground beams outside the slab"] = outside.area / 1e6
            area += shares["ground beams outside the slab"]
    return area, shares


def _rafts(dump):
    notes = [
        e for e in _texts(dump)
        if "RAFT" in e["text"].upper() and THK_RE.search(e["text"])
    ]
    candidates = [e for e in _polylines(dump) if _area_m2(e["vertices"]) >= 15]
    rafts = []
    used = set()
    for note in notes:
        thickness = float(THK_RE.search(note["text"]).group(1))
        holding = []
        for i, shape in enumerate(candidates):
            if point_in_poly(note["x"], note["y"], shape["vertices"]):
                holding.append((i, _area_m2(shape["vertices"]), shape))
        if not holding:
            rafts.append({"note": note["text"], "thickness": thickness, "area_m2": None, "vertices": None})
            continue
        # The note often sits in an inner rectangle. The raft boundary is the
        # larger outline on the foundation layer, which includes the side bays.
        def rank(item):
            _index, area, shape = item
            layer = shape["layer"].upper()
            structural = 0 if ("FOUND" in layer or "RAFT" in layer) else 1
            return (structural, -area)
        index, area, _shape = min(holding, key=rank)
        if index in used:
            continue
        used.add(index)
        shape = candidates[index]
        depth_m = thickness / 1000
        rafts.append({
            "note": note["text"].replace("\n", " "),
            "thickness": thickness,
            "area_m2": round(area, 3),
            "concrete_m3": round(area * depth_m, 3),
            "formwork_m2": round(perimeter(shape["vertices"]) / 1000 * depth_m, 3),
            "vertices": shape["vertices"],
            "rebar_kg": _raft_bars(dump, shape["vertices"]),
        })
    return rafts


def _mat_note(text):
    """(diameter, spacing, mats) for a mesh note that runs both ways, else None."""
    flat = " ".join(text.replace("\n", " ").upper().split())
    match = re.search(r"T\s*(\d+)\s*@\s*(\d+)", flat)
    if not match:
        return None
    if not re.search(r"BOTH\s+DIRECTIONS|EACH\s+WAY|BOTH\s+WAYS", flat):
        return None
    mats = 2 if re.search(r"TOP\s+AND\s+BOTTOM|TOP\s*&\s*BOTTOM", flat) else 1
    return int(match.group(1)), int(match.group(2)), mats


def _raft_bars(dump, vertices, cover=COVER_MM):
    """Mesh written inside the raft. Straight bars run the full rectangle around the outline."""
    x0, y0, x1, y1 = bbox(vertices)
    length, width = x1 - x0, y1 - y0
    total = 0.0
    seen = set()
    for text in _texts(dump):
        mesh = _mat_note(text["text"])
        if not mesh or mesh in seen or not point_in_poly(text["x"], text["y"], vertices):
            continue
        seen.add(mesh)
        diameter, spacing, mats = mesh
        # _bar_kg is one mat, both directions. Top and bottom is the second mat.
        total += mats * _bar_kg(length, width, diameter, spacing, cover)
    return round(total, 1) if seen else None


def _mode(values):
    counts = defaultdict(int)
    for value in values:
        counts[round(value)] += 1
    return max(counts, key=counts.get)


def _axis_fit(src, dst):
    n = len(src)
    mean_s = sum(src) / n
    mean_d = sum(dst) / n
    var = sum((s - mean_s) ** 2 for s in src) or 1e-9
    cov = sum((s - mean_s) * (d - mean_d) for s, d in zip(src, dst))
    scale = cov / var
    return scale, mean_d - scale * mean_s


def _row_points(points, y_index, tolerance):
    if not points:
        return []
    row = _mode([p[y_index] for p in points])
    return sorted(p for p in points if abs(p[y_index] - row) <= tolerance)


def _fit_pdf(page, dump):
    """Map drawing millimetres onto the PDF using a label that both files share.

    The label is whichever short text repeats in a row on both, with the
    widest run. Vertical scale is that same scale, flipped, because a single
    row has no height to measure.
    """
    dwg_by_text = defaultdict(list)
    for text in _texts(dump):
        token = text["text"].strip()
        if 1 <= len(token) <= 8:
            dwg_by_text[token].append((text["x"], text["y"]))
    pdf_by_text = defaultdict(list)
    for word in page.get_text("words"):
        token = word[4].strip()
        if 1 <= len(token) <= 8:
            pdf_by_text[token].append(((word[0] + word[2]) / 2, (word[1] + word[3]) / 2))
    best = None
    for token, dwg_pts in dwg_by_text.items():
        pdf_pts = pdf_by_text.get(token)
        if not pdf_pts or len(dwg_pts) < 4 or len(pdf_pts) < 4:
            continue
        dwg_row = _row_points(dwg_pts, 1, 80)
        pdf_row = _row_points(pdf_pts, 1, 6)
        n = min(len(dwg_row), len(pdf_row))
        if n < 4:
            continue
        span = dwg_row[n - 1][0] - dwg_row[0][0]
        if best is None or span > best[0]:
            best = (span, token, dwg_row[:n], pdf_row[:n])
    if best is None:
        return None
    _span, token, dwg, pdf = best
    ax, bx = _axis_fit([p[0] for p in dwg], [p[0] for p in pdf])
    ay = -ax
    by = pdf[0][1] - ay * dwg[0][1]
    residual = max(abs(ax * dwg[i][0] + bx - pdf[i][0]) for i in range(len(dwg)))
    return ax, bx, ay, by, residual, token


def _overlay(page, rows, rafts, fit):
    ax, bx, ay, by = fit[:4]

    def xy(x, y):
        return pymupdf.Point(ax * x + bx, ay * y + by)

    colors = [(0.75, 0.1, 0.1), (0.1, 0.3, 0.7), (0.0, 0.45, 0.25), (0.55, 0.3, 0.0), (0.4, 0.1, 0.5)]
    tags = sorted({r["tag"] for r in rows})
    color_of = {tag: colors[i % len(colors)] for i, tag in enumerate(tags)}
    for row in rows:
        pts = [xy(x, y) for x, y in row["vertices"]]
        if len(pts) < 2:
            continue
        missed = row.get("missed")
        color = (0.85, 0.05, 0.05) if missed else color_of.get(row["tag"], (0.4, 0.4, 0.4))
        page.draw_polyline(pts + [pts[0]], color=color, width=1.8 if missed else 1.6, dashes="[4 2] 0" if missed else None)
        cx, cy = centroid(row["vertices"])
        origin = xy(cx, cy)
        span = max(abs(pts[0].x - pts[2].x) if len(pts) > 2 else 20, 12)
        label = "missed" if missed else row["tag"]
        if row["concrete_m3"] != "":
            label = f"{label} {row['concrete_m3']}"
        page.insert_text(pymupdf.Point(origin.x, origin.y - 1), label, fontsize=max(4.5, min(7.5, span / 14)), color=color)
    for raft in rafts:
        if not raft.get("vertices"):
            continue
        pts = [xy(x, y) for x, y in raft["vertices"]]
        page.draw_polyline(pts + [pts[0]], color=(0.9, 0.35, 0.0), width=2.2, dashes="[6 3]")


def _write_csv(path, rows):
    fields = [
        "sheet", "tag", "source", "block", "width_mm", "height_mm", "area_m2", "depth_mm",
        "concrete_m3", "blinding_m3", "formwork_m2", "rebar_kg", "note",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def _sum(rows, field):
    return sum(r[field] for r in rows if r[field] != "")


def write_comparison(path, ours, baseline, reasons=None):
    referred_note = {
        "blinding_m3": "plain concrete under the footings only",
        "footing_m3": "schedule depth times the matching outline",
        "footing_kg": f"{COVER_MM} mm cover assumed, no bends or laps",
        "footing_m2": "perimeter times schedule depth",
        "raft_m3": "closed outline around each raft thickness note",
        "raft_m2": "edge length of that outline times thickness",
        "raft_kg": "raft bars are not on the footing schedule",
    }
    keys = list(dict.fromkeys([*baseline.keys(), *ours.keys()]))
    table = [["item", "bill", "ours", "difference", "pct", "reason"]]
    for key in keys:
        bill = baseline.get(key)
        value = ours.get(key)
        reason = (reasons or {}).get(key) or referred_note.get(key, "")
        if bill is None:
            table.append([key, "", "" if value is None else value, "", "", reason])
            continue
        if value is None:
            table.append([key, bill, "", "", "", reason])
            continue
        diff = value - bill
        pct = diff / bill * 100 if bill else 0
        table.append([key, f"{bill:.3f}", f"{value:.3f}", f"{diff:.3f}", f"{pct:.1f}", reason])
    with path.open("w", newline="", encoding="utf-8") as handle:
        csv.writer(handle).writerows(table)
    return [",".join(str(cell) for cell in row) for row in table]


def ensure_dump(dwg, json_path):
    json_path = Path(json_path)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    if json_path.exists() and json_path.stat().st_mtime >= dwg.stat().st_mtime:
        return json.loads(json_path.read_text(encoding="utf-8"))
    subprocess.run(["node", str(DUMP_MJS), str(dwg), str(json_path)], check=True)
    return json.loads(json_path.read_text(encoding="utf-8"))


def ensure_pdf_dump(pdf, json_path):
    """Cache a PDF word dump as JSON (same schema as DWG dumps for text/schedules)."""
    pdf = Path(pdf)
    json_path = Path(json_path)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    if json_path.exists() and json_path.stat().st_mtime >= pdf.stat().st_mtime:
        return json.loads(json_path.read_text(encoding="utf-8"))
    dump = dump_from_pdf(pdf)
    json_path.write_text(json.dumps(dump, ensure_ascii=False), encoding="utf-8")
    return dump


def ensure_geometry_dump(source, json_path):
    """DWG via node dump, or searchable PDF via word positions."""
    source = Path(source)
    if source.suffix.lower() == ".dwg":
        return ensure_dump(source, json_path)
    if source.suffix.lower() == ".pdf":
        return ensure_pdf_dump(source, json_path)
    raise ValueError(f"unsupported geometry source: {source}")


def _find_bill(project):
    books = [p for p in project.rglob("*.xlsx") if "out" not in p.parts and not p.name.startswith("~$")]
    named = [p for p in books if "bill" in p.name.lower()]
    return (named or books or [None])[0]


def _drawing_pairs(project):
    skip = {"out", "node_modules", ".git"}
    dwgs = [p for p in project.rglob("*.dwg") if not (set(p.parts) & skip)]
    pairs = []
    for dwg in sorted(dwgs):
        pdf = next((p for p in project.rglob(dwg.with_suffix(".pdf").name) if not (set(p.parts) & skip)), None)
        pairs.append((dwg, pdf))
    return pairs


def _foundation_sources(project):
    """Geometry files to scan for footing schedules (DWG and PDF-only sheets)."""
    from .discovery import _pdf_indexable, _scan_dump, _stem_meta

    skip = {"out", "node_modules", ".git"}
    sources = []
    dwg_stems = set()
    for dwg in sorted(p for p in project.rglob("*.dwg") if not (set(p.parts) & skip)):
        dwg_stems.add(dwg.stem)
        overlay = next(
            (p for p in project.rglob(dwg.with_suffix(".pdf").name) if not (set(p.parts) & skip)),
            None,
        )
        sources.append((dwg, overlay))
    out_dir = project / "out"
    for pdf in sorted(p for p in project.rglob("*.pdf") if not (set(p.parts) & skip)):
        if pdf.stem in dwg_stems or not _pdf_indexable(pdf):
            continue
        role = _stem_meta(pdf.stem).get("role") or "other"
        if role not in {
            "footing_schedule",
            "foundation_plan",
            "foundation_layout",
            "pile_cap_schedule",
        }:
            dump_path = out_dir / f"{pdf.stem}.json"
            try:
                if dump_path.exists():
                    dump = json.loads(dump_path.read_text(encoding="utf-8"))
                else:
                    dump = ensure_pdf_dump(pdf, dump_path)
                scan = _scan_dump(dump)
            except Exception:
                scan = {"signals": []}
            if "footing_schedule_table" not in scan.get("signals", []):
                continue
        sources.append((pdf, None))
    return sources


def _measure_sheet(dump, cover=COVER_MM):
    cells = _schedule_cells(dump)
    schedule = _parse_schedule(cells, _bar_directions(dump, cells))
    if not schedule:
        return None
    table_ids = {id(c) for c in cells}
    tags = _plan_tags(dump, schedule, table_ids)
    shapes = _shapes_for_schedule(dump, schedule, table_ids)
    paired, unused = _pair(shapes, tags, schedule)
    rows = _quantities(paired, schedule, dump, cover)
    rows.extend(_missed_outlines(dump, rows))
    rafts = _rafts(dump)
    plan_tag_texts = {t["text"] for t in tags}
    schedule_only = set(schedule.keys()) - plan_tag_texts
    return {
        "schedule": schedule,
        "rows": rows,
        "rafts": rafts,
        "unused": len(unused),
        "unused_tags": [{"text": t["text"], "x": t["x"], "y": t["y"]} for t in unused],
        "schedule_only": sorted(schedule_only),
        "shapes": len(shapes),
    }


def run_foundations(project, dwg=None, pdf=None, bill=None, out=None):
    project = Path(project) if project else None
    if dwg:
        pairs = [(Path(dwg), Path(pdf) if pdf else None)]
        out_dir = Path(out) if out else Path(dwg).parent / "out"
        bill_path = Path(bill) if bill else None
    else:
        if project is None:
            raise SystemExit("Pass a project folder, or --dwg and --pdf")
        pairs = _foundation_sources(project)
        out_dir = Path(out) if out else project / "out"
        bill_path = Path(bill) if bill else _find_bill(project)
    out_dir.mkdir(parents=True, exist_ok=True)
    if not pairs:
        raise SystemExit(f"No DWG or footing-schedule PDF files under {project}")

    from .measurements import (
        build_review_items,
        footing_measurement,
        raft_measurement,
        rebar_total_record,
        write_measurement_bundle,
    )

    all_rows = []
    all_rafts = []
    dumps = []
    max_pad = 0.0
    thicknesses = []
    result_schedules = []
    raft_dumps = []
    measured = 0
    all_measurements = []
    all_unused_tags = []
    schedule_tags_by_sheet = {}
    alignments = []
    rules_for_steel = find_rules(project, search_parent_zip=False) if project else {}
    cover_mm = rules_for_steel.get("footing_cover_mm") or COVER_MM
    for geom_path, pdf_path in pairs:
        dump_path = out_dir / f"{geom_path.stem}.json"
        print(f"reading {geom_path.name}", flush=True)
        dump = ensure_geometry_dump(geom_path, dump_path)
        dumps.append(dump)
        result = _measure_sheet(dump, cover_mm)
        if result is None:
            from .discovery import _scan_dump

            scan = _scan_dump(dump)
            if "pile_cap_schedule_title" in scan["signals"]:
                print(
                    f"  pile cap schedule on {geom_path.name} (not measured yet; run discover for manifest)",
                    flush=True,
                )
            elif geom_path.suffix.lower() == ".pdf" and scan.get("needs_ocr"):
                print(f"  PDF has no text layer on {geom_path.name} (OCR required)", flush=True)
            else:
                print(f"  no footing schedule on {geom_path.name}", flush=True)
            continue
        measured += 1
        result_schedules.extend(result["schedule"].values())
        pad_area, thick = _pad_limits(result["schedule"])
        max_pad = max(max_pad, pad_area)
        if thick:
            thicknesses.append(thick)
        sheet_stem = geom_path.stem
        for index, row in enumerate(result["rows"]):
            row["sheet"] = sheet_stem
            all_measurements.append(footing_measurement(row, sheet_stem, index))
        for index, raft in enumerate(result["rafts"]):
            raft["sheet"] = sheet_stem
            all_measurements.append(raft_measurement(raft, sheet_stem, index))
        for ut in result.get("unused_tags") or []:
            ut["sheet"] = sheet_stem
            all_unused_tags.append(ut)
        schedule_tags_by_sheet[sheet_stem] = {
            "on_plan": set(result["schedule"].keys()) - set(result.get("schedule_only") or []),
            "schedule_only": set(result.get("schedule_only") or []),
        }
        all_rows.extend(result["rows"])
        all_rafts.extend(result["rafts"])
        if result["rafts"]:
            raft_dumps.append((dump, result["rafts"]))
        _write_csv(out_dir / f"{geom_path.stem}-foundations.csv", result["rows"])
        if geom_path.suffix.lower() == ".pdf" and not result["rows"]:
            print(
                "  schedule parsed from PDF; no plan outlines on this sheet (quantities need layout DWG)",
                flush=True,
            )
        print(
            f"  schedule {', '.join(sorted(result['schedule']))}",
            flush=True,
        )
        print(
            f"  outlines {result['shapes']}, measured {len(result['rows'])}, unused tags {result['unused']}",
            flush=True,
        )
        if pdf_path and pdf_path.exists():
            doc = pymupdf.open(pdf_path)
            page = doc[0]
            fit = _fit_pdf(page, dump)
            if fit is None:
                print("  no shared label row, overlay skipped", flush=True)
                alignments.append({"sheet": sheet_stem, "status": "no_fit", "residual_pt": None, "anchor": ""})
                doc.close()
            else:
                alignments.append({
                    "sheet": sheet_stem,
                    "status": "ok",
                    "residual_pt": round(fit[4], 2),
                    "anchor": fit[5],
                })
                _overlay(page, result["rows"], result["rafts"], fit)
                overlay = out_dir / f"{geom_path.stem}-overlay.pdf"
                doc.save(overlay)
                doc.close()
                print(f"  overlay {overlay.name} via {fit[5]!r}, residual {fit[4]:.2f} pt", flush=True)
        else:
            print("  no PDF next to this DWG, quantities only", flush=True)
            alignments.append({"sheet": sheet_stem, "status": "no_pdf", "residual_pt": None, "anchor": ""})

    if not measured:
        raise SystemExit("No sheet had a footing schedule")

    review = build_review_items(
        all_unused_tags,
        all_rows,
        alignments,
        schedule_tags_by_sheet,
    )
    footing_kg_total = _sum(all_rows, "rebar_kg")
    if footing_kg_total:
        cover = rules_for_steel.get("footing_cover_mm")
        steel_flags = ["schedule_both_ways", "no_laps", "no_bends", "no_starter_bars"]
        if not cover:
            steel_flags.append("assumed_cover")
        all_measurements.append(rebar_total_record(
            "footing-rebar-total",
            "footing_steel",
            "foundations",
            footing_kg_total,
            "measured",
            flags=steel_flags,
            note=(
                f"Footing schedule bars both ways; {cover:.0f} mm cover from {rules_for_steel['cover_source']}"
                if cover
                else f"Footing schedule bars both ways; {COVER_MM} mm cover assumed"
            ),
        ))
    project_name = project.name if project else pairs[0][0].parent.name
    bundle_path = write_measurement_bundle(
        out_dir,
        all_measurements,
        review,
        alignments,
        project_name,
    )
    print(
        f"  measurements {len(all_measurements)} written, review queue {len(review)} items -> {bundle_path.name}",
        flush=True,
    )

    if bill_path and bill_path.exists():
        baseline = foundation_baseline(bill_path)
        pad_m3 = _sum(all_rows, "blinding_m3")
        rules = find_rules(project, search_parent_zip=False)
        note_mm = rules.get("blinding_mm")
        schedule_mm = _median(thicknesses) if thicknesses else None
        thick_mm = note_mm or schedule_mm or 50
        if note_mm:
            applies_to = set(rules.get("blinding_applies_to") or [])
        else:
            applies_to = {"slabs", "foundations"}
        plan_m2, shares = _blinding_plan(dumps, all_rafts, max_pad, applies_to)
        blinding = pad_m3 + plan_m2 * thick_mm / 1000
        share_text = "; ".join(f"{name} {area:.0f} m2" for name, area in shares.items())
        if note_mm:
            blind_reason = (
                f"{rules['blinding_source']}: {note_mm:.0f} mm {rules.get('blinding_grade', '')} "
                f"under {', '.join(rules.get('blinding_subjects') or sorted(applies_to))}; "
                f"footing pads from the schedule ({pad_m3:.2f} m3); "
                f"{share_text}; raft blinding is the lower layer and is added to the slab blinding"
            )
        else:
            blind_reason = (
                f"{thick_mm:.0f} mm from the footing schedule (no blinding note found); "
                f"pads {pad_m3:.2f} m3; {share_text}; {plan_m2:.0f} m2 once overlaps are removed"
            )
        ours = {
            "footing_m3": _sum(all_rows, "concrete_m3"),
            "blinding_m3": blinding,
            "footing_m2": _sum(all_rows, "formwork_m2"),
            "footing_kg": _sum(all_rows, "rebar_kg"),
            "raft_m3": sum(r.get("concrete_m3") or 0 for r in all_rafts),
            "raft_m2": sum(r.get("formwork_m2") or 0 for r in all_rafts),
            "raft_kg": sum(r["rebar_kg"] for r in all_rafts if r.get("rebar_kg")),
        }
        cover = rules.get("footing_cover_mm")
        directions = sorted({
            bar[2] or "not stated"
            for spec in (result_schedules or [])
            for bar in spec.get("bars", [])
        })
        reasons = {
            "blinding_m3": blind_reason,
            "footing_kg": (
                "each schedule column measured both ways, bars inside the cover"
                + (f", {cover:.0f} mm from {rules['cover_source']}" if cover else f", {COVER_MM:.0f} mm cover (assumed)")
                + "; no bends, laps or starter bars"
            ),
            "raft_kg": (
                f"mesh note inside each raft, bars run across the rectangle around the outline, "
                f"{COVER_MM:.0f} mm cover; no edge bars"
            ),
        }
        lines = write_comparison(out_dir / "foundations-compare.csv", ours, baseline, reasons)
        print(f"bill {bill_path.name}", flush=True)
        for line in lines:
            print(" ", line, flush=True)
    else:
        print("no bill workbook found, comparison skipped", flush=True)
    sys.stdout.flush()
