"""Read quantity lines out of a consultant bill workbook.

The reader looks for a header row with Description and Quantity, on whatever
sheet that header sits on. It does not assume a file name or a sheet name.
"""
import csv
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def _load(path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.findall(".//m:t", NS)))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    sheets = []
    for sh in wb.findall("m:sheets/m:sheet", NS):
        sheets.append((
            sh.attrib.get("name"),
            sh.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"),
        ))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rid = {rel.attrib.get("Id"): rel.attrib.get("Target") for rel in rels}
    data = {}
    for name, rel_id in sheets:
        target = rid[rel_id]
        if not target.startswith("xl/"):
            target = "xl/" + target.lstrip("/")
        sheet = ET.fromstring(z.read(target))
        rows = defaultdict(dict)
        for cell in sheet.findall(".//m:c", NS):
            ref = cell.attrib.get("r")
            if not ref:
                continue
            col = "".join(ch for ch in ref if ch.isalpha())
            row = int("".join(ch for ch in ref if ch.isdigit()))
            kind = cell.attrib.get("t")
            value = cell.find("m:v", NS)
            if kind == "s" and value is not None and value.text:
                rows[row][col] = shared[int(value.text)]
            elif value is not None and value.text:
                rows[row][col] = value.text
        data[name] = rows
    z.close()
    return data


def _column_letter(index):
    letters = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def _load_csv(path):
    rows = defaultdict(dict)
    with open(path, encoding="utf-8-sig", newline="") as handle:
        for r, record in enumerate(csv.reader(handle), start=1):
            for c, value in enumerate(record):
                if value.strip():
                    rows[r][_column_letter(c)] = value.strip()
    return {Path(path).stem: rows}


def load_table(path):
    """Workbook-like {sheet: {row: {col: value}}} for .xlsx and .csv files."""
    if Path(path).suffix.lower() == ".csv":
        return _load_csv(path)
    return _load(path)


_DESC_HEADERS = {"description", "item description", "desc", "item"}
_QTY_HEADERS = {"quantity", "qty", "qty.", "quantities"}
_UNIT_HEADERS = {"unit", "units", "uom"}


def _header_map(rows):
    """Return (description column, quantity column, unit column) from a header row.

    The strict "Description"/"Quantity" pass runs first so existing bills read exactly as before.
    """
    for desc_names, qty_names, unit_names in (
        ({"description"}, {"quantity"}, {"unit"}),
        (_DESC_HEADERS, _QTY_HEADERS, _UNIT_HEADERS),
    ):
        for row in sorted(rows):
            cells = {col: str(val).strip().lower() for col, val in rows[row].items()}
            desc = next((col for col, val in cells.items() if val in desc_names), None)
            qty = next((col for col, val in cells.items() if val in qty_names), None)
            unit = next((col for col, val in cells.items() if val in unit_names), None)
            if desc and qty:
                return desc, qty, unit
    return None


def quantity_lines(path):
    """Every measured line in the workbook, in sheet order."""
    lines = []
    for sheet, rows in load_table(path).items():
        header = _header_map(rows)
        if not header:
            continue
        desc_col, qty_col, unit_col = header
        for row in sorted(rows):
            desc = str(rows[row].get(desc_col) or "").replace("\n", " ").strip()
            raw = rows[row].get(qty_col)
            if not desc or raw is None:
                continue
            try:
                amount = float(raw)
            except (TypeError, ValueError):
                continue
            unit = str(rows[row].get(unit_col) or "") if unit_col else ""
            lines.append({
                "sheet": sheet,
                "description": desc,
                "qty": amount,
                "unit": unit,
            })
    return lines


def _kind(unit, description):
    text = f"{unit} {description}".lower()
    if "kg" in text:
        return "kg"
    if description.lower().startswith("to sides"):
        return "m2"
    if any(mark in unit for mark in ("2", "²", "m2", "m²")):
        return "m2"
    return "m3"


def foundation_baseline(path):
    """Match foundation lines by what they say, not by a fixed row number.

    Missing lines are omitted. A bill with no foundation section returns {}.
    """
    found = {}
    for line in quantity_lines(path):
        desc = line["description"].lower()
        kind = _kind(line["unit"], line["description"])
        key = None
        if "blinding" in desc and kind == "m3":
            key = "blinding_m3"
        elif desc.startswith("to sides of raft") and kind == "m2":
            key = "raft_m2"
        elif desc.startswith("to sides of footing") and kind == "m2":
            key = "footing_m2"
        elif desc.strip() in {"raft", "raft foundation"} or desc.startswith("raft "):
            key = f"raft_{kind}"
        elif desc.strip() in {"footing", "footings"} or desc.startswith("footing "):
            key = f"footing_{kind}"
        if key and key not in found:
            found[key] = line["qty"]
    return found
