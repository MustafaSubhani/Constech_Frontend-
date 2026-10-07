"""Map the updated structural_boq engine outputs to the Constech takeoff frontend schema."""
import json
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from .bill_lines import apply_bill_adjustments, load_bill_adjustments, trace_for_bill_line
from .measurements import append_manual, project_measurements
from .workspace import LABELS, _compare_rows, _digits, _ensure_manifest, _sheet_title, _unit, build_catalog

DEFAULT_CANVAS = (1100, 760)
_SHEET_CODE = re.compile(r"(S-\d{3}(?:-[A-Z0-9]+)?)", re.I)


def _section_for_key(key):
    if any(part in key for part in ("footing", "raft", "blinding", "neck")):
        return "Foundations"
    if any(
        part in key
        for part in ("wall", "shear", "core", "lift_pit", "tank", "upstand", "boundary_beam")
    ):
        return "Walls"
    return "Frame"


def _sheet_code(stem):
    match = _SHEET_CODE.search(stem)
    return match.group(1).upper() if match else stem[:16]


def _friendly_updated(out_dir):
    if not out_dir.is_dir():
        return "Not measured"
    latest = 0.0
    for path in out_dir.glob("*"):
        if path.is_file():
            latest = max(latest, path.stat().st_mtime)
    if not latest:
        return "Not measured"
    return datetime.fromtimestamp(latest).strftime("%d %b %Y")


def _runs(out_dir):
    return {
        "discover": (out_dir / "project-manifest.json").is_file(),
        "foundations": (out_dir / "foundations-compare.csv").is_file(),
        "structure": (out_dir / "structure-compare.csv").is_file(),
    }


def _measurement_shape_index(catalog_by_id):
    """Map measurement_id → canvas shape for bill-line placement highlights."""
    index = {}
    for sheet_id, sheet in (catalog_by_id or {}).items():
        code = _sheet_code(sheet_id)
        for shape in sheet.get("shapes") or []:
            mid = shape.get("measurement_id")
            if not mid:
                continue
            index[mid] = {
                "shapeId": shape.get("id") or "",
                "sheetId": sheet_id,
                "sheetCode": code,
                "kind": shape.get("kind") or "",
                "label": shape.get("label") or "",
            }
    return index


def _comparison_rows(project_dir, manifest=None, shape_index=None):
    out_dir = Path(project_dir) / "out"
    rows, _three = _compare_rows(out_dir)
    manifest = manifest or {}
    shape_index = shape_index or {}
    result = []
    for index, row in enumerate(rows):
        key = row.get("key") or f"line-{index}"
        note = row.get("note") or ""
        trace = trace_for_bill_line(project_dir, manifest, key, note, shape_index)
        result.append({
            "id": key,
            "section": _section_for_key(key),
            "label": row.get("label") or LABELS.get(key, key.replace("_", " ")),
            "unit": row.get("unit") or _unit(key),
            "digits": row.get("digits") if row.get("digits") is not None else _digits(key),
            "bill": row.get("bill"),
            "ours": row.get("ours"),
            "engineOurs": row.get("ours"),
            "note": note,
            "formula": trace.get("formula") or note,
            "sources": trace.get("sources") or [],
            "inputs": trace.get("inputs") or {},
            "placements": trace.get("placements") or [],
            "adjusted": False,
        })
    return apply_bill_adjustments(result, load_bill_adjustments(project_dir))


def _adapt_shapes(catalog_shapes):
    adapted = []
    for shape in catalog_shapes or []:
        entry = {
            "id": shape.get("id") or "",
            "kind": shape.get("kind") or "footing",
            "label": shape.get("label") or "",
            "points": shape.get("points") or [],
        }
        if shape.get("dashed"):
            entry["dashed"] = True
        if shape.get("measurement_id"):
            entry["measurementId"] = shape["measurement_id"]
        adapted.append(entry)
    return adapted


def _adapt_measurements(records):
    rows = []
    for record in records or []:
        rows.append({
            "id": record.get("id") or "",
            "elementType": record.get("element_type") or "",
            "tag": record.get("tag") or "",
            "sheet": record.get("sheet") or "",
            "status": record.get("status") or "",
            "confidence": record.get("confidence") or "",
            "quantities": record.get("quantities") or {},
            "formula": record.get("formula") or "",
            "inputs": record.get("inputs") or {},
            "sources": record.get("sources") or [],
            "note": record.get("note") or "",
            "adjustmentReason": record.get("adjustment_reason") or "",
        })
    return rows


def _adapt_review_queue(items):
    rows = []
    for item in items or []:
        rows.append({
            "id": item.get("id") or "",
            "kind": item.get("kind") or "",
            "severity": item.get("severity") or "info",
            "sheet": item.get("sheet") or "",
            "tag": item.get("tag") or "",
            "message": item.get("message") or "",
            "measurementId": item.get("measurement_id") or "",
        })
    return rows


def _adapt_sheet(manifest_entry, catalog_sheet=None, *, project_id="", png_dir=None):
    stem = manifest_entry.get("stem") or manifest_entry.get("file", "").replace(".dwg", "")
    width = DEFAULT_CANVAS[0]
    height = DEFAULT_CANVAS[1]
    shapes = []
    image = ""
    if catalog_sheet:
        width = int(catalog_sheet.get("width") or width)
        height = int(catalog_sheet.get("height") or height)
        shapes = _adapt_shapes(catalog_sheet.get("shapes"))
    if project_id and (catalog_sheet or shapes):
        image = f"/api/projects/{quote(project_id)}/sheets/{quote(stem + '.png')}"
    elif project_id and png_dir:
        png = Path(png_dir) / f"{stem}.png"
        if png.is_file():
            image = f"/api/projects/{quote(project_id)}/sheets/{quote(stem + '.png')}"
    role = (manifest_entry.get("role") or "other").replace("_", " ")
    return {
        "id": stem,
        "code": _sheet_code(stem),
        "title": manifest_entry.get("title") or _sheet_title(stem),
        "role": role.title() if role != "other" else "Drawing",
        "floor": manifest_entry.get("floor") or "",
        "signals": manifest_entry.get("signals") or [],
        "width": width,
        "height": height,
        "frame": None,
        "guides": [],
        "openings": [],
        "shapes": shapes,
        "image": image,
    }


def discover_project_dirs(work_root):
    work_root = Path(work_root)
    if not work_root.is_dir():
        return []
    found = []
    for path in sorted(work_root.iterdir()):
        if not path.is_dir() or path.name.startswith("."):
            continue
        if path.name in {"out", "node_modules"}:
            continue
        has_dwg = (path / "dwg").is_dir() or any(path.rglob("*.dwg"))
        if has_dwg:
            found.append(path)
    return found


def project_slug(project_dir):
    return Path(project_dir).name


def build_project_payload(project_dir, *, include_catalog=True):
    """Full project document for the takeoff UI."""
    project_dir = Path(project_dir).resolve()
    out_dir = project_dir / "out"
    manifest_path = out_dir / "project-manifest.json"
    manifest = {}
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    slug = project_slug(project_dir)
    png_dir = out_dir / "workspace"
    catalog_by_id = {}
    shape_index = {}
    if include_catalog:
        try:
            catalog = build_catalog(project_dir)
            catalog_by_id = {sheet["id"]: sheet for sheet in catalog.get("sheets") or []}
            shape_index = _measurement_shape_index(catalog_by_id)
        except Exception as exc:
            print(f"  catalog warning for {project_dir.name}: {exc}", flush=True)

    sheets = []
    for entry in manifest.get("sheets") or []:
        stem = entry.get("stem")
        if not stem:
            continue
        sheets.append(_adapt_sheet(entry, catalog_by_id.get(stem), project_id=slug, png_dir=png_dir))

    if not sheets and include_catalog:
        for stem, catalog_sheet in catalog_by_id.items():
            sheets.append(_adapt_sheet(
                {"stem": stem, "role": "other", "signals": []},
                catalog_sheet,
                project_id=slug,
                png_dir=png_dir,
            ))

    capabilities = [
        {
            "id": cap.get("id", ""),
            "status": cap.get("status", "partial"),
            "reason": cap.get("reason", ""),
        }
        for cap in manifest.get("capabilities") or []
    ]

    measurements, review_queue = project_measurements(project_dir)

    display = project_dir.name.replace("-", " ").title()
    return {
        "id": project_slug(project_dir),
        "name": manifest.get("project") or display,
        "place": manifest.get("place") or "UAE",
        "bill": manifest.get("bill_workbook") or "",
        "updated": _friendly_updated(out_dir),
        "sample": False,
        "runs": _runs(out_dir),
        "capabilities": capabilities,
        "sheets": sheets,
        "comparison": _comparison_rows(project_dir, manifest, shape_index),
        "measurements": _adapt_measurements(measurements),
        "reviewQueue": _adapt_review_queue(review_queue),
        "_path": str(project_dir),
    }


def project_summary(payload):
    rows = payload.get("comparison") or []
    bands = {"close": 0, "near": 0, "far": 0}
    for row in rows:
        bill, ours = row.get("bill"), row.get("ours")
        if bill is None or ours is None or not bill:
            continue
        pct = abs((ours - bill) / bill * 100)
        if pct <= 5:
            bands["close"] += 1
        elif pct <= 15:
            bands["near"] += 1
        else:
            bands["far"] += 1
    measured = sum(
        1 for sheet in payload.get("sheets") or []
        if sheet.get("shapes")
    )
    public = {k: v for k, v in payload.items() if not k.startswith("_")}
    return {
        **{k: public[k] for k in ("id", "name", "place", "bill", "updated", "runs", "capabilities") if k in public},
        "drawings": len(payload.get("sheets") or []),
        "measuredSheets": measured,
        "close": bands["close"],
        "near": bands["near"],
        "far": bands["far"],
        "compared": len(rows),
    }
