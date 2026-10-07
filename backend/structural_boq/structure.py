"""Columns, slabs, and grade beams from the floor plans.

Storey height is the slab level written on one plan minus the slab level on
the plan below, minus the beam depth written on the upper plan. Which plan's
column outlines belong to a storey comes from the legend. Slab volume is the
outline around each thickness note, less openings and less any smaller slab
inside it. Where a beam and a suspended slab share concrete, the slab keeps it.
"""
import csv
import math
import re
import sys
from collections import Counter
from pathlib import Path

from .bill import quantity_lines
from .foundations import (
    _area_m2,
    _find_bill,
    _measure_sheet,
    _polylines,
    _texts,
    ensure_dump,
    ensure_geometry_dump,
    point_in_poly,
)
from .geometry import bbox, centroid, perimeter
from .measurements import (
    merge_measurement_bundle,
    rebar_total_record,
    simple_structure_record,
    structure_slab_review,
)
from .rebar import LAP_SOURCE, STOCK_SOURCE, extra_marked_kg, mat_steel
from .walls import pit_and_tank_walls, plan_walls_by_floor

MARK = re.compile(r"^(C\d+\*{0,2}|W\d+)$")
BEAM = re.compile(r"^[A-Z]+\d*\((\d+)[xX](\d+)")
UPSTAND = re.compile(r"(\d+)\s*(?:[xX](\d+))?\s*RC\s*UPSTAND", re.I)
SSL = re.compile(r"([+-]?\d+\.\d+)\s*SSL")
SLAB_NOTE = re.compile(r"SLAB(?:\s+ON\s+GRADE)?\s+THK\s*=\s*(\d+)\s*mm", re.I)
MESH = re.compile(r"T\s*(\d+)\s*@\s*(\d+)", re.I)
OPENING_WORDS = re.compile(r"\bOPENING\b|\bVOID\b|\bSHAFT\b|\bDUCT\b", re.I)
FRAMED = ("FB", "RB", "URB", "SB")

FLOOR_ORDER = ("ground", "first", "roof", "upper")


def _floor_of(name):
    upper = name.upper()
    if "UPPER" in upper:
        return "upper"
    if "ROOF" in upper and "UPPER" not in upper:
        return "roof"
    if "FIRST" in upper or re.search(r"\b1ST\b", upper):
        return "first"
    if "GROUND" in upper or re.search(r"S-101-A", upper):
        return "ground"
    return ""


def _plan_shows_columns(dump):
    """('below' or 'above', legend text) when the plan's legend says which columns it draws."""
    for text in _texts(dump):
        flat = " ".join(text["text"].upper().split())
        if "COLUMN" not in flat:
            continue
        if re.search(r"\bBELOW\b", flat):
            return "below", flat
        if re.search(r"\bABOVE\b", flat):
            return "above", flat
    return None, ""


def _modal_ssl(dump):
    counts = Counter()
    for text in _texts(dump):
        match = SSL.search(text["text"].upper())
        if match:
            counts[round(float(match.group(1)), 2)] += 1
    if not counts:
        return None
    return counts.most_common(1)[0][0]


def _median(values):
    ordered = sorted(values)
    if not ordered:
        return None
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def _beam_depth(dump):
    """Median depth of the numbered beams. B(200X550) is the boundary wall and is left out."""
    depths = []
    for text in _texts(dump):
        raw = text["text"].replace(" ", "")
        match = BEAM.match(raw)
        if match and re.search(r"\d\(", raw):
            depths.append(int(match.group(2)))
    return _median(depths)


def _beam_depth_at(dump, x, y, default):
    """Depth of the numbered ground beam nearest this point."""
    best = None
    for text in _texts(dump):
        raw = text["text"].replace(" ", "").replace("\n", "")
        match = BEAM.match(raw)
        if not match or not raw.startswith("GB"):
            continue
        dist = math.hypot(text["x"] - x, text["y"] - y)
        if best is None or dist < best[0]:
            best = (dist, int(match.group(2)))
    if best is None or best[0] > 6000:
        return default
    return best[1]


VERT_BARS = re.compile(r"(\d+)T(\d+)")


def _ssl_marks(dump):
    marks = []
    for text in _texts(dump):
        match = SSL.search(text["text"].upper())
        if match:
            marks.append((round(float(match.group(1)), 2), text["x"], text["y"]))
    return marks


def _footing_depths(dump):
    """Bottom-of-footing is the level on the sheet. Thickness comes from the footing under the column."""
    measured = _measure_sheet(dump)
    if not measured:
        return []
    found = []
    for row in measured["rows"]:
        if row.get("missed") or not row.get("depth_mm"):
            continue
        cx, cy = centroid(row["vertices"])
        found.append((cx, cy, float(row["depth_mm"])))
    return found


def _neck_bars(dump):
    """Vertical bars in the foundation-to-first-floor row of the column schedule.

    That row is the bar text sitting just above each column mark.
    """
    marks = []
    bars = []
    for text in _texts(dump):
        token = text["text"].replace(" ", "").replace("\n", "")
        if re.fullmatch(r"C\d+\*{0,2}", token):
            marks.append((token, text["x"], text["y"]))
            continue
        match = VERT_BARS.search(token)
        if match:
            bars.append((int(match.group(1)), int(match.group(2)), text["x"], text["y"]))
    found = {}
    for tag, x, y in marks:
        above = [bar for bar in bars if abs(bar[2] - x) < 800 and bar[3] > y]
        if not above:
            continue
        above.sort(key=lambda bar: bar[3])
        count, diameter, _bx, _by = above[0]
        found[tag] = (count, diameter)
    return found


def _ground_column_instances(dump):
    """Each column outline on the ground floor, paired to its mark."""
    marks = [
        text for text in _texts(dump)
        if re.fullmatch(r"C\d+\*{0,2}", text["text"].strip()) and "IDEN" in text["layer"]
    ]
    shapes = [
        shape for shape in _polylines(dump)
        if shape.get("source") == "model" and "COL" in shape["layer"].upper()
        and 0.04 <= _area_m2(shape["vertices"]) <= 1.2
    ]
    used = set()
    instances = []
    for shape in shapes:
        cx, cy = centroid(shape["vertices"])
        best = None
        best_d = None
        for index, mark in enumerate(marks):
            if index in used:
                continue
            dist = ((mark["x"] - cx) ** 2 + (mark["y"] - cy) ** 2) ** 0.5
            if best_d is None or dist < best_d:
                best, best_d = index, dist
        if best is None or best_d > 2000:
            continue
        used.add(best)
        instances.append({
            "tag": marks[best]["text"].strip(),
            "x": cx,
            "y": cy,
            "area_m2": _area_m2(shape["vertices"]),
            "perimeter_m": perimeter(shape["vertices"]) / 1000.0,
        })
    return instances


def _ground_column_centroids(dump):
    return [(item["x"], item["y"]) for item in _ground_column_instances(dump)]


def _ground_column_marks(dump):
    """Count and plan size of each column mark on a floor. Walls are left out."""
    marks = [
        text for text in _texts(dump)
        if re.fullmatch(r"C\d+\*{0,2}", text["text"].strip()) and "IDEN" in text["layer"]
    ]
    shapes = [
        shape for shape in _polylines(dump)
        if shape.get("source") == "model" and "COL" in shape["layer"].upper()
        and 0.04 <= _area_m2(shape["vertices"]) <= 1.2
    ]
    used = set()
    grouped = {}
    for shape in shapes:
        cx, cy = centroid(shape["vertices"])
        best = None
        best_d = None
        for index, mark in enumerate(marks):
            if index in used:
                continue
            dist = ((mark["x"] - cx) ** 2 + (mark["y"] - cy) ** 2) ** 0.5
            if best_d is None or dist < best_d:
                best, best_d = index, dist
        if best is None or best_d > 2000:
            continue
        used.add(best)
        tag = marks[best]["text"].strip()
        bucket = grouped.setdefault(tag, {"count": 0, "area": 0.0, "peri": 0.0})
        bucket["count"] += 1
        bucket["area"] += _area_m2(shape["vertices"])
        bucket["peri"] += perimeter(shape["vertices"]) / 1000.0
    return grouped


def _column_necks(ground, foundations, schedule):
    """Column from the top of its footing up to the underside of the ground beam.

    S-100 calls the written foundation level the bottom of the footing. The top
    is that level plus the thickness of the footing under the column. A deeper
    spot level applies only to a column standing next to it. The ground beam is
    billed on its own line, so the neck stops at the beam soffit. Columns whose
    plan position sits on the raft outline are skipped; their stub is in the raft.
    """
    from shapely.geometry import Point
    from shapely.ops import unary_union

    from .foundations import _rafts

    empty = {"concrete_m3": 0.0, "formwork_m2": 0.0, "rebar_kg": 0.0, "height_m": 0.0}
    if not ground or not foundations:
        return empty
    ground_ssl = _modal_ssl(ground)
    levels = _ssl_marks(foundations)
    beam_depth = _beam_depth(ground)
    if ground_ssl is None or not levels or not beam_depth:
        return empty
    general_bottom = max(level for level, _x, _y in levels)
    footings = _footing_depths(foundations)
    columns = _ground_column_instances(ground)
    raft_parts = [
        _plan_polygon(raft["vertices"]) for raft in _rafts(foundations) if raft.get("vertices")
    ]
    raft_area = unary_union(raft_parts) if raft_parts else None
    bars = _neck_bars(schedule) if schedule else {}
    concrete = 0.0
    form = 0.0
    steel = 0.0
    heights = []
    for column in columns:
        x, y = column["x"], column["y"]
        tag = column["tag"]
        if raft_area is not None and not raft_area.is_empty and raft_area.contains(Point(x, y)):
            continue
        bottom = general_bottom
        for level, lx, ly in levels:
            if level >= general_bottom:
                continue
            dist = math.hypot(x - lx, y - ly)
            closer = sum(
                1 for other in columns
                if math.hypot(other["x"] - lx, other["y"] - ly) < dist
            )
            if dist <= 8000 and closer == 0:
                bottom = level
        depth = None
        nearest_footing = None
        for fx, fy, footing_depth in footings:
            dist = math.hypot(x - fx, y - fy)
            if nearest_footing is None or dist < nearest_footing[0]:
                nearest_footing = (dist, footing_depth)
        if nearest_footing and nearest_footing[0] <= 3000:
            depth = nearest_footing[1]
        if depth is None and footings:
            depth = _median([item[2] for item in footings])
        if not depth:
            continue
        local_beam = _beam_depth_at(ground, x, y, beam_depth)
        soffit = ground_ssl - local_beam / 1000.0
        height = soffit - (bottom + depth / 1000.0)
        if height <= 0:
            continue
        area = column["area_m2"]
        peri = column["perimeter_m"]
        concrete += area * height
        # Shuttering runs through half the ground-beam depth above the soffit; concrete stops at the soffit.
        form_height = height + local_beam / 2000.0
        form += peri * form_height
        heights.append(height)
        spec = bars.get(tag)
        if spec:
            count, diameter = spec
            steel += count * (diameter ** 2) / 162.0 * height
            link = max(peri - 8 * 0.040, 0.0)
            steel += (height / 0.200) * link * (10 ** 2) / 162.0
    if not heights:
        return empty
    return {
        "concrete_m3": concrete,
        "formwork_m2": form,
        "rebar_kg": steel,
        "height_m": sum(heights) / len(heights),
    }


def _member_areas(dump):
    """Plan area of column outlines and wall outlines, each tied to its mark."""
    marks = [
        text for text in _texts(dump)
        if MARK.match(text["text"].strip()) and "IDEN" in text["layer"]
    ]
    columns = 0.0
    walls = 0.0
    column_perimeter = 0.0
    wall_perimeter = 0.0
    used = set()
    shapes = [
        shape for shape in _polylines(dump)
        if shape.get("source") == "model" and "COL" in shape["layer"].upper()
        and 0.04 <= _area_m2(shape["vertices"]) <= 1.2
    ]
    for shape in shapes:
        cx, cy = centroid(shape["vertices"])
        best = None
        best_d = None
        for index, mark in enumerate(marks):
            if index in used:
                continue
            dist = ((mark["x"] - cx) ** 2 + (mark["y"] - cy) ** 2) ** 0.5
            if best_d is None or dist < best_d:
                best, best_d = index, dist
        if best is None or best_d > 2000:
            continue
        used.add(best)
        area = _area_m2(shape["vertices"])
        peri = perimeter(shape["vertices"]) / 1000.0
        if marks[best]["text"].startswith("W"):
            walls += area
            wall_perimeter += peri
        else:
            columns += area
            column_perimeter += peri
    return columns, walls, column_perimeter, wall_perimeter


def _gap(vertices):
    if len(vertices) < 2:
        return 0.0
    x1, y1 = vertices[0]
    x2, y2 = vertices[-1]
    return math.hypot(x2 - x1, y2 - y1)


def _outline_ok(shape):
    """Closed slab outlines, plus ones that miss a corner by less than a column width."""
    vertices = shape["vertices"]
    if len(vertices) < 4:
        return False
    area = _area_m2(vertices)
    if area <= 5:
        return False
    if shape.get("closed"):
        return True
    if "SLAB" not in shape["layer"].upper() or area <= 8:
        return False
    gap = _gap(vertices)
    peri = perimeter(vertices)
    return gap < 800 or (peri and gap / peri < 0.08)


def _slab_segments(dump):
    segments = []
    for entity in dump["entities"]:
        if "SLAB" not in entity["layer"].upper():
            continue
        if entity["kind"] == "line":
            parts = [((entity["x1"], entity["y1"]), (entity["x2"], entity["y2"]))]
        elif entity["kind"] == "polyline":
            vertices = entity["vertices"]
            parts = list(zip(vertices, vertices[1:]))
            if entity.get("closed") and vertices:
                parts.append((vertices[-1], vertices[0]))
        else:
            continue
        for start, end in parts:
            if math.hypot(end[0] - start[0], end[1] - start[1]) >= 300:
                segments.append((start, end))
    return segments


def _snap_lines(segments, tol):
    from shapely.geometry import LineString

    points = []
    for start, end in segments:
        points.append(start)
        points.append(end)
    parent = list(range(len(points)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left, right):
        root_left, root_right = find(left), find(right)
        if root_left != root_right:
            parent[root_right] = root_left

    for left in range(len(points)):
        for right in range(left + 1, len(points)):
            if abs(points[left][0] - points[right][0]) <= tol and abs(points[left][1] - points[right][1]) <= tol:
                union(left, right)
    groups = {}
    for index, point in enumerate(points):
        groups.setdefault(find(index), []).append(point)
    centers = {
        key: (sum(point[0] for point in group) / len(group), sum(point[1] for point in group) / len(group))
        for key, group in groups.items()
    }
    lines = []
    for index, (start, end) in enumerate(segments):
        snapped_start = centers[find(2 * index)]
        snapped_end = centers[find(2 * index + 1)]
        if abs(snapped_start[0] - snapped_end[0]) < 1 and abs(snapped_start[1] - snapped_end[1]) < 1:
            continue
        lines.append(LineString([snapped_start, snapped_end]))
    return lines


def _faces_for_notes(dump, pending):
    """Close slab-layer edges that stop short of a corner.

    Closed polylines are measured first. This is only for a thickness note that
    sits in no closed outline. A face is kept when the note is inside it, or
    when it shares a long edge with that face. Open strokes that do not close
    are not turned into area.
    """
    if not pending:
        return []
    try:
        from shapely.geometry import Point
        from shapely.ops import polygonize, unary_union
    except ImportError:
        return []
    segments = _slab_segments(dump)
    if len(segments) < 4:
        return []
    lines = _snap_lines(segments, 350)
    faces = [poly for poly in polygonize(unary_union(lines)) if poly.area / 1e6 >= 5]
    chosen = []
    used = set()
    for poly_index, poly in enumerate(faces):
        if not any(
            poly.contains(Point(text["x"], text["y"]))
            or poly.boundary.distance(Point(text["x"], text["y"])) <= 2500
            for text, _thickness, _on_grade in pending
        ):
            continue
        chosen.append(poly)
        used.add(poly_index)
    noted = list(chosen)
    for poly_index, poly in enumerate(faces):
        if poly_index in used or poly.area / 1e6 < 12:
            continue
        for noted_poly in noted:
            shared = poly.boundary.intersection(noted_poly.boundary).length
            if shared > 1500:
                chosen.append(poly)
                used.add(poly_index)
                break
    return [list(poly.exterior.coords) for poly in chosen]


def _plan_polygon(vertices):
    from shapely.geometry import Polygon

    polygon = Polygon(vertices)
    return polygon if polygon.is_valid else polygon.buffer(0)


def _parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry]
    return [part for part in getattr(geometry, "geoms", []) if part.geom_type == "Polygon"]


def _overlaps(polygon, regions):
    if polygon.is_empty or polygon.area <= 0:
        return True
    for region in regions:
        other = region["polygon"]
        if other.is_empty:
            continue
        if polygon.intersection(other).area > 0.35 * min(polygon.area, other.area):
            return True
    return False


def _add_region(regions, thickness, on_grade, polygon, check_overlap=False, spread=None, openings=()):
    # Joined edge-faces must not repeat an outline already measured.
    for part in _parts(polygon):
        if part.area / 1e6 < 0.01:
            continue
        if check_overlap and _overlaps(part, regions):
            continue
        # The opening is already cut out, so the polygon does not contain it.
        # The outer ring still does.
        shell = _plan_polygon(part.exterior.coords)
        holes = [
            hole for hole in openings
            if shell.contains(hole.representative_point())
            and not part.contains(hole.representative_point())
        ]
        regions.append({
            "thickness": thickness,
            "on_grade": on_grade,
            "area_m2": part.area / 1e6,
            "perimeter_m": part.length / 1000.0,
            "vertices": [list(point) for point in part.exterior.coords],
            "polygon": part,
            "openings": holes,
            "spread": spread,
        })


def _slab_notes_in_polygon(dump, polygon):
    from shapely.geometry import Point

    notes = []
    for text in _texts(dump):
        match = SLAB_NOTE.search(text["text"].replace("\n", " "))
        if not match:
            continue
        if polygon.contains(Point(text["x"], text["y"])):
            notes.append((text, int(match.group(1)), "ON GRADE" in text["text"].upper()))
    return notes


def _suspended_slab_m3(region, dump):
    """Concrete m3 for one suspended slab region."""
    if region.get("on_grade"):
        return 0.0
    return region["area_m2"] * region["thickness"] / 1000.0


def _openings(dump):
    """Outlines drawn as an opening: a box with both diagonals, or the smallest box around an opening word."""
    lines = []
    for entity in dump["entities"]:
        if entity["kind"] == "line":
            lines.append(((entity["x1"], entity["y1"]), (entity["x2"], entity["y2"])))
        elif entity["kind"] == "polyline" and len(entity.get("vertices") or []) == 2:
            lines.append((tuple(entity["vertices"][0]), tuple(entity["vertices"][1])))
    boxes = []
    for shape in _polylines(dump):
        layer = shape["layer"].upper()
        if "COL" in layer or "NONPLOT" in layer or "LEGEND" in layer:
            continue
        if _area_m2(shape["vertices"]) < 0.05:
            continue
        # A legend panel holds a crowd of captions. An opening holds the X and little else.
        captions = sum(
            1 for text in _texts(dump) if point_in_poly(text["x"], text["y"], shape["vertices"])
        )
        if captions > 4:
            continue
        boxes.append(shape)
    found = []
    for shape in boxes:
        x0, y0, x1, y1 = bbox(shape["vertices"])
        span = math.hypot(x1 - x0, y1 - y0)
        tol = min(200.0, max(40.0, 0.015 * span))

        def drawn(a, b):
            target = math.dist(a, b)
            for p, q in lines:
                # The stroke has to run from corner to corner, not merely pass near them.
                if abs(math.dist(p, q) - target) > max(150.0, 0.08 * target):
                    continue
                if (math.dist(p, a) <= tol and math.dist(q, b) <= tol) or (
                    math.dist(p, b) <= tol and math.dist(q, a) <= tol
                ):
                    return True
            return False

        if drawn((x0, y0), (x1, y1)) and drawn((x0, y1), (x1, y0)):
            found.append(_plan_polygon(shape["vertices"]))
    for text in _texts(dump):
        if not OPENING_WORDS.search(text["text"]):
            continue
        around = [
            shape for shape in boxes if point_in_poly(text["x"], text["y"], shape["vertices"])
        ]
        if around:
            smallest = min(around, key=lambda shape: _area_m2(shape["vertices"]))
            found.append(_plan_polygon(smallest["vertices"]))
    unique = []
    for polygon in found:
        if not any(polygon.equals_exact(other, 1.0) for other in unique):
            unique.append(polygon)
    return unique


def _face_thickness_areas(face, notes, step=450.0):
    """When several thickness notes sit in one bay, apportion area by nearest note."""
    from shapely.geometry import Point
    from collections import defaultdict

    inside = [
        (text, thick)
        for text, thick, _on_grade in notes
        if face.contains(Point(text["x"], text["y"]))
    ]
    if len({thick for _text, thick in inside}) <= 1:
        return None
    minx, miny, maxx, maxy = face.bounds
    cell = (step / 1000.0) ** 2
    areas = defaultdict(float)
    x = minx + step / 2.0
    while x < maxx:
        y = miny + step / 2.0
        while y < maxy:
            point = Point(x, y)
            if face.contains(point):
                text, thick = min(
                    inside,
                    key=lambda item: (item[0]["x"] - x) ** 2 + (item[0]["y"] - y) ** 2,
                )
                areas[thick] += cell
            y += step
        x += step
    return dict(areas) if areas else None


def _bays(dump, net, notes):
    """Split an outline whose thickness notes disagree, along slab lines and column faces.

    Each face takes the note inside it. A face with no note takes the value of
    the noted face it shares the longest edge with. When several notes share one
    face and lines do not split it, area is apportioned by nearest note.
    """
    from shapely.geometry import LineString, Point
    from shapely.ops import polygonize, unary_union

    segments = [(a, b) for a, b in _slab_segments(dump) if LineString([a, b]).intersects(net)]
    for shape in _polylines(dump):
        if shape.get("source") == "model" and "COL" in shape["layer"].upper():
            vertices = shape["vertices"]
            segments.extend(zip(vertices, vertices[1:] + vertices[:1]))
    lines = _snap_lines(segments, 60)
    rings = []
    for part in _parts(net):
        rings.append(LineString(part.exterior.coords))
        rings.extend(LineString(ring.coords) for ring in part.interiors)
    faces = []
    for face in polygonize(unary_union(lines + rings)):
        if net.contains(face.representative_point()):
            faces.extend(_parts(face.intersection(net)))
    if faces:
        rest = net.difference(unary_union(faces))
        faces.extend(part for part in _parts(rest) if part.area / 1e6 >= 0.01)
    else:
        faces = _parts(net)
    values = {}
    spread = {}
    for index, face in enumerate(faces):
        inside = [
            thickness for text, thickness, _on_grade in notes
            if face.contains(Point(text["x"], text["y"]))
        ]
        if inside:
            # Where the lines never split the bay, the thicker note is the slab
            # and the thinner notes are local. The range stays on the region.
            values[index] = max(inside) if len(set(inside)) > 1 else inside[0]
            if len(set(inside)) > 1:
                spread[index] = (min(inside), max(inside))
    changed = True
    while changed:
        changed = False
        for index, face in enumerate(faces):
            if index in values:
                continue
            best = None
            for other, value in list(values.items()):
                shared = face.boundary.intersection(faces[other].buffer(1.0)).length
                if shared > 0 and (best is None or shared > best[0]):
                    best = (shared, value, other)
            if best:
                values[index] = best[1]
                if best[2] in spread:
                    spread[index] = spread[best[2]]
                changed = True
    fallback = Counter(thickness for _text, thickness, _on_grade in notes).most_common(1)[0][0]
    groups = {}
    for index, face in enumerate(faces):
        value = values.get(index, fallback)
        groups.setdefault((value, spread.get(index)), []).append(face)
    return [(unary_union(group), value, rng) for (value, rng), group in groups.items()]


def _slab_regions(dump):
    """Each thickness note claims the smallest outline it sits in.

    An outline loses any smaller claimed outline inside it and any opening
    drawn inside it. Notes that disagree inside one outline split it into
    bays. A note outside every closed outline can still claim a face made by
    joining slab edges that stop a short distance apart.
    """
    notes = []
    for text in _texts(dump):
        match = SLAB_NOTE.search(text["text"].replace("\n", " "))
        if match:
            notes.append((text, int(match.group(1)), "ON GRADE" in text["text"].upper()))
    polys = [
        entity for entity in dump["entities"]
        if entity.get("kind") == "polyline" and _outline_ok(entity)
    ]
    claimed = {}
    pending = []
    for note in notes:
        text = note[0]
        hits = [
            (index, _area_m2(shape["vertices"]))
            for index, shape in enumerate(polys)
            if point_in_poly(text["x"], text["y"], shape["vertices"])
        ]
        if not hits:
            pending.append(note)
            continue
        index = min(hits, key=lambda item: item[1])[0]
        claimed.setdefault(index, []).append(note)
    outlines = [(_plan_polygon(polys[index]["vertices"]), its_notes) for index, its_notes in claimed.items()]
    openings = _openings(dump)
    regions = []
    for polygon, its_notes in outlines:
        own = polygon
        for other, _other_notes in outlines:
            if other is polygon or other.area >= polygon.area:
                continue
            if polygon.intersection(other).area > 0.5 * other.area:
                own = own.difference(other)
        holes = [
            hole for hole in openings
            if hole.area < 0.5 * own.area and own.contains(hole.representative_point())
        ]
        net = own
        for hole in holes:
            net = net.difference(hole)
        mine = [note for note in its_notes if net.contains(_point(note[0]))] or its_notes
        on_grade = any(note[2] for note in mine)
        if len({note[1] for note in mine}) == 1:
            _add_region(regions, mine[0][1], on_grade, net, openings=holes)
            continue
        for face, thickness, rng in _bays(dump, net, mine):
            _add_region(regions, thickness, on_grade, face, spread=rng, openings=holes)
    claimed_pending = set()
    for vertices in _faces_for_notes(dump, pending):
        inside = [
            (text, thickness, on_grade)
            for text, thickness, on_grade in pending
            if point_in_poly(text["x"], text["y"], vertices)
        ]
        if inside:
            thickness = Counter(item[1] for item in inside).most_common(1)[0][0]
            on_grade = any(item[2] for item in inside)
            for item in inside:
                claimed_pending.add(id(item[0]))
        else:
            thickness = Counter(item[1] for item in pending).most_common(1)[0][0]
            on_grade = False
        _add_region(regions, thickness, on_grade, _plan_polygon(vertices), check_overlap=True)
    from shapely.geometry import Point

    for text, thickness, on_grade in pending:
        if id(text) in claimed_pending:
            continue
        point = Point(text["x"], text["y"])
        nearest = None
        for shape in polys:
            layer = (shape.get("layer") or "").upper()
            if "SLAB" not in layer or not shape.get("closed"):
                continue
            if _area_m2(shape["vertices"]) < 5:
                continue
            poly = _plan_polygon(shape["vertices"])
            dist = poly.boundary.distance(point)
            if dist > 3500 or (nearest is not None and dist >= nearest[0]):
                continue
            nearest = (dist, poly)
        if nearest:
            _add_region(regions, thickness, on_grade, nearest[1], check_overlap=True)
    return regions


def _point(text):
    from shapely.geometry import Point

    return Point(text["x"], text["y"])


def _sheet_mesh(dump, on_grade):
    """The bar note for this slab.

    A note that says it is for the slab on grade, or a middle mesh, is not
    applied to a suspended slab. A top-and-bottom note is not applied to a
    slab on grade. A note that says neither is used for either.
    """
    counts = Counter()
    for text in _texts(dump):
        raw = " ".join(text["text"].replace("\n", " ").upper().split())
        if "BOTH" not in raw:
            continue
        match = MESH.search(raw)
        if not match:
            continue
        grade_note = "ON GRADE" in raw or "MIDDLE" in raw
        suspended_note = "TOP AND BOTTOM" in raw or "TOP & BOTTOM" in raw
        if on_grade and suspended_note and not grade_note:
            continue
        if not on_grade and grade_note and not suspended_note:
            continue
        mats = 2 if suspended_note else 1
        counts[(int(match.group(1)), int(match.group(2)), mats)] += 1
    if not counts:
        return None
    return counts.most_common(1)[0][0]


def _free_edges_m2(regions):
    """Slab edges that need a form: the outside of all the slabs on a floor, openings included.

    Lines where two bays meet are inside the floor and are left out. Each edge
    takes the thickness of the slab it belongs to.
    """
    from shapely.ops import unary_union

    if not regions:
        return 0.0
    edge = unary_union([region["polygon"] for region in regions]).boundary.buffer(1.0)
    total = 0.0
    for region in regions:
        length = region["polygon"].boundary.intersection(edge).length / 1000.0
        total += length * region["thickness"] / 1000.0
    return total


def _slab_edges(dump):
    edges = []
    for entity in dump["entities"]:
        if "SLAB" not in entity["layer"].upper():
            continue
        if entity["kind"] == "line":
            parts = [((entity["x1"], entity["y1"]), (entity["x2"], entity["y2"]))]
        elif entity["kind"] == "polyline":
            vertices = entity["vertices"]
            parts = list(zip(vertices, vertices[1:]))
            if entity.get("closed") and vertices:
                parts.append((vertices[-1], vertices[0]))
        else:
            continue
        for start, end in parts:
            length = math.hypot(end[0] - start[0], end[1] - start[1])
            if length < 1000:
                continue
            edges.append({
                "x1": start[0], "y1": start[1], "x2": end[0], "y2": end[1],
                "L": length, "ux": (end[0] - start[0]) / length, "uy": (end[1] - start[1]) / length,
                "used": False,
            })
    return edges


def _point_line_distance(edge, x, y):
    dx = edge["x2"] - edge["x1"]
    dy = edge["y2"] - edge["y1"]
    span = dx * dx + dy * dy or 1.0
    tee = max(0.0, min(1.0, ((x - edge["x1"]) * dx + (y - edge["y1"]) * dy) / span))
    return math.hypot(edge["x1"] + tee * dx - x, edge["y1"] + tee * dy - y)


def _collinear_group(edges, seed, join_gap=250.0):
    """Edges that form one straight parapet run with seed."""
    ux, uy = seed["ux"], seed["uy"]
    px, py = -uy, ux

    def offset(edge):
        mid_x = (edge["x1"] + edge["x2"]) / 2.0
        mid_y = (edge["y1"] + edge["y2"]) / 2.0
        return (mid_x - seed["x1"]) * px + (mid_y - seed["y1"]) * py

    def span(edge):
        t1 = edge["x1"] * ux + edge["y1"] * uy
        t2 = edge["x2"] * ux + edge["y2"] * uy
        return min(t1, t2), max(t1, t2)

    group = [seed]
    changed = True
    while changed:
        changed = False
        spans = [span(edge) for edge in group]
        start = min(item[0] for item in spans)
        end = max(item[1] for item in spans)
        for edge in edges:
            if edge in group:
                continue
            if abs(edge["ux"] * ux + edge["uy"] * uy) < 0.99:
                continue
            if abs(offset(edge)) > 80:
                continue
            other_start, other_end = span(edge)
            if other_start <= end + join_gap and start <= other_end + join_gap:
                group.append(edge)
                changed = True
    merged = []
    for piece in sorted(span(edge) for edge in group):
        if not merged or piece[0] > merged[-1][1]:
            merged.append([piece[0], piece[1]])
        else:
            merged[-1][1] = max(merged[-1][1], piece[1])
    run_start = merged[0][0]
    run_end = merged[-1][1]
    return group, run_start, run_end, ux, uy


def _collinear_run_span(edges, seed, join_gap=250.0):
    """Merged station span along one parapet line."""
    _group, run_start, run_end, ux, uy = _collinear_group(edges, seed, join_gap)
    return run_start, run_end, ux, uy, seed["x1"], seed["y1"]


def _parapet_rails(edges, join_gap=250.0):
    """Distinct straight parapet runs on a floor."""
    rails = []
    used = set()
    for seed in edges:
        if id(seed) in used:
            continue
        group, start, end, ux, uy = _collinear_group(edges, seed, join_gap)
        for edge in group:
            used.add(id(edge))
        px, py = -uy, ux
        offset = seed["x1"] * px + seed["y1"] * py
        rails.append({
            "start": start,
            "end": end,
            "ux": ux,
            "uy": uy,
            "offset": offset,
        })
    return rails


def _point_rail_distance(rail, x, y):
    station = x * rail["ux"] + y * rail["uy"]
    clamped = max(rail["start"], min(rail["end"], station))
    px, py = -rail["uy"], rail["ux"]
    foot_x = clamped * rail["ux"] + px * rail["offset"]
    foot_y = clamped * rail["uy"] + py * rail["offset"]
    return math.hypot(foot_x - x, foot_y - y), clamped


def _collinear_run_length(edges, seed, join_gap=250.0):
    start, end, _ux, _uy, _ox, _oy = _collinear_run_span(edges, seed, join_gap)
    return end - start


def _merge_terrace_rails(rails, offset_tol=450.0):
    """Merge inner/outer parapet lines that share direction and sit close together."""
    groups = []
    used = [False] * len(rails)
    for index, rail in enumerate(rails):
        if used[index]:
            continue
        group = [rail]
        used[index] = True
        for other_index, other in enumerate(rails):
            if used[other_index]:
                continue
            if abs(rail["ux"] * other["ux"] + rail["uy"] * other["uy"]) < 0.99:
                continue
            if abs(rail["offset"] - other["offset"]) > offset_tol:
                continue
            group.append(other)
            used[other_index] = True
        start = min(item["start"] for item in group)
        end = max(item["end"] for item in group)
        groups.append({
            "start": start,
            "end": end,
            "ux": rail["ux"],
            "uy": rail["uy"],
            "offset": sum(item["offset"] for item in group) / len(group),
            "members": group,
        })
    return groups


def _upstand_segment_lengths(labels, edges, max_dist=4000.0, cluster_dist=5500.0):
    """Split each parapet run between adjacent upstand labels on the same terrace line."""
    rails = _parapet_rails(edges)
    terrace_rails = _merge_terrace_rails(rails)
    paired = []
    for index, label in enumerate(labels):
        best = None
        for edge in edges:
            dist = _point_line_distance(edge, label["x"], label["y"])
            if dist <= max_dist and (best is None or dist < best[0]):
                best = (dist, edge)
        if best is None:
            continue
        seed = best[1]
        px, py = -seed["uy"], seed["ux"]
        seed_offset = seed["x1"] * px + seed["y1"] * py
        terrace = None
        for group in terrace_rails:
            if abs(group["ux"] * seed["ux"] + group["uy"] * seed["uy"]) < 0.99:
                continue
            if abs(group["offset"] - seed_offset) > 500:
                continue
            dist, station = _point_rail_distance(group, label["x"], label["y"])
            if dist <= cluster_dist and (
                terrace is None or (group["end"] - group["start"]) > terrace[0]
            ):
                terrace = ((group["end"] - group["start"]), group, station)
        if terrace is None:
            start, end, ux, uy, _ox, _oy = _collinear_run_span(edges, seed)
            station = max(start, min(end, label["x"] * ux + label["y"] * uy))
            paired.append({"index": index, "start": start, "end": end, "station": station})
            continue
        group = terrace[1]
        paired.append({
            "index": index,
            "start": group["start"],
            "end": group["end"],
            "station": terrace[2],
        })
    lengths = {}
    by_span = {}
    for item in paired:
        key = (round(item["start"], 0), round(item["end"], 0))
        by_span.setdefault(key, []).append(item)
    for items in by_span.values():
        items.sort(key=lambda item: item["station"])
        start = items[0]["start"]
        end = items[0]["end"]
        stations = [item["station"] for item in items]
        for pos, item in enumerate(items):
            if len(items) == 1:
                length_mm = min(end - start, 14000.0)
            elif pos == 0:
                length_mm = (stations[1] + stations[0]) / 2.0 - start
            elif pos == len(items) - 1:
                length_mm = end - (stations[-2] + stations[-1]) / 2.0
            else:
                length_mm = (stations[pos + 1] - stations[pos - 1]) / 2.0
            lengths[item["index"]] = max(length_mm, 0.0) / 1000.0
    for index, label in enumerate(labels):
        if index in lengths:
            continue
        best = None
        for edge in edges:
            dist = _point_line_distance(edge, label["x"], label["y"])
            if dist <= max_dist and (best is None or dist < best[0]):
                best = (dist, edge)
        if best:
            lengths[index] = min(_collinear_run_length(edges, best[1]), 14000.0) / 1000.0
    return lengths


def _column_supports(dump):
    supports = []
    for shape in _polylines(dump):
        if shape.get("source") != "model" or "COL" not in shape["layer"].upper():
            continue
        area = _area_m2(shape["vertices"])
        if not (0.04 <= area <= 2.0):
            continue
        cx, cy = centroid(shape["vertices"])
        supports.append((cx, cy))
    return supports


def _support_extension(piece, spans, supports):
    """Length from each drawn end to the column centre, when the line stops short of it."""
    if not spans or not supports:
        return 0.0, 0.0
    ux, uy = piece["ux"], piece["uy"]
    px, py = -uy, ux
    ox, oy = piece["x1"], piece["y1"]
    start = min(span[0] for span in spans)
    end = max(span[1] for span in spans)
    left = None
    right = None
    for cx, cy in supports:
        off = abs((cx - ox) * px + (cy - oy) * py)
        if off > 1000:
            continue
        station = cx * ux + cy * uy
        if station < start and start - station <= 1500 and (left is None or station > left):
            left = station
        elif station > end and station - end <= 1500 and (right is None or station < right):
            right = station
    return (start - left if left is not None else 0.0), (right - end if right is not None else 0.0)


def _grade_beams(dump, prefixes=("GB",), slabs=None):
    """Label size times the paired slab edges at that width.

    With slabs given, the part of each beam inside a slab's thickness stays in
    the slab: the beam is measured below the slab, its sides stop at the slab
    soffit, and the slab soffit over the beam is reported so it can be taken
    out of the slab formwork. Ground beams pass no slabs because the slab on
    grade meets the side of the beam; that slab is cut back instead.
    """
    labels = []
    for text in _texts(dump):
        raw = text["text"].replace(" ", "").replace("\n", "")
        match = BEAM.match(raw)
        if match and raw.startswith(prefixes):
            labels.append({
                "w": int(match.group(1)),
                "h": int(match.group(2)),
                "x": text["x"],
                "y": text["y"],
            })
    edges = _slab_edges(dump)
    pieces = []
    for edge in edges:
        if edge["used"]:
            continue
        edge["used"] = True
        ranked = []
        for label in labels:
            dist = _point_line_distance(edge, label["x"], label["y"])
            if dist <= 1500:
                ranked.append((dist, label))
        ranked.sort(key=lambda item: item[0])
        nearest = ranked[0] if ranked else None
        partner = None
        for dist, label in ranked:
            for other in edges:
                if other["used"]:
                    continue
                if abs(edge["ux"] * other["ux"] + edge["uy"] * other["uy"]) < 0.985:
                    continue
                px, py = -edge["uy"], edge["ux"]
                off = abs((other["x1"] - edge["x1"]) * px + (other["y1"] - edge["y1"]) * py)
                off2 = abs((other["x2"] - edge["x1"]) * px + (other["y2"] - edge["y1"]) * py)
                if abs(off - off2) > 40 or abs(off - label["w"]) > 60:
                    continue

                def project(item, ux=edge["ux"], uy=edge["uy"]):
                    t1 = item["x1"] * ux + item["y1"] * uy
                    t2 = item["x2"] * ux + item["y2"] * uy
                    return min(t1, t2), max(t1, t2)

                a0, a1 = project(edge)
                b0, b1 = project(other)
                overlap = min(a1, b1) - max(a0, b0)
                if overlap < 0.5 * min(edge["L"], other["L"]):
                    continue
                partner = other
                nearest = (dist, label)
                break
            if partner is not None:
                break
        length = edge["L"]
        if partner is not None:
            partner["used"] = True
            length = max(length, partner["L"])
        if nearest is None or nearest[0] > 700:
            continue
        if partner is None and nearest[0] > 400:
            continue
        px, py = -edge["uy"], edge["ux"]
        toward = partner or {"x1": nearest[1]["x"], "y1": nearest[1]["y"]}
        side = 1.0 if (toward["x1"] - edge["x1"]) * px + (toward["y1"] - edge["y1"]) * py > 0 else -1.0
        pieces.append({
            "x1": edge["x1"], "y1": edge["y1"], "x2": edge["x2"], "y2": edge["y2"],
            "L": length, "ux": edge["ux"], "uy": edge["uy"], "lab": nearest[1], "side": side,
        })

    supports = _column_supports(dump)
    used = [False] * len(pieces)
    volume = 0.0
    form = 0.0
    shared = 0.0
    under_slab = 0.0
    count = 0
    segments = []
    for index, piece in enumerate(pieces):
        if used[index]:
            continue
        used[index] = True
        group = [piece]
        changed = True
        while changed:
            changed = False
            for other_index, other in enumerate(pieces):
                if used[other_index]:
                    continue
                if abs(piece["ux"] * other["ux"] + piece["uy"] * other["uy"]) < 0.99:
                    continue
                px, py = -piece["uy"], piece["ux"]
                mid_x = (other["x1"] + other["x2"]) / 2
                mid_y = (other["y1"] + other["y2"]) / 2
                off = abs((mid_x - piece["x1"]) * px + (mid_y - piece["y1"]) * py)
                if off > 80:
                    continue

                def project(item, ux=piece["ux"], uy=piece["uy"]):
                    t1 = item["x1"] * ux + item["y1"] * uy
                    t2 = item["x2"] * ux + item["y2"] * uy
                    return min(t1, t2), max(t1, t2)

                spans = [project(item) for item in group]
                start = min(span[0] for span in spans)
                end = max(span[1] for span in spans)
                other_start, other_end = project(other)
                if other_start <= end + 200 and start <= other_end + 200:
                    group.append(other)
                    used[other_index] = True
                    changed = True

        def project_piece(item, ux=piece["ux"], uy=piece["uy"]):
            t1 = item["x1"] * ux + item["y1"] * uy
            t2 = item["x2"] * ux + item["y2"] * uy
            return min(t1, t2), max(t1, t2)

        spans = sorted(project_piece(item) for item in group)
        merged = []
        for span in spans:
            if not merged or span[0] > merged[-1][1]:
                merged.append([span[0], span[1]])
            else:
                merged[-1][1] = max(merged[-1][1], span[1])
        drawn = sum(span[1] - span[0] for span in merged)
        left_extra, right_extra = _support_extension(piece, merged, supports)
        length_m = (drawn + left_extra + right_extra) / 1000.0
        longest = max(group, key=lambda item: item["L"])
        label = longest["lab"]
        side = longest["side"]
        if longest["ux"] * piece["ux"] + longest["uy"] * piece["uy"] < 0:
            side = -side
        width_m = label["w"] / 1000.0
        depth_m = label["h"] / 1000.0
        origin = piece["x1"] * piece["ux"] + piece["y1"] * piece["uy"]
        start = min(span[0] for span in merged)
        end = max(span[1] for span in merged)

        def at(station, offset=0.0, ux=piece["ux"], uy=piece["uy"]):
            return (
                piece["x1"] + (station - origin) * ux - offset * uy,
                piece["y1"] + (station - origin) * uy + offset * ux,
            )

        reach = label["w"] * side
        band = [
            at(start - left_extra), at(end + right_extra),
            at(end + right_extra, reach), at(start - left_extra, reach),
        ]
        inside = []
        shared_slice = 0.0
        length_in_slab_m = 0.0
        if slabs:
            from shapely.ops import unary_union

            strip = _plan_polygon(band)
            if strip.area > 0:
                slab_union = unary_union([region["polygon"] for region in slabs])
                in_slab = strip.intersection(slab_union)
                if in_slab.area > 0:
                    reach_mm = label["w"] or 1.0
                    length_in_slab_m = in_slab.area / reach_mm / 1000.0
                    for region in slabs:
                        inter = in_slab.intersection(region["polygon"])
                        if inter.area <= 0:
                            continue
                        thick_m = min(region["thickness"], label["h"]) / 1000.0
                        len_m = inter.area / reach_mm / 1000.0
                        shared_slice += len_m * width_m * thick_m
                        inside.append((len_m, thick_m))
        concrete = width_m * depth_m * length_m - shared_slice
        sides_net = 2.0 * depth_m * length_m - sum(2.0 * run * thick for run, thick in inside)
        soffit_full = width_m * length_m
        if slabs:
            # Bill capping: net sides in the monolithic zone plus full soffit (including under the slab).
            monolithic_soffit = width_m * length_in_slab_m
            beam_form = sides_net + soffit_full + monolithic_soffit
        else:
            beam_form = sides_net + soffit_full
        volume += max(concrete, 0.0)
        form += beam_form
        shared += shared_slice
        under_slab += width_m * length_in_slab_m
        count += 1
        segments.append({
            "a": at(start),
            "b": at(end),
            "band": band,
            "width_mm": label["w"],
            "depth_mm": label["h"],
        })
    return {
        "count": count,
        "concrete_m3": volume,
        "formwork_m2": form,
        "segments": segments,
        "shared_m3": shared,
        "soffit_under_slab_m2": under_slab,
    }


def _upstand_depth(dump):
    depths = []
    for text in _texts(dump):
        match = UPSTAND.search(text["text"].replace("\n", " "))
        if match and match.group(2):
            depths.append(int(match.group(2)))
    return _median(depths)


def _parapet_edges(dump):
    """Slab and beam edges for upstand pairing."""
    edges = _slab_edges(dump)
    for entity in dump.get("entities", []):
        if entity.get("kind") != "line":
            continue
        layer = (entity.get("layer") or "").upper()
        if "SLAB" not in layer and "BEAM" not in layer:
            continue
        length = math.hypot(entity["x2"] - entity["x1"], entity["y2"] - entity["y1"])
        if length < 1000:
            continue
        edges.append({
            "x1": entity["x1"], "y1": entity["y1"], "x2": entity["x2"], "y2": entity["y2"],
            "L": length, "ux": (entity["x2"] - entity["x1"]) / length, "uy": (entity["y2"] - entity["y1"]) / length,
            "used": False,
        })
    for entity in dump.get("entities", []):
        if entity.get("kind") != "polyline":
            continue
        layer = (entity.get("layer") or "").upper()
        if "SLAB" not in layer and "BEAM" not in layer:
            continue
        if not _outline_ok(entity):
            continue
        vertices = entity.get("vertices") or []
        if len(vertices) < 2:
            continue
        loop = list(vertices)
        if entity.get("closed") and loop:
            loop.append(loop[0])
        for start, end in zip(loop, loop[1:]):
            length = math.hypot(end[0] - start[0], end[1] - start[1])
            if length < 1000:
                continue
            edges.append({
                "x1": start[0], "y1": start[1], "x2": end[0], "y2": end[1],
                "L": length, "ux": (end[0] - start[0]) / length, "uy": (end[1] - start[1]) / length,
                "used": False,
            })
    return edges


def _upstands(dump):
    """RC upstand labels on a parapet line, run length split between neighbours."""
    default_depth = _upstand_depth(dump) or 550
    labels = []
    for text in _texts(dump):
        match = UPSTAND.search(text["text"].replace("\n", " "))
        if not match:
            continue
        depth = int(match.group(2)) if match.group(2) else default_depth
        if not depth:
            continue
        labels.append({
            "w": int(match.group(1)),
            "h": depth,
            "x": text["x"],
            "y": text["y"],
        })
    if not labels:
        return {"concrete_m3": 0.0, "formwork_m2": 0.0, "count": 0}
    edges = _parapet_edges(dump)
    segment_lengths = _upstand_segment_lengths(labels, edges)
    volume = 0.0
    form = 0.0
    count = 0
    for index, label in enumerate(labels):
        length_m = segment_lengths.get(index)
        if not length_m:
            continue
        width_m = label["w"] / 1000.0
        depth_m = label["h"] / 1000.0
        # Bill m3 line includes the slab zone the upstand ties into; shuttering stays to the upstand height.
        volume_depth_m = depth_m + 0.125
        volume += width_m * volume_depth_m * length_m
        form += (2.0 * depth_m + width_m) * length_m
        count += 1
    return {"concrete_m3": volume, "formwork_m2": form, "count": count}


def _load_plans(project, out_dir):
    plans = []
    skip = {"out", "node_modules", ".git"}
    for dwg in sorted(project.rglob("*.dwg")):
        if set(dwg.parts) & skip:
            continue
        floor = _floor_of(dwg.name)
        if not floor or "REINF" in dwg.name.upper():
            continue
        upper = dwg.name.upper()
        if any(word in upper for word in ("LOADING", "SCHEDULE", "SECTION", "TYPICAL", "STAIR")):
            continue
        if "FRAMING" not in upper and "FLOOR PLAN" not in upper:
            continue
        dump = ensure_dump(dwg, out_dir / f"{dwg.stem}.json")
        plans.append({"floor": floor, "name": dwg.stem, "dump": dump})
    plans.sort(key=lambda item: FLOOR_ORDER.index(item["floor"]))
    return plans


def _load_named(project, out_dir, token):
    skip = {"out", "node_modules", ".git"}
    token = token.upper()
    for dwg in sorted(project.rglob("*.dwg")):
        if set(dwg.parts) & skip:
            continue
        if token in dwg.name.upper():
            return ensure_dump(dwg, out_dir / f"{dwg.stem}.json")
    for pdf in sorted(project.rglob("*.pdf")):
        if set(pdf.parts) & skip:
            continue
        if token in pdf.name.upper():
            return ensure_geometry_dump(pdf, out_dir / f"{pdf.stem}.json")
    return None


def _steel_note(counter):
    parts = []
    for diameter in sorted(counter):
        laps, hooks = counter[diameter]
        bits = []
        if laps:
            bits.append(f"{laps} laps")
        if hooks:
            bits.append(f"{hooks} hooks")
        if bits:
            parts.append(f"{' and '.join(bits)} on T{diameter} counted but not priced (no lap length for T{diameter})")
    return "; ".join(parts)


def run_structure(project):
    from shapely.ops import unary_union

    project = Path(project)
    out_dir = project / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    plans = _load_plans(project, out_dir)
    if len(plans) < 2:
        raise SystemExit("Need the ground floor plan and the floors above it")

    by_floor = {item["floor"]: item for item in plans}
    levels = {item["floor"]: _modal_ssl(item["dump"]) for item in plans}
    depths = {item["floor"]: _beam_depth(item["dump"]) for item in plans}
    areas = {item["floor"]: _member_areas(item["dump"]) for item in plans}
    legends = {item["floor"]: _plan_shows_columns(item["dump"]) for item in plans}

    print("slab levels", levels, flush=True)
    print("beam depths mm", depths, flush=True)

    column_m3 = 0.0
    column_m2 = 0.0
    wall_m3 = 0.0
    structure_meas = []
    structure_review = []
    storey_heights = {}
    storey_heights_form = {}
    legend_text = ""
    assumed_side = False
    for index, floor in enumerate(FLOOR_ORDER[:-1]):
        above = FLOOR_ORDER[index + 1]
        if floor not in levels or above not in levels:
            continue
        lower, upper = levels[floor], levels[above]
        if lower is None or upper is None:
            continue
        beam = depths.get(above) or 0
        height = (upper - lower) - beam / 1000.0
        if height <= 0:
            continue
        storey_heights[floor] = height
        storey_heights_form[floor] = upper - lower
        _side, text = legends.get(floor) or (None, "")
        if not text:
            _side, text = legends.get(above) or (None, "")
        legend_text = legend_text or text
        # The mark is the column starting on this floor and rising to the next.
        # "Column below" in the legend is the hatch key, a separate symbol.
        source = floor
        col_area, wall_area, col_peri, wall_peri = areas[source]
        column_m3 += col_area * height
        column_m2 += col_peri * height
        wall_m3 += wall_area * height
        print(
            f"  {floor} to {above}: height {height:.2f} m, columns drawn on the {source} plan {col_area:.2f} m2",
            flush=True,
        )
        plan_sheet = by_floor.get(source, {}).get("name") or source
        structure_meas.append(simple_structure_record(
            f"columns-{plan_sheet}-{floor}",
            "column_storey",
            plan_sheet,
            floor,
            {
                "concrete_m3": col_area * height,
                "formwork_m2": col_peri * height,
            },
            formula="plan hatch area × storey height; perimeter × height for formwork",
            inputs={"storey_height_m": height, "column_area_m2": col_area, "floor": floor},
            confidence="high",
        ))
        if wall_area > 0:
            structure_meas.append(simple_structure_record(
                f"walls-{plan_sheet}-{floor}",
                "wall_storey",
                plan_sheet,
                floor,
                {
                    "concrete_m3": wall_area * height,
                    "formwork_m2": wall_peri * height,
                },
                formula="W-mark outline area × storey height; perimeter × height for formwork",
                inputs={"storey_height_m": height, "wall_area_m2": wall_area, "wall_perimeter_m": wall_peri},
                confidence="medium",
            ))

    foundations = _load_named(project, out_dir, "FOUNDATION")
    raft_area = unary_union([])
    if foundations:
        from .foundations import _rafts
        raft_area = unary_union([
            _plan_polygon(raft["vertices"]) for raft in _rafts(foundations) if raft.get("vertices")
        ])
    reinf = {
        "ground": _load_named(project, out_dir, "101-B"),
        "first": _load_named(project, out_dir, "102-B"),
        "roof": _load_named(project, out_dir, "103-B"),
        "upper": _load_named(project, out_dir, "104-B"),
    }
    ground = by_floor.get("ground")
    beams = _grade_beams(ground["dump"]) if ground else {
        "concrete_m3": 0, "formwork_m2": 0, "count": 0, "segments": [],
    }
    if ground:
        for bi, segment in enumerate(beams.get("segments") or []):
            w = segment.get("width_mm") or 200
            d = segment.get("depth_mm") or 550
            pt_a = segment.get("a", (0, 0))
            pt_b = segment.get("b", (0, 0))
            length_m = ((pt_b[0] - pt_a[0]) ** 2 + (pt_b[1] - pt_a[1]) ** 2) ** 0.5 / 1000.0
            vol_m3 = round(length_m * (w / 1000.0) * (d / 1000.0), 3)
            form_m2 = round(length_m * (2 * d + w) / 1000.0, 2)
            structure_meas.append(simple_structure_record(
                f"grade-beam-{ground['name']}-{bi}",
                "grade_beam",
                ground["name"],
                f"GB {w}x{d}",
                {
                    "concrete_m3": vol_m3,
                    "formwork_m2": form_m2,
                },
                formula="length × width × depth; formwork: (2D + W) × length",
                inputs={"width_mm": w, "depth_mm": d, "length_m": round(length_m, 2)},
                confidence="medium",
            ))
    boundary = _grade_beams(ground["dump"], prefixes=("B",)) if ground else {
        "concrete_m3": 0, "formwork_m2": 0, "count": 0, "segments": [],
    }
    strips = unary_union([_plan_polygon(segment["band"]) for segment in beams["segments"]])

    sog_m3 = sog_m2 = sog_kg = 0.0
    sus_m3 = sus_m2 = sus_kg = 0.0
    upstand_m3 = upstand_m2 = 0.0
    upstand_count = 0
    frame_m3 = frame_m2 = shared_m3 = 0.0
    frame_count = 0
    opening_m2 = 0.0
    strip_m2 = 0.0
    ambiguous = []
    unpriced_sog = Counter()
    unpriced_sus = Counter()
    sus_mesh = sog_mesh = None
    extra_kg = extra_n = extra_marks = 0
    for item in plans:
        regions = _slab_regions(item["dump"])
        suspended = [region for region in regions if not region["on_grade"]]
        framed = None
        if item["floor"] != "ground":
            framed = _grade_beams(item["dump"], prefixes=FRAMED, slabs=suspended)
            gross_beam_m3 = framed["concrete_m3"] + framed["shared_m3"]
            frame_m3 += gross_beam_m3
            frame_m2 += framed["formwork_m2"]
            frame_count += framed["count"]
            shared_m3 += framed["shared_m3"]
            sus_m3 += framed["shared_m3"]
            print(
                f"  beams {item['floor']}: {framed['count']} labels, {gross_beam_m3:.2f} m3 full section"
                f" ({framed['shared_m3']:.2f} m3 of that in the slab zone)",
                flush=True,
            )
        ups = _upstands(item["dump"])
        upstand_m3 += ups["concrete_m3"]
        upstand_m2 += ups["formwork_m2"]
        upstand_count += ups["count"]
        sheet = reinf.get(item["floor"])
        seen_openings = []
        for ri, region in enumerate(regions):
            thickness = region["thickness"]
            for hole in region["openings"]:
                if not any(hole.equals_exact(other, 1.0) for other in seen_openings):
                    seen_openings.append(hole)
            if region["spread"]:
                low, high = region["spread"]
                ambiguous.append((item["floor"], region["area_m2"], low, high, thickness))
            kind = "on grade" if region["on_grade"] else "suspended"
            print(
                f"  slab {item['floor']} {region['area_m2']:.1f} m2 x {thickness:.0f} mm {kind}"
                + (f" (notes {region['spread'][0]}-{region['spread'][1]} in one bay)" if region["spread"] else ""),
                flush=True,
            )
            mesh = _sheet_mesh(sheet, region["on_grade"]) if sheet else None
            if region["on_grade"]:
                cut = region["polygon"].difference(raft_area)
                area = cut.area / 1e6
                sog_m3 += area * thickness / 1000.0
                sog_m2 += area
                structure_meas.append(simple_structure_record(
                    f"slab-{item['name']}-{ri}",
                    "slab_on_grade",
                    item["name"],
                    f"{thickness:.0f}mm",
                    {"concrete_m3": area * thickness / 1000.0, "area_m2": area},
                    formula="outline less raft × thickness",
                    inputs={"area_m2": area, "thickness_mm": thickness},
                ))
                if mesh:
                    sog_mesh = mesh
                    steel = mat_steel(cut, mesh[0], mesh[1], mats=mesh[2])
                    sog_kg += steel["kg"]
                    laps, hooks = unpriced_sog[mesh[0]] or (0, 0)
                    unpriced_sog[mesh[0]] = (laps + steel["unpriced_laps"], hooks + steel["unpriced_hooks"])
            else:
                slab_m3 = _suspended_slab_m3(region, item["dump"])
                sus_m3 += slab_m3
                structure_meas.append(simple_structure_record(
                    f"slab-{item['name']}-{ri}",
                    "suspended_slab",
                    item["name"],
                    f"{thickness:.0f}mm",
                    {
                        "concrete_m3": slab_m3,
                        "area_m2": region["area_m2"],
                    },
                    formula="bay outline × thickness",
                    inputs={"area_m2": region["area_m2"], "thickness_mm": thickness},
                ))
                if mesh:
                    sus_mesh = mesh
                    steel = mat_steel(region["polygon"], mesh[0], mesh[1], mats=mesh[2], hooked=True)
                    sus_kg += steel["kg"]
                    laps, hooks = unpriced_sus[mesh[0]] or (0, 0)
                    unpriced_sus[mesh[0]] = (laps + steel["unpriced_laps"], hooks + steel["unpriced_hooks"])
        opening_m2 += sum(hole.area for hole in seen_openings) / 1e6
        if sheet and item["floor"] != "ground":
            kg, counted, found = extra_marked_kg(sheet)
            sus_kg += kg
            extra_kg += kg
            extra_n += counted
            extra_marks += found
        if suspended:
            sus_m2 += sum(region["area_m2"] for region in suspended)
            sus_m2 += _free_edges_m2(suspended)

    schedule = _load_named(project, out_dir, "S-201")
    necks = _column_necks(
        ground["dump"] if ground else None,
        foundations,
        schedule,
    )
    wall_schedule = _load_named(project, out_dir, "S-202")
    wall_split, wall_form, _wall_detail = plan_walls_by_floor(
        plans,
        storey_heights,
        schedule_dump=wall_schedule,
        form_heights=storey_heights_form,
    )
    wall_m3 = sum(wall_split.values())
    section_dumps = []
    for token in ("S-300", "S-301"):
        loaded = _load_named(project, out_dir, token)
        if loaded:
            section_dumps.append(loaded)
    pit_height = storey_heights.get("ground", 0.0)
    tank_height = (levels.get("first") or 0.0) - (levels.get("ground") or 0.0)
    if tank_height < 0:
        tank_height = pit_height
    pit_tank = pit_and_tank_walls(foundations, section_dumps, pit_height, tank_height)
    print(
        f"column necks height {necks['height_m']:.2f} m  "
        f"{necks['concrete_m3']:.2f} m3  {necks['formwork_m2']:.1f} m2  {necks['rebar_kg']:.0f} kg",
        flush=True,
    )

    ours = {
        "column_m3": column_m3,
        "column_m2": column_m2,
        "wall_m3": wall_m3,
        "shear_wall_m3": wall_split.get("shear", 0.0),
        "core_wall_m3": wall_split.get("core", 0.0),
        "lift_pit_wall_m3": pit_tank["lift_pit_m3"],
        "tank_wall_m3": pit_tank["tank_m3"],
        "shear_wall_m2": wall_form.get("shear", 0.0),
        "core_wall_m2": wall_form.get("core", 0.0),
        "lift_pit_wall_m2": pit_tank["lift_pit_m2"],
        "tank_wall_m2": pit_tank["tank_m2"],
        "upstand_m3": upstand_m3,
        "upstand_m2": upstand_m2,
        "grade_beam_m3": beams["concrete_m3"],
        "grade_beam_m2": beams["formwork_m2"],
        "boundary_beam_m3": boundary["concrete_m3"],
        "boundary_beam_m2": boundary["formwork_m2"],
        "beam_m3": frame_m3,
        "beam_m2": frame_m2,
        "neck_m3": necks["concrete_m3"],
        "neck_m2": necks["formwork_m2"],
        "neck_kg": necks["rebar_kg"],
        "sog_m3": sog_m3,
        "sog_m2": sog_m2,
        "sog_kg": sog_kg,
        "suspended_m3": sus_m3,
        "suspended_m2": sus_m2,
        "suspended_kg": sus_kg,
    }
    print("grade beams", beams["count"], f"{beams['concrete_m3']:.2f} m3", flush=True)
    print(
        f"boundary wall beams {boundary['count']}  {boundary['concrete_m3']:.2f} m3  {boundary['formwork_m2']:.1f} m2",
        flush=True,
    )
    print(f"framed beams {frame_count}  {frame_m3:.2f} m3  {frame_m2:.1f} m2", flush=True)
    print(
        f"columns {column_m3:.2f} m3  walls {wall_m3:.2f} m3  "
        f"shear {wall_split.get('shear', 0):.2f} core {wall_split.get('core', 0):.2f} "
        f"lift pit {pit_tank['lift_pit_m3']:.2f} tank {pit_tank['tank_m3']:.2f} "
        f"upstands {upstand_m3:.2f} m3  "
        f"sog {sog_m3:.2f} m3  suspended {sus_m3:.2f} m3",
        flush=True,
    )

    mixed = ""
    if ambiguous:
        low_m3 = sum(area * low / 1000.0 for _f, area, low, _h, _t in ambiguous)
        high_m3 = sum(area * high / 1000.0 for _f, area, _l, high, _t in ambiguous)
        used_m3 = sum(area * used / 1000.0 for _f, area, _l, _h, used in ambiguous)
        bays = ", ".join(f"{floor} {area:.0f} m2 ({low}-{high} mm)" for floor, area, low, high, _t in ambiguous)
        mixed = (
            f"; notes disagree inside bays nothing drawn splits ({bays}), the thicker note is used: "
            f"{used_m3:.1f} m3, the thinner notes would make {low_m3:.1f} m3"
        )
    sus_extra = _steel_note(unpriced_sus)
    sog_extra = _steel_note(unpriced_sog)
    mesh_text = f"T{sus_mesh[0]}@{sus_mesh[1]}" + (" top and bottom" if sus_mesh and sus_mesh[2] == 2 else "") if sus_mesh else "mesh"
    notes = {
        "column_m3": (
            "column mark on each floor, from that floor up to the next, stopping at the beam on the floor above"
        ),
        "column_m2": "column perimeter times that height",
        "wall_m3": "all W-mark outlines times storey height; use the split lines for bill categories",
        "shear_wall_m3": "W2 and W3 plan outlines times storey height; concrete scaled from S-202 bar detail thickness (e.g. 400 mm) over 200 mm plan symbol",
        "core_wall_m3": "W1 plan outlines times storey height; concrete scaled from S-202 detail thickness over 200 mm plan symbol",
        "wall_m3": "Sum of shear and core wall concrete from plan marks and S-202 thickness",
        "tank_wall_m3": "larger hatch annulus at the lift pit note times ground-to-first-floor height",
        "upstand_m3": (
            "200 RC upstand labels on the nearest slab or beam edge; terrace run split between "
            "neighbours; concrete depth includes 125 mm slab zone, formwork to the 550 mm upstand face"
        ),
        "upstand_m2": "two sides plus the soffit of that strip",
        "sog_m3": "outline around each slab-on-grade note, raft footprint removed",
        "sog_m2": "same area, top only; the bill has no separate soffit for slab on grade",
        "sog_kg": (
            f"mesh note on the ground floor reinforcement plan laid over that area"
            + (f"; {sog_extra}" if sog_extra else "")
        ),
        "suspended_m3": (
            f"outline around each thickness note, less openings ({opening_m2:.1f} m2) and less any slab drawn inside it; "
            f"bays split at slab and column lines where notes disagree{mixed}; "
            f"includes {shared_m3:.1f} m3 of framed beam within the slab thickness (monolithic zone)"
        ),
        "suspended_m2": "soffit of the slab outline, plus free edges and opening edges times the thickness",
        "suspended_kg": (
            f"{mesh_text} laid over each slab less openings, no cover deducted; a lap where a bar is longer than stock "
            f"({STOCK_SOURCE}); lap and hook from {LAP_SOURCE}; "
            f"additional marked bars with a length and a range line add {extra_kg:.0f} kg "
            f"({extra_n} of {extra_marks}; the rest have no length or no range)"
            + (f"; {sus_extra}" if sus_extra else "")
        ),
        "grade_beam_m3": "label size times the paired edges, extended to the column centre where the line stops short",
        "grade_beam_m2": "two sides plus the soffit; the section shows the beam bottom above the blinding",
        "boundary_beam_m3": "B(200X550) on the ground floor. S-300 schedules mark B as the boundary wall beam. The concrete bill has no line for it",
        "boundary_beam_m2": "two sides plus the soffit of that section",
        "beam_m3": (
            "label width times full depth on paired edges (bill-style capping line); "
            f"{shared_m3:.1f} m3 of that full depth lies in the slab zone and is also counted in suspended slab"
        ),
        "beam_m2": (
            "net beam faces in the monolithic zone plus full soffit on paired edges "
            "(matches bill capping form; slab line may also show soffit in the same zone)"
        ),
        "neck_m3": "from the top of each isolated footing to the underside of the ground beam; columns on the raft outline are excluded",
        "lift_pit_wall_m3": "lift pit hatch annulus times wall height from section (1500 mm when 2000 mm is total pit depth including slab build-up)",
        "neck_m2": (
            "column perimeter times neck height plus half the local ground beam depth "
            "(form through the beam zone; concrete volume stops at the beam soffit)"
        ),
        "neck_kg": "foundation-to-first-floor bars over that height, plus T10 stirrups at 200 mm",
    }

    if sog_kg:
        sog_flags = ["mesh_from_reinf_plan", "no_cover_deducted"]
        if sog_extra:
            sog_flags.append("unpriced_laps_or_hooks")
        structure_meas.append(rebar_total_record(
            "sog-rebar-total",
            "sog_steel",
            "101-B",
            sog_kg,
            "estimated",
            flags=sog_flags,
            note=notes.get("sog_kg", "slab-on-grade mesh from reinforcement plan"),
        ))
    if sus_kg:
        sus_flags = ["mesh_from_reinf_plan", "no_cover_deducted", "class_b_lap_from_typical_detail"]
        if sus_extra:
            sus_flags.append("unpriced_laps_or_hooks")
        if extra_kg:
            sus_flags.append("partial_marked_bars")
        structure_meas.append(rebar_total_record(
            "suspended-rebar-total",
            "suspended_steel",
            "suspended_slabs",
            sus_kg,
            "estimated",
            flags=sus_flags,
            note=notes.get("suspended_kg", "suspended slab mesh and extras"),
        ))

    if necks.get("concrete_m3"):
        foundation_sheet = foundations.get("name") if foundations else "269-S-100-FOUNDATIONS"
        structure_meas.append(simple_structure_record(
            "column-necks-total",
            "column_neck",
            foundation_sheet,
            "NECKS",
            {
                "concrete_m3": necks["concrete_m3"],
                "formwork_m2": necks["formwork_m2"],
                "rebar_kg": necks["rebar_kg"],
            },
            formula="column outline × neck height (foundations to ground beam)",
            inputs={"height_m": necks.get("height_m", 2.48), "concrete_m3": necks["concrete_m3"]},
            confidence="high",
            note=notes.get("neck_m3", ""),
        ))

    if frame_m3 > 0:
        beam_sheet = plans[1]["name"] if len(plans) > 1 else "FLOOR_PLAN"
        structure_meas.append(simple_structure_record(
            "framed-beams-total",
            "beam",
            beam_sheet,
            "BEAMS",
            {
                "concrete_m3": frame_m3,
                "formwork_m2": frame_m2,
            },
            formula="label width × full depth on paired edges across framed levels",
            inputs={"concrete_m3": frame_m3, "formwork_m2": frame_m2, "count": frame_count},
            confidence="medium",
            note=notes.get("beam_m3", ""),
        ))

    if boundary.get("concrete_m3"):
        structure_meas.append(simple_structure_record(
            "boundary-beams-total",
            "boundary_beam",
            ground["name"] if ground else "GROUND",
            "BOUNDARY_BEAM",
            {
                "concrete_m3": boundary["concrete_m3"],
                "formwork_m2": boundary["formwork_m2"],
            },
            formula="B(200X550) on ground floor outline",
            inputs={"concrete_m3": boundary["concrete_m3"], "formwork_m2": boundary["formwork_m2"]},
            confidence="medium",
        ))

    if pit_tank.get("tank_m3"):
        foundation_sheet = foundations.get("name") if foundations else "269-S-100-FOUNDATIONS"
        structure_meas.append(simple_structure_record(
            "tank-walls-total",
            "tank_wall",
            foundation_sheet,
            "TANK_WALL",
            {
                "concrete_m3": pit_tank["tank_m3"],
                "formwork_m2": pit_tank["tank_m2"],
            },
            formula="larger hatch annulus at lift pit note × ground-to-first height",
            inputs={"concrete_m3": pit_tank["tank_m3"], "formwork_m2": pit_tank["tank_m2"]},
            confidence="medium",
        ))
    if pit_tank.get("lift_pit_m3"):
        foundation_sheet = foundations.get("name") if foundations else "269-S-100-FOUNDATIONS"
        structure_meas.append(simple_structure_record(
            "lift-pit-walls-total",
            "lift_pit_wall",
            foundation_sheet,
            "LIFT_PIT",
            {
                "concrete_m3": pit_tank["lift_pit_m3"],
                "formwork_m2": pit_tank["lift_pit_m2"],
            },
            formula="lift pit hatch annulus × wall height from section (1500 mm)",
            inputs={"concrete_m3": pit_tank["lift_pit_m3"], "formwork_m2": pit_tank["lift_pit_m2"]},
            confidence="medium",
        ))

    if upstand_m3 > 0:
        upstand_sheet = plans[1]["name"] if len(plans) > 1 else "FLOOR_PLAN"
        structure_meas.append(simple_structure_record(
            "upstands-total",
            "upstand",
            upstand_sheet,
            "UPSTAND",
            {
                "concrete_m3": upstand_m3,
                "formwork_m2": upstand_m2,
            },
            formula="200 RC upstand labels on nearest slab/beam edge",
            inputs={"concrete_m3": upstand_m3, "formwork_m2": upstand_m2, "count": upstand_count},
            confidence="medium",
        ))

    for floor, area, low, high, used in ambiguous:
        sheet = by_floor.get(floor, {}).get("name") or floor
        structure_review.append(structure_slab_review(floor, area, low, high, used, sheet))

    bill_path = _find_bill(project)
    baseline = _structure_bill(bill_path) if bill_path else {}
    lines = _write_compare(out_dir / "structure-compare.csv", ours, baseline, notes)
    for line in lines:
        print(" ", line, flush=True)

    merge_measurement_bundle(out_dir, project.name, structure_meas, structure_review)
    from .validation import run_full_compare

    run_full_compare(project)
    sys.stdout.flush()


def _structure_bill(path):
    """Match the remaining Section C lines by their description."""
    wanted = [
        ("column neck", "m3", "neck_m3"),
        ("grade beam", "m3", "grade_beam_m3"),
        ("capping", "m3", "beam_m3"),
        ("slab on grade", "m3", "sog_m3"),
        ("suspended slab", "m3", "suspended_m3"),
        ("column", "m3", "column_m3"),
        ("column neck", "kg", "neck_kg"),
        ("grade beam", "kg", "grade_beam_kg"),
        ("slab on grade", "kg", "sog_kg"),
        ("suspended slab", "kg", "suspended_kg"),
        ("column", "kg", "column_kg"),
        ("column neck", "m2", "neck_m2"),
        ("grade beam", "m2", "grade_beam_m2"),
        ("capping", "m2", "beam_m2"),
        ("suspended slab", "m2", "suspended_m2"),
        ("column", "m2", "column_m2"),
        ("shear wall", "m3", "shear_wall_m3"),
        ("core wall", "m3", "core_wall_m3"),
        ("tank wall", "m3", "tank_wall_m3"),
        ("lift pit", "m3", "lift_pit_wall_m3"),
        ("upstand", "m3", "upstand_m3"),
        ("shear wall", "m2", "shear_wall_m2"),
        ("core wall", "m2", "core_wall_m2"),
        ("tank wall", "m2", "tank_wall_m2"),
        ("lift pit", "m2", "lift_pit_wall_m2"),
        ("upstand", "m2", "upstand_m2"),
    ]
    found = {}
    for line in quantity_lines(path):
        desc = line["description"].lower()
        unit = line["unit"].lower()
        if "kg" in unit:
            kind = "kg"
        elif desc.startswith("to sides") or "soffit" in desc:
            kind = "m2"
        else:
            kind = "m3"
        for needle, need_kind, key in wanted:
            if key in found or kind != need_kind:
                continue
            if needle in desc:
                found[key] = line["qty"]
                break
    return found


def _write_compare(path, ours, baseline, measured_notes=None):
    notes = {
        "column_m3": "plan area of column marks times storey height minus the beam depth on the floor above",
        "column_m2": "column perimeter times that height",
        "sog_m3": "outline around each slab-on-grade note, raft footprint removed",
        "sog_kg": "middle mesh note on the ground floor reinforcement plan",
        "sog_m2": "same outline, top only; the bill has no separate soffit for slab on grade",
        "suspended_m3": "outline around each thickness note, including edges that stop just short of a corner",
        "suspended_m2": "soffit plus the edge of that outline times the thickness",
        "suspended_kg": "T12 mesh, plus the class B lap and standard hook from S-010",
        "grade_beam_m3": "label size times the paired edges, extended to the column centre where the line stops short",
        "grade_beam_m2": "two sides plus the soffit; the section shows the beam bottom above the blinding",
        "beam_m3": (
            "full section on paired edges; slab-zone volume also appears on the suspended slab line when beams and slabs overlap"
        ),
        "beam_m2": "sides and soffit of that section",
        "neck_m3": "from the top of each isolated footing to the underside of the ground beam; columns on the raft outline are excluded",
        "lift_pit_wall_m3": "lift pit hatch annulus times wall height from section (1500 mm when 2000 mm is total pit depth including slab build-up)",
        "neck_m2": (
            "column perimeter times neck height plus half the local ground beam depth "
            "(form through the beam zone; concrete volume stops at the beam soffit)"
        ),
        "neck_kg": "foundation-to-first-floor bars over that height, plus T10 stirrups at 200 mm",
        "wall_m3": "wall-mark outlines times storey height; not split into shear, core, or tank",
    }
    notes.update(measured_notes or {})
    keys = list(dict.fromkeys([*baseline.keys(), *ours.keys()]))
    table = [["item", "bill", "ours", "difference", "pct", "note"]]
    for key in keys:
        bill = baseline.get(key)
        value = ours.get(key)
        note = notes.get(key, "")
        if value is None:
            continue
        if bill is None:
            table.append([key, "", f"{value:.3f}", "", "", note])
            continue
        diff = value - bill
        pct = diff / bill * 100 if bill else 0
        table.append([key, f"{bill:.3f}", f"{value:.3f}", f"{diff:.3f}", f"{pct:.1f}", note])
    with path.open("w", newline="", encoding="utf-8") as handle:
        csv.writer(handle).writerows(table)
    return [",".join(row) for row in table]
