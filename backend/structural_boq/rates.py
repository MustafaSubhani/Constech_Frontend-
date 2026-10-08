"""Project rates: storage, and import from a rates sheet with suggested matches for the QS to confirm."""
import json
import re
from pathlib import Path

from .bill import load_table

_RATE_HEADERS = ("rate", "unit rate", "price", "unit price")
_DESC_HEADERS = {"description", "item description", "desc", "item", "name"}
_KEY_HEADERS = {"key", "code", "item key", "item_key", "id"}
_UNIT_HEADERS = {"unit", "units", "uom"}
_STOP = {"the", "of", "to", "and", "in", "for", "with", "a", "an", "mm", "all", "including", "incl"}


def rates_path(project):
    return Path(project) / "out" / "rates.json"


def load_rates(project):
    path = rates_path(project)
    data = {}
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            data = {}
    rates = {}
    for key, value in (data.get("rates") or {}).items():
        if value in (None, ""):
            continue
        try:
            rates[key] = float(value)
        except (TypeError, ValueError):
            continue
    return {
        "currency": data.get("currency") or "",
        "markupPercent": float(data.get("markupPercent") or 0),
        "rates": rates,
        "source": data.get("source") or "",
    }


def save_rates(project, body):
    current = load_rates(project)
    if "currency" in body:
        current["currency"] = str(body.get("currency") or "")[:8]
    if "markupPercent" in body:
        markup = float(body.get("markupPercent") or 0)
        if not 0 <= markup <= 100:
            raise ValueError("Overheads and profit must be between 0 and 100%")
        current["markupPercent"] = markup
    if "rates" in body:
        rates = {}
        for key, value in (body.get("rates") or {}).items():
            if value in (None, ""):
                continue
            number = float(value)
            if number < 0:
                raise ValueError("Rates cannot be negative")
            rates[str(key)] = number
        current["rates"] = rates
    if body.get("source") is not None:
        current["source"] = str(body["source"])[:200]
    path = rates_path(project)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(current, indent=2), encoding="utf-8")
    from .accounts import replace_file

    replace_file(tmp, path)
    return current


def _number(raw):
    if raw in (None, ""):
        return None
    text = re.sub(r"[^\d.\-]", "", str(raw))
    try:
        return float(text) if text not in ("", "-", ".") else None
    except ValueError:
        return None


def read_rate_rows(path):
    """Rows with a description (or key) and a rate, from the first sheet with such a header."""
    for sheet, rows in load_table(path).items():
        header = None
        for row in sorted(rows):
            cells = {col: str(val).strip().lower() for col, val in rows[row].items()}
            rate_col = next((c for c, v in cells.items() if v in _RATE_HEADERS or v.startswith("rate")), None)
            desc_col = next((c for c, v in cells.items() if v in _DESC_HEADERS), None)
            key_col = next((c for c, v in cells.items() if v in _KEY_HEADERS), None)
            unit_col = next((c for c, v in cells.items() if v in _UNIT_HEADERS), None)
            if rate_col and (desc_col or key_col):
                header = (row, rate_col, desc_col, key_col, unit_col)
                break
        if not header:
            continue
        header_row, rate_col, desc_col, key_col, unit_col = header
        found = []
        for row in sorted(rows):
            if row <= header_row:
                continue
            rate = _number(rows[row].get(rate_col))
            desc = str(rows[row].get(desc_col) or "").replace("\n", " ").strip() if desc_col else ""
            key = str(rows[row].get(key_col) or "").strip() if key_col else ""
            if rate is None or not (desc or key):
                continue
            found.append({
                "row": row,
                "sheet": sheet,
                "description": desc,
                "key": key,
                "unit": str(rows[row].get(unit_col) or "").strip() if unit_col else "",
                "rate": rate,
            })
        if found:
            return found
    return []


def _tokens(text):
    words = re.findall(r"[a-z]+", (text or "").lower().replace("_", " "))
    return {w for w in words if w not in _STOP and len(w) > 1}


def _unit_kind(unit, key=""):
    text = f"{unit} {key}".lower()
    if "kg" in text or "ton" in text:
        return "kg"
    if "m3" in text or "m³" in text or "cum" in text:
        return "m3"
    if "m2" in text or "m²" in text or "sqm" in text:
        return "m2"
    return ""


def suggest_matches(lines, rate_rows):
    """For each bill line, the best rate row and a 0..1 confidence. Nothing is applied here."""
    suggestions = []
    used = set()
    for line in lines:
        line_tokens = _tokens(f"{line.get('label')} {line.get('section')}") | _tokens(line.get("id"))
        line_kind = _unit_kind(line.get("unit") or "", line.get("id") or "")
        best = None
        for index, rate_row in enumerate(rate_rows):
            if rate_row["key"] and rate_row["key"] == line.get("id"):
                best = (1.0, index)
                break
            row_tokens = _tokens(rate_row["description"])
            if not row_tokens or not line_tokens:
                continue
            score = len(line_tokens & row_tokens) / len(line_tokens | row_tokens)
            row_kind = _unit_kind(rate_row["unit"])
            if row_kind and line_kind and row_kind != line_kind:
                score *= 0.25
            elif row_kind and row_kind == line_kind:
                score = min(1.0, score + 0.15)
            if best is None or score > best[0]:
                best = (score, index)
        if best and best[0] >= 0.2:
            used.add(best[1])
            suggestions.append({"key": line.get("id"), "rowIndex": best[1], "score": round(best[0], 2)})
        else:
            suggestions.append({"key": line.get("id"), "rowIndex": None, "score": 0})
    return suggestions, [i for i in range(len(rate_rows)) if i not in used]
