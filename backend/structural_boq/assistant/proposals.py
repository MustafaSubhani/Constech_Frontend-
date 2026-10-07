"""Assistant proposals: created by tools, reviewed by the QS, applied with an undo snapshot."""
import json
import re
import uuid
from datetime import datetime
from pathlib import Path

from ..bill_lines import _ROLLUP, _load_adjustment_file, _save_adjustment_file, adjust_bill_line
from ..formula import evaluate
from ..inputs import load_inputs, save_inputs
from ..measurements import (
    QUANTITY_FIELDS,
    _overrides_path,
    adjust_measurement,
    append_manual,
    delete_manual,
    load_manual,
    load_measurement_overrides,
    update_manual,
)


def _path(project):
    return Path(project) / "out" / "assistant" / "proposals.json"


def load_all(project):
    path = _path(project)
    if not path.is_file():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("proposals") or []
    except (json.JSONDecodeError, OSError):
        return []


def _save_all(project, items):
    path = _path(project)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"proposals": items}, indent=2), encoding="utf-8")


def _now():
    return datetime.now().isoformat(timespec="seconds")


def _norm(text):
    return re.sub(r"\s+", " ", (text or "").upper()).strip()


def verify_evidence(ctx, evidence):
    """Check each quoted text really is on the cited sheet (or in a notes file)."""
    checked = []
    for item in evidence or []:
        sheet = ctx.resolve_sheet(item.get("sheet"))
        quote = _norm(item.get("text"))
        verified = False
        how = "sheet not found"
        if sheet and quote:
            joined = " ".join(_norm(t["text"]) for t in ctx.texts(sheet))
            if quote in joined:
                verified, how = True, "exact"
            else:
                tokens = [t for t in quote.split() if len(t) > 1]
                present = [t for t in tokens if t in joined]
                if tokens and len(present) / len(tokens) >= 0.8:
                    verified, how = True, "all key words found"
                else:
                    how = "text not found on this sheet"
        elif quote:
            for path in ctx.notes_files():
                if quote in _norm(path.read_text(encoding="utf-8", errors="replace")):
                    sheet, verified, how = path.name, True, "exact"
                    break
        checked.append({"sheet": sheet or item.get("sheet"), "text": item.get("text", "")[:240], "verified": verified, "check": how})
    return checked


def _measurement(ctx, mid):
    m = next((r for r in ctx.payload.get("measurements") or [] if r["id"] == mid), None)
    if not m:
        raise ValueError(f"No measurement '{mid}'")
    return m


def _line_impacts(ctx, element_type, field, delta):
    rows = {r["id"]: r for r in ctx.payload.get("comparison") or []}
    impacts = []
    for key, (types, f) in _ROLLUP.items():
        if element_type in types and f == field and key in rows and abs(delta) > 1e-9:
            row = rows[key]
            before = row.get("ours")
            impacts.append({
                "lineId": key, "label": row.get("label"), "unit": row.get("unit"),
                "before": before, "after": round(before + delta, 4) if before is not None else None,
                "bill": row.get("bill"),
            })
    return impacts


def _num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def create(ctx, kind, args):
    reason = (args.get("reason") or "").strip()
    if not reason:
        raise ValueError("A reason is required")
    evidence = verify_evidence(ctx, args.get("evidence") or [])
    proposal = {
        "id": f"p-{uuid.uuid4().hex[:8]}",
        "threadId": ctx.thread_id,
        "kind": kind,
        "status": "pending",
        "reason": reason[:400],
        "evidence": evidence,
        "created": _now(),
    }
    if kind == "measurement_change":
        m = _measurement(ctx, args.get("measurement_id"))
        field = args.get("field")
        if field not in QUANTITY_FIELDS:
            raise ValueError(f"field must be one of {', '.join(QUANTITY_FIELDS)}")
        spec = args.get("formula") or {}
        after = round(evaluate(spec.get("expression"), spec.get("variables") or {}), 4)
        before = _num((m.get("quantities") or {}).get(field)) or 0.0
        proposal.update({
            "target": {"measurementId": m["id"], "field": field, "tag": m.get("tag"), "sheet": m.get("sheet"), "elementType": m.get("elementType")},
            "patch": {"expression": spec.get("expression"), "variables": spec.get("variables") or {}},
            "before": before, "after": after,
            "impacts": _line_impacts(ctx, m.get("elementType"), field, after - before),
            "summary": f"{m.get('tag') or m['id']}: {field.replace('_', ' ')} {before:g} to {after:g}",
        })
    elif kind == "exclude":
        m = _measurement(ctx, args.get("measurement_id"))
        impacts = []
        for field, value in (m.get("quantities") or {}).items():
            v = _num(value)
            if v:
                impacts.extend(_line_impacts(ctx, m.get("elementType"), field, -v))
        proposal.update({
            "target": {"measurementId": m["id"], "tag": m.get("tag"), "sheet": m.get("sheet"), "elementType": m.get("elementType")},
            "patch": {}, "impacts": impacts,
            "summary": f"Remove {m.get('tag') or m['id']} from the takeoff",
        })
    elif kind == "new_element":
        sheet = ctx.resolve_sheet(args.get("sheet")) or args.get("sheet") or ""
        formulas = args.get("formulas") or {}
        values = {}
        impacts = []
        for field, spec in formulas.items():
            if field not in QUANTITY_FIELDS:
                raise ValueError(f"Unknown quantity field '{field}'")
            values[field] = round(evaluate(spec.get("expression"), spec.get("variables") or {}), 4)
            impacts.extend(_line_impacts(ctx, args.get("element_type"), field, values[field]))
        proposal.update({
            "target": {"elementType": args.get("element_type"), "tag": args.get("tag"), "sheet": sheet},
            "patch": {"formulas": formulas}, "after": values, "impacts": impacts,
            "summary": f"Add {args.get('element_type', '').replace('_', ' ')} {args.get('tag')} on {sheet}",
        })
    elif kind == "bill_override":
        row = next((r for r in ctx.payload.get("comparison") or [] if r["id"] == args.get("line_id")), None)
        if not row:
            raise ValueError(f"No bill line '{args.get('line_id')}'")
        spec = args.get("formula") or {}
        after = round(evaluate(spec.get("expression"), spec.get("variables") or {}), 4)
        proposal.update({
            "target": {"lineId": row["id"], "label": row.get("label"), "unit": row.get("unit")},
            "patch": {"expression": spec.get("expression"), "variables": spec.get("variables") or {}},
            "before": row.get("ours"), "after": after,
            "impacts": [{"lineId": row["id"], "label": row.get("label"), "unit": row.get("unit"), "before": row.get("ours"), "after": after, "bill": row.get("bill")}],
            "summary": f"{row.get('label')}: measured {row.get('ours')} to {after:g} {row.get('unit')}",
        })
    elif kind == "project_input":
        key = args.get("key")
        value = _num(args.get("value"))
        if key not in ("blinding_mm", "footing_cover_mm") or value is None:
            raise ValueError("key must be blinding_mm or footing_cover_mm with a numeric value")
        before = (load_inputs(ctx.project).get("values") or {}).get(key)
        proposal.update({
            "target": {"key": key}, "patch": {"value": value}, "before": before, "after": value, "impacts": [],
            "summary": f"Set {key.replace('_', ' ')} to {value:g} (rerun measurement to apply)",
        })
    elif kind == "sheet_role":
        stem = ctx.resolve_sheet(args.get("sheet"))
        if not stem:
            raise ValueError(f"No sheet matches '{args.get('sheet')}'")
        current = next((s for s in ctx.sheets() if s.get("stem") == stem), {})
        proposal.update({
            "target": {"sheet": stem}, "patch": {"role": args.get("role"), "floor": args.get("floor") or ""},
            "before": current.get("role"), "after": args.get("role"), "impacts": [],
            "summary": f"{stem}: role {current.get('role')} to {args.get('role')} (rerun discovery to apply)",
        })
    else:
        raise ValueError(f"Unknown proposal kind '{kind}'")
    items = load_all(ctx.project)
    items.append(proposal)
    _save_all(ctx.project, items)
    return proposal


# Applying and undoing -------------------------------------------------------

def _restore_override(project, mid, snapshot):
    path = _overrides_path(project)
    data = {"overrides": load_measurement_overrides(project)}
    if snapshot is None:
        data["overrides"].pop(mid, None)
    else:
        data["overrides"][mid] = snapshot
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _restore_manual(project, entry):
    path = Path(project) / "out" / "manual-measurements.json"
    entries = [e for e in load_manual(project) if e.get("id") != entry.get("id")] + [entry]
    path.write_text(json.dumps({"entries": entries}, indent=2), encoding="utf-8")


def _sheet_roles_path(project):
    return Path(project) / "out" / "sheet-roles.json"


def load_sheet_roles(project):
    path = _sheet_roles_path(project)
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("roles") or {}
    except (json.JSONDecodeError, OSError):
        return {}


def _save_sheet_roles(project, roles):
    path = _sheet_roles_path(project)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"roles": roles}, indent=2), encoding="utf-8")


def apply(project, proposal_id):
    items = load_all(project)
    p = next((x for x in items if x["id"] == proposal_id), None)
    if not p:
        raise ValueError("Proposal not found")
    if p["status"] != "pending":
        raise ValueError(f"Proposal is already {p['status']}")
    reason = f"Assistant: {p['reason']}"
    kind, target, patch = p["kind"], p.get("target") or {}, p.get("patch") or {}
    if kind in ("measurement_change", "exclude"):
        mid = target["measurementId"]
        manual = next((e for e in load_manual(project) if e.get("id") == mid), None)
        if manual is not None:
            p["undo"] = {"manual": manual}
            if kind == "exclude":
                delete_manual(project, mid)
            else:
                update_manual(project, mid, {"expressions": {target["field"]: patch}, "reason": reason})
        else:
            p["undo"] = {"override": load_measurement_overrides(project).get(mid)}
            if kind == "exclude":
                adjust_measurement(project, mid, {"status": "excluded", "adjustment_reason": reason})
            else:
                adjust_measurement(project, mid, {"expressions": {target["field"]: patch}, "adjustment_reason": reason})
    elif kind == "new_element":
        entry = append_manual(project, {
            "tag": target.get("tag"), "sheet": target.get("sheet"), "element_type": target.get("elementType"),
            "expressions": patch.get("formulas") or {}, "reason": reason,
        })
        p["undo"] = {"created": entry["id"]}
    elif kind == "bill_override":
        key = target["lineId"]
        p["undo"] = {"line": _load_adjustment_file(project)["lines"].get(key)}
        adjust_bill_line(project, key, {"expression": patch["expression"], "variables": patch["variables"], "adjustment_reason": reason})
    elif kind == "project_input":
        key = target["key"]
        p["undo"] = {"value": (load_inputs(project).get("values") or {}).get(key)}
        save_inputs(project, {key: patch["value"]})
    elif kind == "sheet_role":
        roles = load_sheet_roles(project)
        p["undo"] = {"role": roles.get(target["sheet"])}
        roles[target["sheet"]] = {"role": patch["role"], "floor": patch.get("floor") or "", "reason": reason}
        _save_sheet_roles(project, roles)
    p["status"] = "applied"
    p["applied"] = _now()
    _save_all(project, items)
    return p


def undo(project, proposal_id):
    items = load_all(project)
    p = next((x for x in items if x["id"] == proposal_id), None)
    if not p or p["status"] != "applied":
        raise ValueError("Only applied proposals can be undone")
    snap, target = p.get("undo") or {}, p.get("target") or {}
    kind = p["kind"]
    if kind in ("measurement_change", "exclude"):
        if "manual" in snap:
            _restore_manual(project, snap["manual"])
        else:
            _restore_override(project, target["measurementId"], snap.get("override"))
    elif kind == "new_element":
        delete_manual(project, snap.get("created"))
    elif kind == "bill_override":
        data = _load_adjustment_file(project)
        if snap.get("line") is None:
            data["lines"].pop(target["lineId"], None)
        else:
            data["lines"][target["lineId"]] = snap["line"]
        _save_adjustment_file(project, data)
    elif kind == "project_input":
        save_inputs(project, {target["key"]: snap.get("value")})
    elif kind == "sheet_role":
        roles = load_sheet_roles(project)
        if snap.get("role") is None:
            roles.pop(target["sheet"], None)
        else:
            roles[target["sheet"]] = snap["role"]
        _save_sheet_roles(project, roles)
    p["status"] = "undone"
    p["undone"] = _now()
    _save_all(project, items)
    return p


def reject(project, proposal_id):
    items = load_all(project)
    p = next((x for x in items if x["id"] == proposal_id), None)
    if not p or p["status"] != "pending":
        raise ValueError("Only pending proposals can be rejected")
    p["status"] = "rejected"
    p["rejected"] = _now()
    _save_all(project, items)
    return p
