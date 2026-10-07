"""Traceable measurement records, review queue, and manual adjustments."""
import json
import uuid
from pathlib import Path

FIT_RESIDUAL_OK_PT = 12.0


def _footing_status(row):
    if row.get("missed"):
        return "blocked", "low"
    note = (row.get("note") or "").lower()
    if not note:
        return "auto", "high"
    if "differs from schedule" in note or "not in the footing schedule" in note:
        return "review", "medium"
    if "refer to plan" in note or "bars left out" in note:
        return "review", "medium"
    if "blinding pad" in note:
        return "excluded", "high"
    return "auto", "high"


def footing_measurement(row, sheet, index=0):
    """One footing (or missed outline) as a verifiable record."""
    tag = row.get("tag") or "?"
    note = (row.get("note") or "").lower()
    status, confidence = _footing_status(row)
    mid = f"footing-{sheet}-{tag}-{index}"
    sources = [{"role": "plan_outline", "sheet": sheet, "detail": row.get("source") or "polyline"}]
    if tag not in ("MISSED", "?"):
        sources.insert(0, {"role": "schedule", "sheet": sheet, "detail": f"tag {tag}"})
    depth = row.get("depth_mm")
    formula = ""
    inputs = {
        "width_mm": row.get("width_mm"),
        "height_mm": row.get("height_mm"),
        "area_m2": row.get("area_m2"),
        "depth_mm": depth if depth != "" else None,
    }
    if depth and row.get("concrete_m3") not in ("", None):
        formula = "area_m2 * depth_mm / 1000 (or schedule L×W×D when sizes match)"
    quantities = {
        "concrete_m3": row.get("concrete_m3"),
        "blinding_m3": row.get("blinding_m3"),
        "formwork_m2": row.get("formwork_m2"),
        "rebar_kg": row.get("rebar_kg"),
    }
    rebar_flags = ["schedule_both_ways", "no_laps", "no_bends", "no_starter_bars"]
    if row.get("rebar_kg") in ("", None):
        rebar_basis = "missing"
    elif "assumed" in note or "refer to plan" in note:
        rebar_basis = "estimated"
        rebar_flags.append("partial_schedule")
    else:
        rebar_basis = "measured"
    return {
        "id": mid,
        "element_type": "footing",
        "tag": tag,
        "sheet": sheet,
        "status": status,
        "confidence": confidence,
        "quantities": quantities,
        "formula": formula,
        "inputs": inputs,
        "sources": sources,
        "note": row.get("note") or "",
        "missed": bool(row.get("missed")),
        "rebar_basis": rebar_basis,
        "rebar_flags": rebar_flags,
    }


def rebar_total_record(record_id, element_type, sheet, kg, basis, flags=None, note=""):
    """Project-level steel line with measured vs estimated basis."""
    return {
        "id": record_id,
        "element_type": element_type,
        "tag": "TOTAL",
        "sheet": sheet,
        "status": "auto" if basis == "measured" else "review",
        "confidence": "high" if basis == "measured" else "medium",
        "quantities": {"rebar_kg": round(kg, 1) if kg else 0},
        "formula": "sum of element records" if kg else "",
        "inputs": {},
        "sources": [{"role": "engine_total", "sheet": sheet, "detail": element_type}],
        "note": note,
        "missed": False,
        "rebar_basis": basis,
        "rebar_flags": flags or [],
    }


def raft_measurement(raft, sheet, index=0):
    mid = f"raft-{sheet}-{index}"
    area = raft.get("area_m2")
    thick = raft.get("thickness")
    status = "auto" if area else "review"
    return {
        "id": mid,
        "element_type": "raft",
        "tag": "RAFT",
        "sheet": sheet,
        "status": status,
        "confidence": "high" if area else "low",
        "quantities": {
            "concrete_m3": raft.get("concrete_m3"),
            "formwork_m2": raft.get("formwork_m2"),
            "rebar_kg": raft.get("rebar_kg"),
        },
        "formula": "area_m2 * thickness_mm / 1000" if area else "",
        "inputs": {"area_m2": area, "thickness_mm": thick, "note_text": raft.get("note")},
        "sources": [{"role": "plan_outline", "sheet": sheet, "detail": raft.get("note") or "RAFT THK note"}],
        "note": "" if area else "raft note found but no enclosing outline",
        "missed": False,
    }


def build_review_items(unused_tags, rows, alignments, schedule_tags_on_sheet):
    """Human review queue: unpaired tags, missed outlines, bad PDF fit, schedule orphans."""
    items = []
    for align in alignments or []:
        residual = align.get("residual_pt")
        if align.get("status") == "no_fit":
            items.append({
                "id": f"align-{align['sheet']}",
                "kind": "alignment",
                "severity": "error",
                "sheet": align["sheet"],
                "tag": "",
                "message": "No shared labels to align DWG with PDF; overlay quantities unverified",
            })
        elif residual is not None and residual > FIT_RESIDUAL_OK_PT:
            items.append({
                "id": f"align-{align['sheet']}",
                "kind": "alignment",
                "severity": "error",
                "sheet": align["sheet"],
                "tag": "",
                "message": f"DWG to PDF fit residual {residual:.1f} pt (limit {FIT_RESIDUAL_OK_PT:.0f})",
            })
    for tag in unused_tags or []:
        if isinstance(tag, dict):
            text = tag.get("text") or "?"
            sheet = tag.get("sheet") or ""
        else:
            text, sheet = str(tag), ""
        items.append({
            "id": f"unused-tag-{sheet}-{text}",
            "kind": "unused_tag",
            "severity": "warning",
            "sheet": sheet,
            "tag": text,
            "message": "Tag on plan not paired to a footing outline",
        })
    for row in rows or []:
        if row.get("missed"):
            items.append({
                "id": f"missed-{row.get('sheet', '')}-{row.get('width_mm')}-{row.get('height_mm')}",
                "kind": "missed_outline",
                "severity": "warning",
                "sheet": row.get("sheet", ""),
                "tag": "MISSED",
                "message": row.get("note") or "Outline not tied to schedule",
                "measurement_id": None,
            })
        else:
            status, _ = _footing_status(row)
            if status == "review":
                items.append({
                    "id": f"review-{row.get('sheet', '')}-{row.get('tag')}",
                    "kind": "quantity_review",
                    "severity": "info",
                    "sheet": row.get("sheet", ""),
                    "tag": row.get("tag", ""),
                    "message": row.get("note") or "Check quantity inputs",
                    "measurement_id": f"footing-{row.get('sheet')}-{row.get('tag')}",
                })
    for sheet, tags in (schedule_tags_on_sheet or {}).items():
        plan_tags = tags.get("on_plan") or set()
        schedule_only = tags.get("schedule_only") or set()
        for t in sorted(schedule_only):
            items.append({
                "id": f"schedule-only-{sheet}-{t}",
                "kind": "schedule_orphan",
                "severity": "warning",
                "sheet": sheet,
                "tag": t,
                "message": "In footing schedule but no tag on plan",
            })
    return items


def write_measurement_bundle(out_dir, measurements, review, alignments, project_name):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    bundle = {
        "project": project_name,
        "version": 1,
        "measurements": measurements,
        "review_queue": review,
        "sheet_alignment": alignments,
    }
    path = out_dir / "measurements.json"
    path.write_text(json.dumps(bundle, indent=2), encoding="utf-8")
    (out_dir / "review-queue.json").write_text(
        json.dumps({"project": project_name, "items": review}, indent=2),
        encoding="utf-8",
    )
    return path


def load_measurement_bundle(project):
    out = Path(project) / "out"
    path = out / "measurements.json"
    if not path.is_file():
        return {"measurements": [], "review_queue": [], "sheet_alignment": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    return data


def load_manual(project):
    path = Path(project) / "out" / "manual-measurements.json"
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("entries") or []


def append_manual(project, entry):
    out = Path(project) / "out"
    out.mkdir(parents=True, exist_ok=True)
    path = out / "manual-measurements.json"
    data = {"entries": load_manual(project)}
    entry = dict(entry)
    entry.setdefault("id", f"manual-{uuid.uuid4().hex[:8]}")
    entry.setdefault("status", "manual")
    entry.setdefault("confidence", "low")
    entry.setdefault("element_type", "footing")
    entry.setdefault("sources", [{"role": "manual", "detail": entry.get("reason") or "user entry"}])
    data["entries"].append(entry)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return entry


def simple_structure_record(
    record_id,
    element_type,
    sheet,
    tag,
    quantities,
    formula="",
    inputs=None,
    note="",
    status="auto",
    confidence="medium",
):
    return {
        "id": record_id,
        "element_type": element_type,
        "tag": tag,
        "sheet": sheet,
        "status": status,
        "confidence": confidence,
        "quantities": quantities,
        "formula": formula,
        "inputs": inputs or {},
        "sources": [{"role": "plan", "sheet": sheet, "detail": element_type}],
        "note": note,
        "missed": False,
    }


def structure_slab_review(floor, area_m2, low_mm, high_mm, used_mm, sheet):
    return {
        "id": f"slab-ambiguous-{sheet}-{floor}-{int(area_m2)}",
        "kind": "slab_thickness",
        "severity": "warning",
        "sheet": sheet,
        "tag": f"{low_mm}-{high_mm}mm",
        "message": (
            f"{floor} bay ~{area_m2:.0f} m2: notes disagree ({low_mm}-{high_mm} mm); "
            f"engine used {used_mm:.0f} mm"
        ),
        "measurement_id": f"slab-{sheet}",
    }


def merge_measurement_bundle(out_dir, project_name, extra_measurements, extra_review):
    """Append structure (or other) records to an existing foundations bundle."""
    out_dir = Path(out_dir)
    path = out_dir / "measurements.json"
    if path.is_file():
        bundle = json.loads(path.read_text(encoding="utf-8"))
    else:
        bundle = {
            "project": project_name,
            "version": 1,
            "measurements": [],
            "review_queue": [],
            "sheet_alignment": [],
        }
    bundle["project"] = project_name
    bundle.setdefault("measurements", []).extend(extra_measurements or [])
    seen = {item.get("id") for item in bundle.get("review_queue") or []}
    for item in extra_review or []:
        if item.get("id") not in seen:
            bundle.setdefault("review_queue", []).append(item)
            seen.add(item.get("id"))
    path.write_text(json.dumps(bundle, indent=2), encoding="utf-8")
    (out_dir / "review-queue.json").write_text(
        json.dumps({"project": project_name, "items": bundle.get("review_queue") or []}, indent=2),
        encoding="utf-8",
    )
    return path


def merge_manual_measurements(measurements, manual_entries):
    merged = list(measurements)
    for entry in manual_entries:
        merged.append({
            "id": entry["id"],
            "element_type": entry.get("element_type", "other"),
            "tag": entry.get("tag", "MANUAL"),
            "sheet": entry.get("sheet", ""),
            "status": "manual",
            "confidence": "low",
            "quantities": entry.get("quantities") or {
                k: entry.get(k) for k in ("concrete_m3", "formwork_m2", "rebar_kg", "blinding_m3")
                if entry.get(k) not in (None, "")
            },
            "formula": entry.get("formula") or "manual entry",
            "inputs": entry.get("inputs") or {},
            "sources": entry.get("sources") or [{"role": "manual", "detail": entry.get("reason", "")}],
            "note": entry.get("reason") or "",
            "missed": False,
        })
    return merged


def _overrides_path(project):
    return Path(project) / "out" / "measurement-overrides.json"


def load_measurement_overrides(project):
    path = _overrides_path(project)
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("overrides") or {}


def apply_measurement_overrides(measurements, overrides):
    if not overrides:
        return measurements
    out = []
    for record in measurements:
        patch = overrides.get(record.get("id"))
        if not patch:
            out.append(record)
            continue
        merged = dict(record)
        if patch.get("quantities"):
            merged["quantities"] = {**(merged.get("quantities") or {}), **patch["quantities"]}
        if patch.get("inputs"):
            merged["inputs"] = {**(merged.get("inputs") or {}), **patch["inputs"]}
        for key in ("formula", "note"):
            if patch.get(key) not in (None, ""):
                merged[key] = patch[key]
        merged["status"] = patch.get("status") or "adjusted"
        merged["confidence"] = patch.get("confidence") or merged.get("confidence") or "medium"
        if patch.get("adjustment_reason"):
            merged["adjustment_reason"] = patch["adjustment_reason"]
            sources = list(merged.get("sources") or [])
            sources.append({"role": "manual_adjustment", "detail": patch["adjustment_reason"]})
            merged["sources"] = sources
        out.append(merged)
    return out


def adjust_measurement(project, measurement_id, patch):
    """Persist QS manual tweak to quantities, formula, inputs, or note."""
    out = Path(project) / "out"
    out.mkdir(parents=True, exist_ok=True)
    path = _overrides_path(project)
    data = {"overrides": load_measurement_overrides(project)}
    entry = dict(data["overrides"].get(measurement_id) or {})
    entry["measurement_id"] = measurement_id
    if patch.get("quantities"):
        entry["quantities"] = {**(entry.get("quantities") or {}), **patch["quantities"]}
    if patch.get("inputs"):
        entry["inputs"] = {**(entry.get("inputs") or {}), **patch["inputs"]}
    for key in ("formula", "note", "adjustment_reason"):
        if key in patch and patch[key] is not None:
            entry[key] = patch[key]
    entry["status"] = "adjusted"
    data["overrides"][measurement_id] = entry
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return entry


def project_measurements(project):
    """Engine records + manual entries + saved overrides (no catalog rebuild)."""
    project = Path(project)
    bundle = load_measurement_bundle(project)
    manual = load_manual(project)
    merged = merge_manual_measurements(bundle.get("measurements") or [], manual)
    merged = apply_measurement_overrides(merged, load_measurement_overrides(project))
    return merged, bundle.get("review_queue") or []
