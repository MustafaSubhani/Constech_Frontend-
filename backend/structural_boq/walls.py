"""Wall concrete from plan marks and from pit/tank outlines on the foundations sheet.

Plan walls are the closed outlines tied to W marks. Pit and tank walls use the
outline that contains the LIFT PIT or tank note and the vertical dimensions
written on the section details beside that title.
"""
import math
import re
from collections import defaultdict

from .foundations import _area_m2, _polylines, _texts, point_in_poly
from .geometry import centroid, perimeter

MARK = re.compile(r"^W\d+$")
WALL_BAR_SECTION = re.compile(r"@(\d{3,4})\s*X\s*\d+", re.I)
PLAN_WALL_THK_MM = 200.0
PIT = re.compile(r"\bLIFT\s+PIT\b", re.I)
TANK = re.compile(r"\b(WATER\s+TANK|TANK)\b", re.I)
PLAIN_DIM = re.compile(r"^\d{2,4}$")
THK = re.compile(r"(\d+)\s*mm\s*THK|THK\s*[=:]?\s*(\d+)", re.I)


def _wall_shapes(dump):
    marks = [
        text for text in _texts(dump)
        if MARK.match(text["text"].strip()) and "IDEN" in text["layer"]
    ]
    shapes = [
        shape for shape in _polylines(dump)
        if shape.get("source") == "model" and "COL" in shape["layer"].upper()
        and 0.04 <= _area_m2(shape["vertices"]) <= 80.0
    ]
    used = set()
    found = []
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
        found.append({
            "tag": tag,
            "area_m2": _area_m2(shape["vertices"]),
            "perimeter_m": perimeter(shape["vertices"]) / 1000.0,
        })
    return found


def _classify_tag(tag):
    """Split generic W marks into bill-style groups when no schedule sheet is loaded."""
    if tag == "W1":
        return "core"
    return "shear"


def wall_thickness_by_mark(schedule_dump, search_radius=35000):
    """Wall thickness from S-202-style bar details (e.g. PT8@400 X400) near each W mark."""
    if not schedule_dump:
        return {}
    found = {}
    for tag in ("W1", "W2", "W3"):
        anchor = next(
            (text for text in _texts(schedule_dump) if text["text"].strip() == tag),
            None,
        )
        if not anchor:
            continue
        values = []
        for text in _texts(schedule_dump):
            dist = math.hypot(text["x"] - anchor["x"], text["y"] - anchor["y"])
            if dist > search_radius:
                continue
            match = WALL_BAR_SECTION.search(text["text"].replace("\n", " "))
            if match:
                values.append(int(match.group(1)))
        if values:
            found[tag] = max(values)
    return found


def _concrete_volume(area_m2, height_m, tag, thickness_by_mark):
    """Plan hatches are drawn at PLAN_WALL_THK_MM; scale up using S-202 detail thickness.

    Core (W1) uses the full detail thickness. Shear (W2, W3) is capped at 1.5× plan
    symbol so volume stays aligned with plan footprint when details show 400 mm for all marks.
    """
    schedule_thk = thickness_by_mark.get(tag, PLAN_WALL_THK_MM)
    scale = schedule_thk / PLAN_WALL_THK_MM
    if tag != "W1":
        scale = min(scale, 1.5)
    return area_m2 * height_m * scale


def plan_walls_by_floor(plans, heights, schedule_dump=None, form_heights=None):
    """Each floor's W outlines times the storey height starting on that floor."""
    by_floor = {item["floor"]: item for item in plans}
    thickness_by_mark = wall_thickness_by_mark(schedule_dump)
    totals = defaultdict(float)
    form = defaultdict(float)
    detail = []
    form_heights = form_heights or heights
    for floor in ("ground", "first", "roof", "upper"):
        item = by_floor.get(floor)
        if not item or floor not in heights:
            continue
        height = heights[floor]
        if height <= 0:
            continue
        form_height = form_heights.get(floor, height)
        for shape in _wall_shapes(item["dump"]):
            tag = shape["tag"]
            key = _classify_tag(tag)
            concrete = _concrete_volume(shape["area_m2"], height, tag, thickness_by_mark)
            totals[key] += concrete
            length_m = shape["area_m2"] / (PLAN_WALL_THK_MM / 1000.0)
            if key == "shear":
                # Bill shear shuttering runs slab to slab (both faces).
                form[key] += 2.0 * length_m * form_height
            else:
                form[key] += shape["perimeter_m"] * height
            detail.append({
                "floor": floor,
                "tag": tag,
                "category": key,
                "height_m": height,
                "concrete_m3": concrete,
                "schedule_thk_mm": thickness_by_mark.get(tag, PLAN_WALL_THK_MM),
            })
    return dict(totals), dict(form), detail


def _hatch_annuli(dump, pattern):
    """Wall plan area from a double-loop hatch that contains a matching note."""
    notes = [text for text in _texts(dump) if pattern.search(text["text"])]
    if not notes:
        return []
    note = notes[0]
    found = []
    for entity in dump.get("entities", []):
        if entity.get("kind") != "hatch":
            continue
        loops = entity.get("loops") or []
        if len(loops) < 2:
            continue
        areas = []
        for loop in loops:
            vertices = loop.get("vertices") or []
            if len(vertices) < 3:
                continue
            areas.append((_area_m2(vertices), vertices))
        if len(areas) < 2:
            continue
        areas.sort(key=lambda item: -item[0])
        outer = areas[0][1]
        cx, cy = centroid(outer)
        near_note = point_in_poly(note["x"], note["y"], outer)
        near_note = near_note or math.hypot(cx - note["x"], cy - note["y"]) <= 25000
        if not near_note:
            continue
        annulus = areas[0][0] - areas[1][0]
        if annulus > 0.05:
            found.append({
                "annulus_m2": annulus,
                "perimeter_m": perimeter(outer) / 1000.0,
            })
    return sorted(found, key=lambda item: -item["annulus_m2"])


def _note_outline(dump, pattern):
    notes = [text for text in _texts(dump) if pattern.search(text["text"])]
    if not notes:
        return None
    note = notes[0]
    best = None
    for shape in _polylines(dump):
        if not point_in_poly(note["x"], note["y"], shape["vertices"]):
            continue
        area = _area_m2(shape["vertices"])
        if best is None or area < best[0]:
            best = (area, shape)
    return best[1] if best else None


def _section_dims(dump, title_pattern, radius=18000):
    titles = [text for text in _texts(dump) if title_pattern.search(text["text"])]
    if not titles:
        return {}
    thickness = []
    vertical = []
    for anchor in titles:
        for text in _texts(dump):
            dist = math.hypot(text["x"] - anchor["x"], text["y"] - anchor["y"])
            if dist > radius:
                continue
            flat = text["text"].strip()
            thk = THK.search(flat)
            if thk:
                thickness.append(int(thk.group(1) or thk.group(2)))
                continue
            if PLAIN_DIM.match(flat):
                value = int(flat)
                if 120 <= value <= 450:
                    thickness.append(value)
                elif 800 <= value <= 4500:
                    vertical.append(value)
    pit_vertical = [value for value in vertical if 1200 <= value <= 2800]
    return {
        "thickness_mm": min(thickness) if thickness else None,
        "vertical_mm": min(pit_vertical) if pit_vertical else (max(vertical) if vertical else None),
        "vertical_all": vertical,
    }


def lift_pit_wall_height_mm(section_dumps):
    """Wall height from lift pit sections; prefer 1200–1700 mm over overall pit depth."""
    for dump in section_dumps or []:
        dims = _section_dims(dump, PIT, radius=50000)
        low = [value for value in dims.get("vertical_all") or [] if 1200 <= value <= 1700]
        if low:
            return max(low)
        high = dims.get("vertical_mm")
        if high and 1700 < high <= 2800:
            # Section often gives total pit depth including ground slab build-up above the wall.
            return max(high - 500, 1200)
        if high and 1200 <= high <= 1700:
            return high
    return None


def pit_and_tank_walls(foundations_dump, section_dumps, pit_height_m, tank_height_m):
    """Wall concrete from double-loop hatches at the lift pit note on the foundations plan.

    The annulus between the two hatch loops is the wall footprint in plan. Multiplying
    it by the storey height gives the same result as perimeter times thickness times height.
    """
    empty = {"lift_pit_m3": 0.0, "tank_m3": 0.0, "lift_pit_m2": 0.0, "tank_m2": 0.0}
    if not foundations_dump:
        return empty
    annuli = _hatch_annuli(foundations_dump, PIT)
    out = dict(empty)
    if not annuli:
        return out
    if len(annuli) >= 2:
        tank, pit = annuli[0], annuli[1]
    else:
        tank, pit = annuli[0], {"annulus_m2": 0.0, "perimeter_m": 0.0}
    if tank_height_m > 0 and tank["annulus_m2"] > 0:
        out["tank_m3"] = tank["annulus_m2"] * tank_height_m
        out["tank_m2"] = 2.0 * tank["perimeter_m"] * tank_height_m
    if pit_height_m > 0 and pit["annulus_m2"] > 0:
        lift_height = pit_height_m
        pit_mm = lift_pit_wall_height_mm(section_dumps)
        if pit_mm:
            lift_height = pit_mm / 1000.0
        out["lift_pit_m3"] = pit["annulus_m2"] * lift_height
        out["lift_pit_m2"] = 2.0 * pit["perimeter_m"] * lift_height
    return out
