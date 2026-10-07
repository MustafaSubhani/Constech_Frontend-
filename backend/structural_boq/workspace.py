"""Local workspace: the sheet in the middle, detected outlines on top of it.

Same arrangement as a takeoff canvas. Quantities stay in a side list.
The drawing is the PDF. The outlines are the closed shapes from the DWG,
placed with the shared-label fit.
"""
import csv
import json
import math
import re
import struct
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import pymupdf

from collections import defaultdict

from .foundations import (
    _area_m2, _axis_fit, _fit_pdf, _measure_sheet, _row_points, _texts, point_in_poly,
)
from .geometry import centroid
from .discovery import build_manifest
from .measurements import (
    FIT_RESIDUAL_OK_PT,
    append_manual,
    load_manual,
    load_measurement_bundle,
    merge_manual_measurements,
)
from .structure import _grade_beams, _slab_regions
from .workspace_page import PAGE

ZOOM = 1.35


def _rasterize_page(page, zoom=ZOOM):
    """Render page to a pixmap; returned width/height are the canonical canvas size."""
    return page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)


def _read_png_size(path):
    """Width/height from PNG header (matches saved pixmap pixels)."""
    with Path(path).open("rb") as handle:
        handle.seek(16)
        return struct.unpack(">II", handle.read(8))


def _ensure_sheet_raster(page, image_path, pdf_mtime):
    """Write or reuse workspace PNG; return pixel width and height."""
    image_path = Path(image_path)
    stale = not image_path.is_file() or image_path.stat().st_mtime < pdf_mtime
    if stale:
        pix = _rasterize_page(page)
        pix.save(image_path)
        return pix.width, pix.height
    return _read_png_size(image_path)


LABELS = {
    "blinding_m3": "Blinding, 50 mm",
    "raft_m3": "Raft concrete",
    "footing_m3": "Footing concrete",
    "raft_kg": "Raft reinforcement",
    "footing_kg": "Footing reinforcement",
    "raft_m2": "Raft formwork",
    "footing_m2": "Footing formwork",
    "neck_m3": "Column necks",
    "neck_kg": "Column neck steel",
    "neck_m2": "Column neck formwork",
    "grade_beam_m3": "Grade beams",
    "grade_beam_m2": "Grade beam formwork",
    "boundary_beam_m3": "Boundary wall beams",
    "boundary_beam_m2": "Boundary wall beam formwork",
    "sog_m3": "Slab on grade",
    "sog_kg": "Slab on grade steel",
    "sog_m2": "Slab on grade area",
    "column_m3": "Columns",
    "column_m2": "Column formwork",
    "suspended_m3": "Suspended slabs",
    "suspended_kg": "Suspended slab steel",
    "suspended_m2": "Suspended slab sides and soffit",
    "beam_m3": "Beams",
    "beam_m2": "Beam sides and soffit",
    "wall_m3": "All plan wall outlines",
    "shear_wall_m3": "Shear walls (W2, W3)",
    "core_wall_m3": "Core walls (W1)",
    "lift_pit_wall_m3": "Lift pit walls",
    "tank_wall_m3": "Tank walls",
    "upstand_m3": "RC upstands",
    "upstand_m2": "Upstand formwork",
    "shear_wall_m2": "Shear wall formwork",
    "core_wall_m2": "Core wall formwork",
    "lift_pit_wall_m2": "Lift pit wall formwork",
    "tank_wall_m2": "Tank wall formwork",
}

KIND_COLOR = {
    "footing": "#c2410c",
    "missed": "#b91c1c",
    "raft": "#c2410c",
    "column": "#1d4ed8",
    "wall": "#0f766e",
    "slab": "#b45309",
    "beam": "#6d28d9",
}


def _unit(key):
    if key.endswith("_kg"):
        return "kg"
    if key.endswith("_m2"):
        return "m²"
    if key.endswith("_m3"):
        return "m³"
    return ""


def _digits(key):
    return 1 if key.endswith("_kg") else 2


def _num(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _read_csv(path):
    if not path.is_file():
        return []
    rows = []
    with path.open(encoding="utf-8", newline="") as handle:
        for record in csv.DictReader(handle):
            key = (record.get("item") or "").strip()
            if not key:
                continue
            row = {
                "key": key,
                "label": LABELS.get(key, key.replace("_", " ")),
                "unit": _unit(key),
                "digits": _digits(key),
                "bill": _num(record.get("bill")),
                "ours": _num(record.get("ours")),
                "difference": _num(record.get("difference") or record.get("diff_bill")),
                "pct": _num(record.get("pct") or record.get("pct_bill")),
                "note": record.get("note") or record.get("reason") or "",
            }
            if "courtyard" in record:
                row["courtyard"] = _num(record.get("courtyard"))
                row["diff_courtyard"] = _num(record.get("diff_courtyard"))
                row["pct_courtyard"] = _num(record.get("pct_courtyard"))
            rows.append(row)
    return rows


def _compare_rows(out):
    full = out / "full-structural-compare.csv"
    if full.is_file():
        rows = _read_csv(full)
        if rows:
            return rows, True
    foundations = _read_csv(out / "foundations-compare.csv")
    structure = _read_csv(out / "structure-compare.csv")
    return foundations + structure, False


def _find_pdf(project, stem):
    pdf_dir = project / "pdf"
    if pdf_dir.is_dir():
        for path in pdf_dir.glob("*.pdf"):
            if path.stem == stem:
                return path
    cache = project / "out" / "workspace" / "pdf"
    cached = cache / f"{stem}.pdf"
    if cached.is_file():
        return cached
    parents = [project.parent, project.parent.parent]
    zip_paths = []
    for folder in parents:
        if folder and folder.is_dir():
            zip_paths.extend(folder.glob("*.zip"))
    for zip_path in zip_paths:
        try:
            archive = zipfile.ZipFile(zip_path)
        except zipfile.BadZipFile:
            continue
        for name in archive.namelist():
            if not name.lower().endswith(".pdf"):
                continue
            if Path(name).stem == stem:
                cache.mkdir(parents=True, exist_ok=True)
                cached.write_bytes(archive.read(name))
                return cached
    return None


def ensure_sheet_png(project, stem):
    """Rasterize the sheet PDF to out/workspace/{stem}.png if needed."""
    project = Path(project)
    stem = str(stem)
    cache = project / "out" / "workspace"
    cache.mkdir(parents=True, exist_ok=True)
    image = cache / f"{stem}.png"
    pdf = _find_pdf(project, stem)
    if pdf is None:
        return None
    if not image.is_file() or image.stat().st_mtime < pdf.stat().st_mtime:
        doc = pymupdf.open(pdf)
        page = doc[0]
        _ensure_sheet_raster(page, image, pdf.stat().st_mtime)
        doc.close()
    return image if image.is_file() else None


def _fit_cloud(page, dump):
    """Match a repeated word by its spread when the copies are not on one row."""
    dwg_by_text = defaultdict(list)
    for text in _texts(dump):
        for token in text["text"].replace("\n", " ").split():
            token = token.strip()
            if 1 <= len(token) <= 12:
                dwg_by_text[token].append((text["x"], text["y"]))
    pdf_by_text = defaultdict(list)
    for word in page.get_text("words"):
        token = word[4].strip()
        if 1 <= len(token) <= 12:
            pdf_by_text[token].append(((word[0] + word[2]) / 2, (word[1] + word[3]) / 2))
    best = None
    for token, dwg in dwg_by_text.items():
        pdf = pdf_by_text.get(token) or []
        if len(dwg) < 3 or len(dwg) != len(pdf):
            continue
        dx0, dx1 = min(p[0] for p in dwg), max(p[0] for p in dwg)
        if dx1 - dx0 < 50:
            continue
        px0, px1 = min(p[0] for p in pdf), max(p[0] for p in pdf)
        ax = (px1 - px0) / (dx1 - dx0)
        if not 0.015 <= abs(ax) <= 0.06:
            continue
        ay = -ax
        dwg_cx = sum(p[0] for p in dwg) / len(dwg)
        dwg_cy = sum(p[1] for p in dwg) / len(dwg)
        pdf_cx = sum(p[0] for p in pdf) / len(pdf)
        pdf_cy = sum(p[1] for p in pdf) / len(pdf)
        bx = pdf_cx - ax * dwg_cx
        by = pdf_cy - ay * dwg_cy
        distances = []
        for x, y in dwg:
            qx, qy = ax * x + bx, ay * y + by
            distances.append(min(((qx - px) ** 2 + (qy - py) ** 2) ** 0.5 for px, py in pdf))
        distances.sort()
        residual = distances[len(distances) // 2]
        if residual > 4:
            continue
        if best is None or residual < best[0]:
            best = (residual, ax, bx, ay, by, residual, token)
    if not best:
        return None
    return best[1:]


def _fit_sheet(page, dump):
    """Line the DWG up with the PDF.

    Whole labels are tried first. If the PDF has split a label into words,
    those words are matched too. A fit is kept only when the row lines up.
    """
    direct = _fit_pdf(page, dump)
    if direct and direct[4] < 8:
        return direct
    dwg_by_text = defaultdict(list)
    for text in _texts(dump):
        for token in text["text"].replace("\n", " ").split():
            token = token.strip()
            if 1 <= len(token) <= 12:
                dwg_by_text[token].append((text["x"], text["y"]))
    pdf_by_text = defaultdict(list)
    for word in page.get_text("words"):
        token = word[4].strip()
        if 1 <= len(token) <= 12:
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
        ax, bx = _axis_fit([p[0] for p in dwg_row[:n]], [p[0] for p in pdf_row[:n]])
        if abs(ax) < 1e-9:
            continue
        ay = -ax
        by = pdf_row[0][1] - ay * dwg_row[0][1]
        residual = max(abs(ax * dwg_row[i][0] + bx - pdf_row[i][0]) for i in range(n))
        if residual > 8:
            continue
        if best is None or span > best[0]:
            best = (span, ax, bx, ay, by, residual, token)
    if best:
        return best[1:]
    return _fit_cloud(page, dump) or direct


def _points(vertices, fit, zoom):
    ax, bx, ay, by = fit[:4]
    return [[round((ax * x + bx) * zoom, 1), round((ay * y + by) * zoom, 1)] for x, y in vertices]


def _union_box(boxes):
    boxes = [b for b in boxes if b]
    if not boxes:
        return None
    return (
        min(b[0] for b in boxes), min(b[1] for b in boxes),
        max(b[2] for b in boxes), max(b[3] for b in boxes),
    )


class _Locator:
    """Places evidence on the sheet raster.

    DWG text anchors are alignment points, so a box built from text height alone
    drifts. Each text is mapped through the fit and snapped to the PDF words with
    the same text nearest to it; the PDF word boxes are exact.
    """

    def __init__(self, fit, words, zoom, snap_pt=14.0):
        self.fit = fit
        self.zoom = zoom
        self.snap_pt = snap_pt
        self.words = [(w[0], w[1], w[2], w[3], w[4].strip()) for w in words or []]
        self.by_token = defaultdict(list)
        for w in self.words:
            self.by_token[w[4]].append(w[:4])

    def table_row(self, tag, row_text, pad=3.0):
        """A schedule row found in the PDF itself.

        Schedules are often placed elsewhere on the printed sheet than in model space,
        so the plan fit does not apply; the row is found by its tag and its own values.
        """
        wanted = [t for t in row_text.replace("\n", " ").split() if t.lower() != "x" and t != tag]
        if not wanted:
            return None
        best = None
        for x0, y0, x1, y1 in self.by_token.get(tag, ()):
            cy = (y0 + y1) / 2
            tol = max((y1 - y0) * 0.6, 1.5)
            line = [w for w in self.words if abs((w[1] + w[3]) / 2 - cy) <= tol and x0 - 2 <= w[0] <= x0 + 1200]
            tokens = [w[4] for w in line]
            score = sum(1 for t in wanted if t in tokens)
            if best is None or score > best[0]:
                best = (score, (x0, y0, x1, y1), line)
        if not best or best[0] < max(2, len(wanted) // 2):
            return None
        keep = [best[1]] + [w[:4] for w in best[2] if w[4] in wanted or w[4].lower() == "x"]
        return self._canvas(_union_box(keep), pad)

    def _pdf_point(self, x, y):
        ax, bx, ay, by = self.fit[:4]
        return ax * x + bx, ay * y + by

    def _snap(self, text):
        px, py = self._pdf_point(text["x"], text["y"])
        tokens = [t for t in (text.get("text") or "").replace("\n", " ").split() if t]
        reach = self.snap_pt + abs(self.fit[0]) * float(text.get("height") or 200) * max(len(" ".join(tokens)), 1) * 0.7
        found = []
        for token in tokens:
            best = None
            for x0, y0, x1, y1 in self.by_token.get(token, ()):
                dx = max(x0 - px, 0, px - x1)
                dy = max(y0 - py, 0, py - y1)
                dist = (dx * dx + dy * dy) ** 0.5
                if dist <= reach and (best is None or dist < best[0]):
                    best = (dist, (x0, y0, x1, y1))
            if best:
                found.append(best[1])
        if found:
            return _union_box(found)
        half = abs(self.fit[0]) * float(text.get("height") or 200) / 2
        width = half * 1.25 * max(len(" ".join(tokens)), 1)
        return (px, py - half, px + width, py + half)

    def _canvas(self, box, pad):
        z = self.zoom
        return [round(box[0] * z - pad, 1), round(box[1] * z - pad, 1), round(box[2] * z + pad, 1), round(box[3] * z + pad, 1)]

    def texts(self, texts, pad=3.0):
        boxes = [self._snap(t) for t in texts if t]
        box = _union_box(boxes)
        return self._canvas(box, pad) if box else None

    def outline(self, vertices, pad=2.0):
        pts = [self._pdf_point(x, y) for x, y in vertices]
        box = (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))
        return self._canvas(box, pad)


def _evidence(role, label, canvas_box, text="", sheet="", allow_unplaced=False):
    """canvas_box may be None only when the text itself is still worth showing."""
    if not canvas_box and not allow_unplaced:
        return None
    return {"role": role, "label": label, "text": (text or "")[:160], "box": canvas_box, "sheetId": sheet}


def _schedule_rows(dump):
    """Footing schedule rows by tag: DWG box and the row's text, left to right."""
    from .foundations import _cluster_rows, _row_tag, _row_tolerance, _schedule_cells

    cells = _schedule_cells(dump)
    if not cells:
        return {}
    rows = {}
    for row in _cluster_rows(cells, _row_tolerance(cells)):
        row = sorted(row, key=lambda e: e["x"])
        tag = _row_tag(row)
        if not tag or tag in rows:
            continue
        rows[tag] = {
            "cells": row,
            "text": "  ".join(cell["text"].replace("\n", " ").strip() for cell in row),
            "ids": {id(cell) for cell in cells},
        }
    return rows


def _nearest_text(dump, point, predicate, limit=None):
    best = None
    for text in _texts(dump):
        if not predicate(text):
            continue
        dist = ((text["x"] - point[0]) ** 2 + (text["y"] - point[1]) ** 2) ** 0.5
        if limit is not None and dist > limit:
            continue
        if best is None or dist < best[0]:
            best = (dist, text)
    return best[1] if best else None


def _foundation_shapes(dump, fit, zoom, sheet_stem, loc=None):
    measured = _measure_sheet(dump)
    if not measured or not fit:
        return []
    if fit[4] > FIT_RESIDUAL_OK_PT:
        return []
    loc = loc or _Locator(fit, [], zoom)
    schedule_rows = _schedule_rows(dump)
    table_ids = next(iter(schedule_rows.values()))["ids"] if schedule_rows else set()
    shapes = []
    for index, row in enumerate(measured["rows"]):
        vertices = row.get("vertices") or []
        if len(vertices) < 3:
            continue
        missed = bool(row.get("missed"))
        tag = row.get("tag") or "Footing"
        label = "Missed" if missed else tag
        detail = row.get("concrete_m3")
        if detail != "" and detail is not None:
            label = f"{label}  {detail} m³"
        mid = f"footing-{sheet_stem}-{tag}-{index}"
        evidence = []
        sched = schedule_rows.get(tag) if not missed else None
        if sched:
            evidence.append(_evidence(
                "schedule", f"Footing schedule, row {tag}", loc.table_row(tag, sched["text"]), sched["text"], sheet_stem,
                allow_unplaced=True,
            ))
        if not missed:
            center = centroid(vertices)
            plan_tag = _nearest_text(
                dump, center, lambda t: t["text"].strip() == tag and id(t) not in table_ids, limit=6000,
            )
            if plan_tag:
                evidence.append(_evidence(
                    "plan_tag", f"Tag {tag} on the plan", loc.texts([plan_tag]), plan_tag["text"], sheet_stem,
                ))
        evidence.append(_evidence(
            "outline", "Plan outline", loc.outline(vertices),
            f"{row.get('width_mm', '')} x {row.get('height_mm', '')} mm", sheet_stem,
        ))
        shapes.append({
            "id": f"f{index}",
            "measurement_id": mid,
            "kind": "missed" if missed else "footing",
            "label": label,
            "points": _points(vertices, fit, zoom),
            "dashed": missed,
            "evidence": [e for e in evidence if e],
        })
    for index, raft in enumerate(measured["rafts"]):
        vertices = raft.get("vertices") or []
        if len(vertices) < 3:
            continue
        note = _nearest_text(
            dump, centroid(vertices),
            lambda t: "RAFT" in t["text"].upper() and point_in_poly(t["x"], t["y"], vertices),
        )
        evidence = [_evidence("outline", "Raft outline", loc.outline(vertices), "", sheet_stem)]
        if note:
            evidence.insert(0, _evidence(
                "note", "Raft thickness note", loc.texts([note]), note["text"], sheet_stem,
            ))
        shapes.append({
            "id": f"r{index}",
            "measurement_id": f"raft-{sheet_stem}-{index}",
            "kind": "raft",
            "label": f"Raft  {raft.get('thickness', '')} mm",
            "points": _points(vertices, fit, zoom),
            "dashed": True,
            "evidence": [e for e in evidence if e],
        })
    return shapes


def _plan_shapes(dump, fit, zoom, stem="", loc=None):
    if not fit:
        return []
    loc = loc or _Locator(fit, [], zoom)
    marks = [
        text for text in _texts(dump)
        if text["text"].strip() and len(text["text"].strip()) <= 6 and "IDEN" in text.get("layer", "")
    ]
    shapes = []
    index = 0
    for entity in dump.get("entities", []):
        if entity.get("kind") != "polyline" or not entity.get("closed"):
            continue
        if entity.get("source") != "model":
            continue
        vertices = entity.get("vertices") or []
        if len(vertices) < 3:
            continue
        layer = entity.get("layer", "").upper()
        area = _area_m2(vertices)
        kind = ""
        if "COL" in layer and 0.04 <= area <= 1.5:
            kind = "column"
        else:
            continue
        cx, cy = centroid(vertices)
        label = "Column"
        best = None
        if kind == "column":
            for mark in marks:
                token = mark["text"].strip()
                if not token[:1].isalpha():
                    continue
                dist = ((mark["x"] - cx) ** 2 + (mark["y"] - cy) ** 2) ** 0.5
                if best is None or dist < best[0]:
                    best = (dist, token, mark)
            if best and best[0] < 2000:
                label = best[1]
                if label.startswith("W"):
                    kind = "wall"
            label = f"{label}  {area:.2f} m²"
        tag_key = label.split()[0] if label else str(index)
        mid = f"columns-{stem}-{tag_key}" if kind == "column" else f"walls-{stem}-{tag_key}"
        evidence = []
        if best and best[0] < 2000:
            evidence.append(_evidence(
                "plan_tag", f"Mark {best[1]} on the plan", loc.texts([best[2]]), best[2]["text"], stem,
            ))
        evidence.append(_evidence(
            "outline", "Plan outline", loc.outline(vertices), f"{area:.2f} m² plan area", stem,
        ))
        shapes.append({
            "id": f"p{index}",
            "measurement_id": mid,
            "kind": kind,
            "label": label,
            "points": _points(vertices, fit, zoom),
            "dashed": False,
            "evidence": [e for e in evidence if e],
        })
        index += 1
    for region in _slab_regions(dump):
        vertices = region["vertices"]
        if _mentions(dump, vertices, "STEEL ROOF"):
            continue
        area = region["area_m2"]
        evidence = []
        for text in _texts(dump):
            upper = text["text"].upper()
            if "SLAB" in upper and "MM" in upper and point_in_poly(text["x"], text["y"], vertices):
                evidence.append(_evidence(
                    "note", "Slab thickness note", loc.texts([text]), text["text"], stem,
                ))
                if len(evidence) >= 3:
                    break
        evidence.append(_evidence(
            "outline", "Slab outline", loc.outline(vertices), f"{area:.1f} m²", stem,
        ))
        shapes.append({
            "id": f"s{index}",
            "measurement_id": f"slab-{stem}-{index}",
            "kind": "slab",
            "label": f"Slab {region['thickness']} mm  {area:.0f} m²",
            "points": _points(vertices, fit, zoom),
            "dashed": False,
            "evidence": [e for e in evidence if e],
        })
        index += 1
    beams = _grade_beams(dump, prefixes=("GB", "FB", "RB", "URB", "SB", "B"))
    for segment in beams.get("segments") or []:
        band = _beam_band(segment["a"], segment["b"], segment["width_mm"])
        mid_point = ((segment["a"][0] + segment["b"][0]) / 2, (segment["a"][1] + segment["b"][1]) / 2)
        size_token = f"{segment['width_mm']}X{segment['depth_mm']}"
        label_text = _nearest_text(
            dump, mid_point,
            lambda t, token=size_token: token in t["text"].upper().replace(" ", ""),
            limit=8000,
        )
        evidence = []
        if label_text:
            evidence.append(_evidence(
                "label", "Beam label with section size", loc.texts([label_text]), label_text["text"], stem,
            ))
        evidence.append(_evidence("outline", "Beam centre line", loc.outline(band), "", stem))
        shapes.append({
            "id": f"b{index}",
            "measurement_id": f"grade-beam-{stem}-{index}",
            "kind": "beam",
            "label": f"Beam {segment['width_mm']}×{segment['depth_mm']}",
            "points": _points(band, fit, zoom),
            "dashed": False,
            "evidence": [e for e in evidence if e],
        })
        index += 1
    return shapes


def _mentions(dump, vertices, needle):
    for text in _texts(dump):
        if needle not in text["text"].upper():
            continue
        if point_in_poly(text["x"], text["y"], vertices):
            return True
    return False


def _beam_band(start, end, width_mm):
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length = math.hypot(dx, dy) or 1.0
    offset = width_mm / 2.0
    px = -dy / length * offset
    py = dx / length * offset
    return [
        (start[0] + px, start[1] + py),
        (end[0] + px, end[1] + py),
        (end[0] - px, end[1] - py),
        (start[0] - px, start[1] - py),
    ]


def _sheet_title(stem):
    parts = stem.split("-")
    if parts and parts[0].isdigit():
        parts = parts[1:]
    head = "-".join(parts[:2])
    rest = " ".join(part.title() for part in parts[2:])
    return f"{head} {rest}".strip()


_FOUNDATION_ROLES = {"foundation_plan", "foundation_layout", "footing_schedule"}
_PLAN_ROLES = {"floor_plan", "framing_plan", "structural_plan"}


def _catalog_kind(entry):
    """'foundation', 'plan' or '' (not drawn) for a register entry."""
    role = entry.get("role") or ""
    signals = set(entry.get("signals") or [])
    if role in _FOUNDATION_ROLES:
        return "foundation"
    if role in _PLAN_ROLES:
        return "plan"
    if role in ("", "other"):
        upper = (entry.get("stem") or "").upper()
        if "footing_schedule_table" in signals or re.search(r"FOUNDATION|FOOTING", upper):
            return "foundation"
        from .sheets import floor_of

        if (signals & {"slab_thk_notes", "closed_slab_polylines"}) or (floor_of(upper) and re.search(r"PLAN|FRAMING", upper) and "REINF" not in upper):
            return "plan"
    return ""


def build_catalog(project, on_sheet=None):
    """Sheet rasters plus fitted outlines. on_sheet(index, total, stem) reports progress."""
    project = Path(project)
    out = project / "out"
    cache = out / "workspace"
    cache.mkdir(parents=True, exist_ok=True)
    sheets = []
    manifest_path = out / "project-manifest.json"
    manifest_sheets = {}
    if manifest_path.is_file():
        try:
            manifest_sheets = {
                s["stem"]: s for s in json.loads(manifest_path.read_text(encoding="utf-8")).get("sheets") or [] if s.get("stem")
            }
        except (json.JSONDecodeError, OSError, KeyError):
            manifest_sheets = {}
    todo = []
    if manifest_sheets:
        # The drawing register decides which sheets are measurable, not their file names.
        for stem, entry in sorted(manifest_sheets.items()):
            kind = _catalog_kind(entry)
            dump_path = out / f"{stem}.json"
            if not kind or not dump_path.is_file():
                continue
            pdf = _find_pdf(project, stem)
            if pdf is not None:
                todo.append((dump_path, stem, pdf, kind))
    else:
        for dump_path in sorted(p for p in out.glob("*.json") if not p.name.startswith("_")):
            stem = dump_path.stem
            kind = _catalog_kind({"stem": stem, "role": "", "signals": []})
            pdf = _find_pdf(project, stem) if kind else None
            if pdf is not None:
                todo.append((dump_path, stem, pdf, kind))
    for position, (dump_path, stem, pdf, kind) in enumerate(todo):
        if on_sheet:
            on_sheet(position, len(todo), stem)
        print(f"  sheet {stem}", flush=True)
        dump = json.loads(dump_path.read_text(encoding="utf-8"))
        doc = pymupdf.open(pdf)
        page = doc[0]
        fit = _fit_sheet(page, dump)
        image = cache / f"{stem}.png"
        width, height = _ensure_sheet_raster(page, image, pdf.stat().st_mtime)
        width, height = int(page.rect.width * ZOOM), int(page.rect.height * ZOOM)
        words = page.get_text("words")
        doc.close()
        fit_ok = fit is not None and fit[4] <= FIT_RESIDUAL_OK_PT
        fit_residual = round(fit[4], 2) if fit else None
        loc = _Locator(fit, words, ZOOM) if fit else None
        if kind == "foundation":
            shapes = _foundation_shapes(dump, fit, ZOOM, stem, loc) if fit_ok else []
        elif kind == "plan":
            shapes = _plan_shapes(dump, fit, ZOOM, stem, loc) if fit_ok else []
        else:
            shapes = []
        if not shapes and not fit_ok:
            continue
        if not shapes:
            continue
        for shape in shapes:
            shape["color"] = KIND_COLOR.get(shape["kind"], "#444")
        sheets.append({
            "id": stem,
            "title": _sheet_title(stem),
            "image": f"/sheets/{stem}.png",
            "width": width,
            "height": height,
            "fit_residual_pt": fit_residual,
            "fit_ok": fit_ok,
            "pdf": pdf.name,
            "shapes": shapes,
        })
    manifest_path = out / "project-manifest.json"
    manifest = {}
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    bundle = load_measurement_bundle(project)
    measurements = merge_manual_measurements(
        bundle.get("measurements") or [],
        load_manual(project),
    )
    return {
        "project": project.name,
        "sheets": sheets,
        "manifest": manifest,
        "measurements": measurements,
        "review_queue": bundle.get("review_queue") or [],
        "sheet_alignment": bundle.get("sheet_alignment") or [],
        "foundations": _read_csv(out / "foundations-compare.csv"),
        "structure": _read_csv(out / "structure-compare.csv"),
        **(_compare_bundle(out)),
    }


def _compare_bundle(out):
    rows, three_way = _compare_rows(out)
    return {
        "full_compare": rows,
        "compare_three_way": three_way,
    }


def _ensure_manifest(project):
    out = project / "out"
    manifest_path = out / "project-manifest.json"
    newest_dwg = 0.0
    skip = {"out", "node_modules", ".git"}
    for dwg in project.rglob("*.dwg"):
        if set(dwg.parts) & skip:
            continue
        newest_dwg = max(newest_dwg, dwg.stat().st_mtime)
    stale = not manifest_path.is_file() or manifest_path.stat().st_mtime < newest_dwg
    if stale:
        print("Updating drawing register (project-manifest.json)…", flush=True)
        build_manifest(project, dump_json=True)


def serve(project, port=8765):
    project = Path(project).resolve()
    _ensure_manifest(project)
    print("Building the sheet views…", flush=True)
    images = project / "out" / "workspace"
    initial = build_catalog(project)

    def catalog_payload():
        return json.dumps(build_catalog(project)).encode("utf-8")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            print(f"  {self.address_string()} {fmt % args}", flush=True)

        def _send(self, code, body, content_type):
            data = body if isinstance(body, bytes) else body.encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = unquote(urlparse(self.path).path)
            if path in ("/", "/index.html"):
                self._send(200, PAGE, "text/html; charset=utf-8")
                return
            if path == "/api/takeoff":
                self._send(200, catalog_payload(), "application/json")
                return
            if path.startswith("/sheets/") and path.endswith(".png"):
                image = images / Path(path).name
                if image.is_file():
                    self._send(200, image.read_bytes(), "image/png")
                    return
            self._send(404, "Not found", "text/plain; charset=utf-8")

        def do_POST(self):
            path = unquote(urlparse(self.path).path)
            if path != "/api/manual":
                self._send(404, "Not found", "text/plain; charset=utf-8")
                return
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            try:
                body = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError:
                self._send(400, '{"error":"invalid json"}', "application/json")
                return
            entry = append_manual(project, body)
            self._send(200, json.dumps({"ok": True, "entry": entry}), "application/json")

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    sheet_count = len(initial.get("sheets") or [])
    print(f"Workspace http://127.0.0.1:{port}/  {sheet_count} sheets", flush=True)
    server.serve_forever()
