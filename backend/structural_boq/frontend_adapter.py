"""Map the structural_boq engine outputs to the Constech takeoff frontend schema."""
import json
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from .bill_lines import (
    _load_adjustment_file,
    apply_bill_adjustments,
    measurement_deltas,
    trace_for_bill_line,
)
from .bill_source import baseline_for, selected_bill
from .floors import apply_floor_split
from .foundations import _find_bill
from .measurements import (
    apply_measurement_overrides,
    load_manual,
    load_measurement_bundle,
    load_measurement_overrides,
    merge_manual_measurements,
)
from .workspace import LABELS, _compare_rows, _digits, _sheet_title, _unit, build_catalog

DEFAULT_CANVAS = (1100, 760)
_SHEET_CODE = re.compile(r"(S-\d{3}(?:-[A-Z0-9]+)?)", re.I)
MANUAL_KIND = {
    "footing": "footing",
    "raft": "raft",
    "column_storey": "column",
    "column_neck": "column",
    "wall_storey": "wall",
    "suspended_slab": "slab",
    "slab_on_grade": "slab",
    "grade_beam": "beam",
    "beam": "beam",
    "other": "missed",
}


def _section_for_key(key):
    if any(part in key for part in ("footing", "raft", "blinding", "neck")):
        return "Foundations"
    if any(
        part in key
        for part in ("wall", "shear", "core", "lift_pit", "tank", "upstand", "boundary_beam")
    ):
        return "Walls"
    return "Frame"


SECTION_ORDER = ("Foundations", "Frame", "Walls")
_UNIT_WORD = {"m3": "concrete", "m2": "formwork", "kg": "reinforcement"}


def _label_for(key):
    if key in LABELS:
        return LABELS[key]
    base, _, unit = key.rpartition("_")
    if unit in _UNIT_WORD and base:
        return f"{base.replace('_', ' ').capitalize()} {_UNIT_WORD[unit]}"
    return key.replace("_", " ").capitalize()


def _sheet_code(stem):
    match = _SHEET_CODE.search(stem)
    return match.group(1).upper() if match else stem[:16]


def display_name(folder):
    """Readable name for a project folder; short vowel-less tokens (dd, rcc) and codes stay upper case."""
    words = []
    for word in re.split(r"[-_.\s]+", folder):
        if not word:
            continue
        if any(ch.isdigit() for ch in word) or (len(word) <= 4 and not re.search(r"[aeiouy]", word, re.I)):
            words.append(word.upper())
        else:
            words.append(word[:1].upper() + word[1:])
    return " ".join(words) or folder


def _friendly_updated(out_dir):
    if not out_dir.is_dir():
        return ""
    latest = 0.0
    for path in out_dir.glob("*"):
        if path.is_file():
            latest = max(latest, path.stat().st_mtime)
    if not latest:
        return ""
    return datetime.fromtimestamp(latest).isoformat(timespec="seconds")


def _runs(out_dir):
    return {
        "discover": (out_dir / "project-manifest.json").is_file(),
        "foundations": (out_dir / "foundations-compare.csv").is_file(),
        "structure": (out_dir / "structure-compare.csv").is_file(),
    }


def project_meta(project_dir):
    path = Path(project_dir) / "project.json"
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _shape_overrides(project_dir):
    path = Path(project_dir) / "out" / "shape-overrides.json"
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("shapes") or {}
    except (json.JSONDecodeError, OSError):
        return {}


def save_shape_override(project_dir, sheet_id, shape_id, patch):
    path = Path(project_dir) / "out" / "shape-overrides.json"
    shapes = _shape_overrides(project_dir)
    key = f"{sheet_id}::{shape_id}"
    if patch is None:
        shapes.pop(key, None)
    else:
        entry = dict(shapes.get(key) or {})
        if "points" in patch:
            points = patch["points"]
            if points is None:
                entry.pop("points", None)
            else:
                if not isinstance(points, list) or len(points) < 3:
                    raise ValueError("An outline needs at least three points")
                entry["points"] = [[round(float(x), 1), round(float(y), 1)] for x, y in points[:400]]
        if "hidden" in patch:
            entry["hidden"] = bool(patch["hidden"])
        shapes[key] = entry
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"shapes": shapes}, indent=2), encoding="utf-8")
    return shapes.get(key)


def _measurement_shape_index(catalog_by_id):
    """Map measurement_id to canvas shape for bill-line placement highlights."""
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


def _comparison_rows(project_dir, manifest, shape_index, raw_records, effective_records):
    project_dir = Path(project_dir)
    out_dir = project_dir / "out"
    rows, _three = _compare_rows(out_dir)
    selected_rel, selected_path = selected_bill(project_dir)
    engine_default = _find_bill(project_dir)
    use_engine_bill = selected_path is None or (
        engine_default is not None and selected_path.resolve() == engine_default.resolve()
    )
    baseline = {}
    if not use_engine_bill:
        try:
            baseline = baseline_for(project_dir, selected_path, [r.get("key") for r in rows])["values"]
        except Exception as exc:
            print(f"  bill read warning for {selected_rel}: {exc}", flush=True)
    deltas = measurement_deltas(raw_records, effective_records)
    result = []
    for index, row in enumerate(rows):
        key = row.get("key") or f"line-{index}"
        note = row.get("note") or ""
        trace = trace_for_bill_line(project_dir, manifest, key, note, shape_index, effective_records)
        engine_ours = row.get("ours")
        bill_value = row.get("bill") if use_engine_bill else baseline.get(key)
        if engine_ours is None and bill_value is None:
            continue
        ours = engine_ours
        delta = deltas.get(key)
        if delta and ours is not None:
            ours = round(ours + delta["delta"], 4)
        result.append({
            "id": key,
            "section": _section_for_key(key),
            "label": _label_for(key),
            "unit": row.get("unit") or _unit(key),
            "digits": row.get("digits") if row.get("digits") is not None else _digits(key),
            "bill": bill_value,
            "ours": ours,
            "engineOurs": engine_ours,
            "note": note,
            "formula": trace.get("formula") or note,
            "sources": trace.get("sources") or [],
            "inputs": trace.get("inputs") or {},
            "placements": trace.get("placements") or [],
            "measureDelta": delta,
            "adjusted": bool(delta),
        })
    order = {name: i for i, name in enumerate(SECTION_ORDER)}
    result.sort(key=lambda r: order.get(r["section"], len(order)))
    adjustments = _load_adjustment_file(project_dir)
    result = apply_bill_adjustments(result, adjustments.get("lines") or {})
    for line in adjustments.get("custom") or []:
        result.append({
            "id": line["id"],
            "section": line.get("section") or "Custom",
            "label": line.get("label") or "Custom line",
            "unit": line.get("unit") or "",
            "digits": 2,
            "bill": line.get("bill"),
            "ours": line.get("ours"),
            "engineOurs": None,
            "note": line.get("note") or "",
            "formula": line.get("expression") or line.get("note") or "",
            "expression": line.get("expression") or "",
            "variables": line.get("variables") or {},
            "sources": [{"role": "manual", "detail": "Line added by hand"}],
            "inputs": {},
            "placements": [],
            "custom": True,
            "floor": line.get("floor") or "",
            "adjusted": False,
        })
    hidden = set(adjustments.get("hidden") or [])
    for row in result:
        if row["id"] in hidden:
            row["hidden"] = True
    floors = apply_floor_split(result, effective_records)
    bill_source = {
        "file": selected_rel,
        "name": Path(selected_rel).name if selected_rel else "",
        "engineDefault": use_engine_bill,
        "matched": sum(1 for row in result if row.get("bill") is not None),
    }
    return result, bill_source, floors


def _adapt_shapes(catalog_shapes, sheet_id, overrides):
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
        if shape.get("evidence"):
            entry["evidence"] = shape["evidence"]
        patch = overrides.get(f"{sheet_id}::{entry['id']}")
        if patch:
            if patch.get("hidden"):
                entry["hidden"] = True
            if patch.get("points"):
                entry["enginePoints"] = entry["points"]
                entry["points"] = patch["points"]
                entry["edited"] = True
        adapted.append(entry)
    return adapted


def _manual_shapes(records, sheet_id):
    shapes = []
    for record in records:
        if not record.get("manual") or record.get("sheet") != sheet_id or not record.get("points"):
            continue
        shapes.append({
            "id": record["id"],
            "kind": MANUAL_KIND.get(record.get("element_type") or "", "missed"),
            "label": record.get("tag") or "Manual",
            "points": record["points"],
            "measurementId": record["id"],
            "manual": True,
        })
    return shapes


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
            "engineQuantities": record.get("engine_quantities") or None,
            "formula": record.get("formula") or "",
            "expressions": record.get("expressions") or {},
            "inputs": record.get("inputs") or {},
            "sources": record.get("sources") or [],
            "note": record.get("note") or "",
            "adjustmentReason": record.get("adjustment_reason") or "",
            "manual": bool(record.get("manual")),
        })
    return rows


_REVIEW_TAGS = {"MISSED": "Unlinked outline"}


def _resolve_measurement(mid, known):
    """Review items may name a whole mark (FC1) while records are per instance (FC1-0, FC1-1)."""
    if not mid or mid in known:
        return mid
    prefix = mid + "-"
    matches = sorted((k for k in known if k.startswith(prefix) and k[len(prefix):].isdigit()), key=lambda k: int(k[len(prefix):]))
    return matches[0] if matches else mid


def _link_missed(rows, sheets):
    """Point unlinked-outline review items at their outlines. Both come from the same measured rows in
    the same order, so the n-th item on a sheet is the n-th missed outline; only paired when counts agree."""
    outlines = {
        sheet.get("id"): [shape.get("measurementId") for shape in sheet.get("shapes") or [] if shape.get("kind") == "missed"]
        for sheet in sheets
    }
    pending = {}
    for row in rows:
        if row["kind"] == "missed_outline" and not row["measurementId"]:
            pending.setdefault(row["sheet"], []).append(row)
    for sheet_id, items in pending.items():
        ids = outlines.get(sheet_id) or []
        if len(ids) == len(items):
            for row, mid in zip(items, ids):
                row["measurementId"] = mid or ""
    return rows


def _adapt_review_queue(items, known=frozenset()):
    rows = []
    for item in items or []:
        tag = item.get("tag") or ""
        message = item.get("message") or ""
        # Engine messages sometimes repeat their tag as a prefix ("missed: ..."); show it once.
        if tag and message.lower().startswith(tag.lower() + ":"):
            message = message[len(tag) + 1:].strip()
            message = message[:1].upper() + message[1:]
        rows.append({
            "id": item.get("id") or "",
            "kind": item.get("kind") or "",
            "severity": item.get("severity") or "info",
            "sheet": item.get("sheet") or "",
            "tag": _REVIEW_TAGS.get(tag, tag),
            "message": message,
            "measurementId": _resolve_measurement(item.get("measurement_id") or "", known),
        })
    return rows


def _adapt_sheet(manifest_entry, catalog_sheet=None, *, project_id="", png_dir=None, overrides=None, records=()):
    stem = manifest_entry.get("stem") or manifest_entry.get("file", "").replace(".dwg", "")
    width = DEFAULT_CANVAS[0]
    height = DEFAULT_CANVAS[1]
    shapes = []
    image = ""
    if catalog_sheet:
        width = int(catalog_sheet.get("width") or width)
        height = int(catalog_sheet.get("height") or height)
        shapes = _adapt_shapes(catalog_sheet.get("shapes"), stem, overrides or {})
        shapes.extend(_manual_shapes(records, stem))
    if project_id and catalog_sheet:
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
        "file": manifest_entry.get("file") or "",
        "pdf": (catalog_sheet or {}).get("pdf") or "",
        "fitOk": (catalog_sheet or {}).get("fit_ok"),
        "width": width,
        "height": height,
        "measurable": bool(catalog_sheet),
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
        if has_dwg or (path / "project.json").is_file():
            found.append(path)
    return found


def project_slug(project_dir):
    return Path(project_dir).name


def load_catalog(project_dir, on_sheet=None):
    catalog = build_catalog(project_dir, on_sheet=on_sheet)
    return {sheet["id"]: sheet for sheet in catalog.get("sheets") or []}


def build_project_payload(project_dir, *, include_catalog=True, catalog_by_id=None):
    """Full project document for the takeoff UI."""
    project_dir = Path(project_dir).resolve()
    out_dir = project_dir / "out"
    manifest_path = out_dir / "project-manifest.json"
    manifest = {}
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    slug = project_slug(project_dir)
    png_dir = out_dir / "workspace"
    if include_catalog and catalog_by_id is None:
        try:
            catalog_by_id = load_catalog(project_dir)
        except Exception as exc:
            print(f"  catalog warning for {project_dir.name}: {exc}", flush=True)
            catalog_by_id = {}
    catalog_by_id = catalog_by_id or {}
    shape_index = _measurement_shape_index(catalog_by_id)

    bundle = load_measurement_bundle(project_dir)
    raw_records = bundle.get("measurements") or []
    effective = merge_manual_measurements(raw_records, load_manual(project_dir))
    effective = apply_measurement_overrides(effective, load_measurement_overrides(project_dir))
    overrides = _shape_overrides(project_dir)
    for record in effective:
        if record.get("manual") and record.get("points") and record.get("sheet"):
            shape_index[record["id"]] = {
                "shapeId": record["id"],
                "sheetId": record["sheet"],
                "sheetCode": _sheet_code(record["sheet"]),
                "kind": MANUAL_KIND.get(record.get("element_type") or "", "missed"),
                "label": record.get("tag") or "Manual",
            }

    sheets = []
    for entry in manifest.get("sheets") or []:
        stem = entry.get("stem")
        if not stem:
            continue
        sheets.append(_adapt_sheet(
            entry, catalog_by_id.get(stem), project_id=slug, png_dir=png_dir,
            overrides=overrides, records=effective,
        ))
    if not sheets:
        for stem, catalog_sheet in catalog_by_id.items():
            sheets.append(_adapt_sheet(
                {"stem": stem, "role": "other", "signals": []},
                catalog_sheet, project_id=slug, png_dir=png_dir, overrides=overrides, records=effective,
            ))

    capabilities = [
        {
            "id": cap.get("id", ""),
            "status": cap.get("status", "partial"),
            "reason": cap.get("reason", ""),
        }
        for cap in manifest.get("capabilities") or []
    ]

    comparison, bill_source, floors = _comparison_rows(project_dir, manifest, shape_index, raw_records, effective)
    meta = project_meta(project_dir)
    display = display_name(project_dir.name)
    return {
        "id": slug,
        "name": meta.get("name") or display,
        "place": meta.get("place") or manifest.get("place") or "",
        "bill": bill_source["name"],
        "billSource": bill_source,
        "updated": _friendly_updated(out_dir),
        "runs": _runs(out_dir),
        "capabilities": capabilities,
        "rules": manifest.get("rules_from_notes") or {},
        "sheets": sheets,
        "comparison": comparison,
        "floors": floors,
        "measurements": _adapt_measurements(effective),
        "reviewQueue": _link_missed(
            _adapt_review_queue(
                bundle.get("review_queue") or [],
                {shape.get("measurementId") for sheet in sheets for shape in sheet.get("shapes") or [] if shape.get("measurementId")},
            ),
            sheets,
        ),
        "measuredSheets": len({r.get("sheet") for r in raw_records if r.get("sheet")}),
        "_path": str(project_dir),
    }


def project_summary(payload):
    rows = [row for row in payload.get("comparison") or [] if not row.get("hidden")]
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
    public = {k: v for k, v in payload.items() if not k.startswith("_")}
    return {
        **{k: public[k] for k in ("id", "name", "place", "bill", "updated", "runs", "capabilities") if k in public},
        "drawings": len(payload.get("sheets") or []),
        "measuredSheets": payload.get("measuredSheets") or 0,
        "close": bands["close"],
        "near": bands["near"],
        "far": bands["far"],
        "compared": sum(1 for row in rows if row.get("bill") is not None and row.get("ours") is not None),
        "lines": len(rows),
    }
