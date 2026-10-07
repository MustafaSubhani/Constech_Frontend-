"""Which bill the comparison is measured against.

The engine compares with the workbook it finds itself. The QS can pick another
bill found in the project, or upload one (.xlsx or .csv) into bills/.
"""
import json
from pathlib import Path

from .bill import foundation_baseline, load_table, quantity_lines
from .courtyard import courtyard_summary_baseline, find_courtyard_workbook
from .foundations import _find_bill

BILL_SUFFIXES = {".xlsx", ".csv"}
_SKIP = {"out", "node_modules", ".git", "rates"}
_KEY_HEADERS = {"item", "key", "code", "item key", "item_key"}
_cache = {}


def _selection_path(project):
    return Path(project) / "out" / "bill-selection.json"


def bill_candidates(project):
    """Bill-like spreadsheets in the project, newest first within each folder."""
    project = Path(project)
    default = _find_bill(project)
    courtyard = find_courtyard_workbook(project)
    found = []
    for path in sorted(project.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in BILL_SUFFIXES:
            continue
        rel_parts = path.relative_to(project).parts
        if set(rel_parts) & _SKIP or path.name.startswith("~$"):
            continue
        stat = path.stat()
        found.append({
            "file": str(path.relative_to(project)).replace("\\", "/"),
            "name": path.name,
            "kind": "takeoff" if courtyard and path.resolve() == courtyard.resolve() else "bill",
            "engineDefault": bool(default and path.resolve() == default.resolve()),
            "uploaded": rel_parts[0] == "bills",
            "sizeBytes": stat.st_size,
            "modified": stat.st_mtime,
        })
    return found


def resolve_bill(project, rel):
    project = Path(project).resolve()
    candidate = (project / rel).resolve()
    if project not in candidate.parents or not candidate.is_file():
        return None
    if candidate.suffix.lower() not in BILL_SUFFIXES:
        return None
    return candidate


def selected_bill(project):
    """(relative path, absolute path) of the bill in use, falling back to the engine's pick."""
    project = Path(project)
    path = _selection_path(project)
    if path.is_file():
        try:
            rel = json.loads(path.read_text(encoding="utf-8")).get("file") or ""
        except (json.JSONDecodeError, OSError):
            rel = ""
        resolved = resolve_bill(project, rel) if rel else None
        if resolved:
            return rel, resolved
    default = _find_bill(project)
    if default:
        return str(default.relative_to(project)).replace("\\", "/"), default
    return "", None


def select_bill(project, rel):
    project = Path(project)
    if rel and not resolve_bill(project, rel):
        raise ValueError("That bill file is not in this project.")
    path = _selection_path(project)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"file": rel}, indent=2), encoding="utf-8")
    return rel


def _direct_keys(path, known_keys):
    """A sheet with an item-key column (e.g. 'footing_m3') maps straight onto engine lines."""
    found = {}
    for rows in load_table(path).values():
        header_row = key_col = qty_col = None
        for row in sorted(rows):
            cells = {col: str(val).strip().lower() for col, val in rows[row].items()}
            key_col = next((c for c, v in cells.items() if v in _KEY_HEADERS), None)
            qty_col = next((c for c, v in cells.items() if v in {"quantity", "qty", "bill"}), None)
            if key_col and qty_col:
                header_row = row
                break
        if header_row is None:
            continue
        for row in sorted(rows):
            if row <= header_row:
                continue
            key = str(rows[row].get(key_col) or "").strip()
            if key not in known_keys:
                continue
            try:
                found[key] = float(rows[row].get(qty_col))
            except (TypeError, ValueError):
                continue
    return found


def baseline_for(project, path, known_keys=()):
    """Bill quantities keyed like the engine lines, read the same way the engine reads its own bill."""
    from .structure import _structure_bill

    path = Path(path)
    stat = path.stat()
    cache_key = (str(path), stat.st_mtime_ns, stat.st_size, tuple(sorted(known_keys)))
    if cache_key in _cache:
        return _cache[cache_key]
    courtyard = find_courtyard_workbook(project)
    if courtyard and path.resolve() == courtyard.resolve():
        values = courtyard_summary_baseline(path)
    else:
        values = _direct_keys(path, set(known_keys))
        if not values:
            values = {**foundation_baseline(path), **_structure_bill(path)}
    line_count = len(quantity_lines(path)) if path.suffix.lower() in BILL_SUFFIXES else 0
    result = {"values": values, "lineCount": line_count}
    _cache[cache_key] = result
    return result
