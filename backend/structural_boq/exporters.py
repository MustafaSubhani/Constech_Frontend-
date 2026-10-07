"""Bill comparison and rates exports as CSV, XLSX and PDF.

XLSX is written as plain OOXML (no extra dependency). PDF is drawn with pymupdf.
"""
import csv
import io
import zipfile
from datetime import datetime
from xml.sax.saxutils import escape


def _band(bill, ours):
    if bill in (None, 0) or ours is None:
        return "No bill"
    pct = abs((ours - bill) / bill * 100)
    if pct <= 5:
        return "Within 5%"
    if pct <= 15:
        return "Within 15%"
    return "Over 15%"


def _floor_list(payload):
    return [(f["key"], f["label"]) for f in payload.get("floors") or []]


def _scope(payload, scope):
    """('project'|'floors'|'floor', floor_key, floor_label) for a requested scope."""
    floors = dict(_floor_list(payload))
    if scope == "floors" and floors:
        return "floors", "", ""
    if scope and scope not in ("project", "floors") and scope in floors:
        return "floor", scope, floors[scope]
    return "project", "", ""


def _sorted(rows, sort, value_of):
    """Rows in the order the user chose; empty values go last whichever way the column runs."""
    if not sort or not sort.get("key"):
        return rows
    descending = sort.get("dir") == "desc"
    present = [r for r in rows if value_of(r, sort["key"]) is not None]
    missing = [r for r in rows if value_of(r, sort["key"]) is None]
    present.sort(key=lambda r: value_of(r, sort["key"]), reverse=descending)
    return present + missing


def _line_value(row, key):
    bill, ours = row.get("bill"), row.get("ours")
    if key == "label":
        return (row.get("label") or "").lower()
    if key == "bill":
        return bill
    if key == "ours":
        return ours
    if key == "diff":
        return ours - bill if bill is not None and ours is not None else None
    if key == "pct":
        return abs((ours - bill) / bill * 100) if bill and ours is not None else None
    if key == "share":
        qty = (row.get("floors") or {}).get(row.get("_floor") or "")
        return qty / ours * 100 if qty is not None and ours else None
    if key.startswith("floor:"):
        return (row.get("floors") or {}).get(key[6:])
    return None


def bill_table(payload, scope="project", sort=None):
    mode, floor, floor_label = _scope(payload, scope)
    lines = [row for row in payload.get("comparison") or [] if not row.get("hidden")]
    if mode == "floor":
        lines = [{**row, "_floor": floor} for row in lines if (row.get("floors") or {}).get(floor)]
    lines = _sorted(lines, sort, _line_value)
    rows = []
    if mode == "project":
        header = ["Section", "Item", "Unit", "Bill", "Measured", "Difference", "Variance %", "Status", "Basis"]
        kinds = ["text", "text", "text", "num", "num", "num", "pct", "text", "text"]
        for row in lines:
            bill, ours = row.get("bill"), row.get("ours")
            diff = ours - bill if bill is not None and ours is not None else None
            pct = diff / bill * 100 if diff is not None and bill else None
            status = _band(bill, ours)
            if row.get("adjusted"):
                status += " (adjusted)"
            rows.append([
                row.get("section") or "",
                row.get("label") or row.get("id") or "",
                row.get("unit") or "",
                bill, ours, diff, pct, status,
                row.get("formula") or row.get("note") or "",
            ])
        title = "Bill comparison"
    elif mode == "floors":
        floors = _floor_list(payload)
        header = ["Section", "Item", "Unit"] + [label for _, label in floors] + ["Measured", "Bill", "Variance %"]
        kinds = ["text", "text", "text"] + ["num"] * len(floors) + ["num", "num", "pct"]
        for row in lines:
            bill, ours = row.get("bill"), row.get("ours")
            split = row.get("floors") or {}
            pct = (ours - bill) / bill * 100 if bill and ours is not None else None
            rows.append(
                [row.get("section") or "", row.get("label") or row.get("id") or "", row.get("unit") or ""]
                + [split.get(key) for key, _ in floors]
                + [ours, bill, pct]
            )
        title = "Bill comparison by floor"
    else:
        header = ["Section", "Item", "Unit", floor_label, "Share of line", "Project measured", "Project bill"]
        kinds = ["text", "text", "text", "num", "share", "num", "num"]
        for row in lines:
            qty = (row.get("floors") or {}).get(floor)
            ours = row.get("ours")
            share = qty / ours * 100 if ours else None
            rows.append([row.get("section") or "", row.get("label") or row.get("id") or "", row.get("unit") or "", qty, share, ours, row.get("bill")])
        title = f"Bill comparison: {floor_label}"
    return {"title": title, "header": header, "kinds": kinds, "rows": rows, "totals": [], "grouped": not (sort and sort.get("key"))}


def _rate_of(rates, line_id):
    value = rates.get(line_id)
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def rates_table(payload, rates_doc, scope="project", sort=None):
    rates = (rates_doc or {}).get("rates") or {}
    currency = (rates_doc or {}).get("currency") or ""
    markup = float((rates_doc or {}).get("markupPercent") or 0)
    mode, floor, floor_label = _scope(payload, scope)
    lines = [row for row in payload.get("comparison") or [] if not row.get("hidden") and row.get("ours") is not None]
    if mode == "floor":
        lines = [row for row in lines if (row.get("floors") or {}).get(floor)]

    def quantity(row):
        return (row.get("floors") or {}).get(floor) if mode == "floor" else row.get("ours")

    def value_of(row, key):
        rate = _rate_of(rates, row["id"])
        if key == "label":
            return (row.get("label") or "").lower()
        if key == "qty":
            return quantity(row)
        if key == "rate":
            return rate
        if key == "amount":
            qty = quantity(row)
            return qty * rate if rate is not None and qty is not None else None
        if key.startswith("floor:"):
            qty = (row.get("floors") or {}).get(key[6:])
            return qty * rate if rate is not None and qty else None
        return None

    lines = _sorted(lines, sort, value_of)
    rows = []
    direct = 0.0
    if mode == "floors":
        floors = _floor_list(payload)
        header = ["Section", "Item", "Unit", f"Rate ({currency})"] + [label for _, label in floors] + [f"Amount ({currency})"]
        kinds = ["text", "text", "text", "money"] + ["money"] * len(floors) + ["money"]
        by_floor = {key: 0.0 for key, _ in floors}
        for row in lines:
            rate = _rate_of(rates, row["id"])
            split = row.get("floors") or {}
            cells = []
            for key, _ in floors:
                amount = split[key] * rate if rate is not None and split.get(key) else None
                by_floor[key] += amount or 0.0
                cells.append(amount)
            amount = row["ours"] * rate if rate is not None else None
            direct += amount or 0.0
            rows.append([row.get("section") or "", row.get("label") or row["id"], row.get("unit") or "", rate] + cells + [amount])
        rows.append(["Summary", "Direct works by floor", "", None] + [by_floor[key] for key, _ in floors] + [direct])
        title = "Rates and estimate by floor"
    else:
        qty_label = f"Quantity, {floor_label}" if mode == "floor" else "Quantity"
        header = ["Section", "Item", "Unit", qty_label, f"Rate ({currency})", f"Amount ({currency})"]
        kinds = ["text", "text", "text", "num", "money", "money"]
        for row in lines:
            rate = _rate_of(rates, row["id"])
            qty = quantity(row)
            amount = qty * rate if rate is not None and qty is not None else None
            direct += amount or 0.0
            rows.append([row.get("section") or "", row.get("label") or row["id"], row.get("unit") or "", qty, rate, amount])
        title = f"Rates and estimate: {floor_label}" if mode == "floor" else "Rates and estimate"
    markup_amount = direct * markup / 100
    totals = [
        ["Direct works", direct],
        [f"Overheads and profit ({markup:g}%)", markup_amount],
        ["Total estimate", direct + markup_amount],
    ]
    return {
        "title": title, "header": header, "kinds": kinds, "rows": rows, "totals": totals,
        "currency": currency, "grouped": not (sort and sort.get("key")),
    }


def _fmt(value, kind):
    if value is None or value == "":
        return ""
    if kind == "pct":
        return f"{value:+.1f}%"
    if kind == "share":
        return f"{value:.1f}%"
    if kind == "money":
        return f"{value:,.2f}"
    if kind == "num":
        return f"{value:,.3f}"
    return str(value)


def to_csv(table):
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(table["header"])
    for row in table["rows"]:
        writer.writerow(["" if v is None else (round(v, 4) if isinstance(v, float) else v) for v in row])
    if table["totals"]:
        writer.writerow([])
        for label, value in table["totals"]:
            writer.writerow([""] * (len(table["header"]) - 2) + [label, round(value, 2)])
    return ("﻿" + buffer.getvalue()).encode("utf-8")


def _col(index):
    letters = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


_STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.000"/><numFmt numFmtId="165" formatCode="#,##0.00"/><numFmt numFmtId="166" formatCode="+0.0&quot;%&quot;;-0.0&quot;%&quot;;0.0&quot;%&quot;"/></numFmts>
<fonts count="3"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="12"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2B0266"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF2B0266"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="165" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
</cellXfs>
</styleSheet>"""


def to_xlsx(table, project_name):
    style_for = {"num": 2, "money": 3, "pct": 4, "share": 3}
    lines = []
    r = 1

    def text_cell(ref, value, style=0):
        return f'<c r="{ref}" t="inlineStr" s="{style}"><is><t xml:space="preserve">{escape(str(value))}</t></is></c>'

    def num_cell(ref, value, style):
        return f'<c r="{ref}" s="{style}"><v>{value}</v></c>'

    lines.append(f'<row r="{r}">{text_cell("A1", f"{project_name}: {table["title"]}", 5)}</row>')
    r += 2
    header_row = r
    cells = "".join(text_cell(f"{_col(i)}{r}", h, 1) for i, h in enumerate(table["header"]))
    lines.append(f'<row r="{r}">{cells}</row>')
    for row in table["rows"]:
        r += 1
        cells = []
        for i, value in enumerate(row):
            ref = f"{_col(i)}{r}"
            kind = table["kinds"][i]
            if value is None or value == "":
                continue
            if kind in style_for and isinstance(value, (int, float)):
                cells.append(num_cell(ref, round(value, 6), style_for[kind]))
            else:
                cells.append(text_cell(ref, value))
        lines.append(f'<row r="{r}">{"".join(cells)}</row>')
    if table["totals"]:
        r += 1
        label_col = _col(len(table["header"]) - 2)
        value_col = _col(len(table["header"]) - 1)
        for label, value in table["totals"]:
            r += 1
            lines.append(
                f'<row r="{r}">{text_cell(f"{label_col}{r}", label, 7)}{num_cell(f"{value_col}{r}", round(value, 2), 6)}</row>'
            )
    widths = []
    for i, _ in enumerate(table["header"]):
        sample = [len(str(table["header"][i]))] + [len(_fmt(row[i], table["kinds"][i])) for row in table["rows"][:400]]
        widths.append(min(max(sample) + 2, 70))
    cols = "".join(f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>' for i, w in enumerate(widths))
    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetViews><sheetView workbookViewId="0"><pane ySplit="{header_row}" topLeftCell="A{header_row + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        f"<cols>{cols}</cols><sheetData>{''.join(lines)}</sheetData></worksheet>"
    )
    sheet_name = escape(table["title"][:31])
    files = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            "</Types>"
        ),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            "</Relationships>"
        ),
        "xl/workbook.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f'<sheets><sheet name="{sheet_name}" sheetId="1" r:id="rId1"/></sheets></workbook>'
        ),
        "xl/_rels/workbook.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            "</Relationships>"
        ),
        "xl/styles.xml": _STYLES,
        "xl/worksheets/sheet1.xml": sheet,
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


_INK = (0.11, 0.10, 0.13)
_MUTED = (0.42, 0.40, 0.47)
_BRAND = (0.169, 0.008, 0.4)
_RULE = (0.89, 0.88, 0.92)
_BAND = (0.955, 0.945, 0.972)


def _fit_text(pymupdf, text, width, font, size):
    if pymupdf.get_text_length(text, fontname=font, fontsize=size) <= width:
        return text
    while text and pymupdf.get_text_length(text + "...", fontname=font, fontsize=size) > width:
        text = text[:-1]
    return text + "..." if text else ""


def _wrap_header(pymupdf, label, width, size):
    """A header on at most two lines; only the second line is shortened if it still does not fit."""
    if pymupdf.get_text_length(label, fontname="hebo", fontsize=size) <= width:
        return [label]
    words = label.split()
    first = ""
    while words and pymupdf.get_text_length((first + " " + words[0]).strip(), fontname="hebo", fontsize=size) <= width:
        first = (first + " " + words.pop(0)).strip()
    if not first:
        return [_fit_text(pymupdf, label, width, "hebo", size)]
    rest = " ".join(words)
    return [first, _fit_text(pymupdf, rest, width, "hebo", size)] if rest else [first]


def to_pdf(table, project_name):
    """A4 landscape table drawn directly, with repeated headers and section bands."""
    import pymupdf

    kinds = table["kinds"]
    grouped = table.get("grouped", True)
    drop_basis = table["header"][-1] == "Basis"
    # Grouped tables print the section as a band; a sorted table keeps it as a column instead.
    columns = list(range(1 if grouped else 0, len(table["header"]) - (1 if drop_basis else 0)))
    weights = {"text": 1.0, "num": 0.55, "money": 0.6, "pct": 0.5, "share": 0.5}
    # Wide matrices (one column per floor) give the item column less room.
    first_weight = 3.2 if len(columns) <= 8 else 2.2
    width_total = 842 - 72
    raw = [first_weight if i == 1 else (0.35 if table["header"][i] == "Unit" else weights[kinds[i]] * (1.6 if i == len(table["header"]) - 2 and drop_basis else 1)) for i in columns]
    scale = width_total / sum(raw)
    widths = [w * scale for w in raw]
    size, row_h, left = 8, 15, 36
    # Every column fits the longest word of its header; the item column gives up the room.
    if 1 in columns:
        item = columns.index(1)
        for n, i in enumerate(columns):
            longest = max(pymupdf.get_text_length(word, fontname="hebo", fontsize=size) for word in table["header"][i].split() or [""])
            short = longest + 12 - widths[n]
            if n != item and short > 0 and widths[item] - short >= 140:
                widths[n] += short
                widths[item] -= short

    doc = pymupdf.open()
    state = {"page": None, "y": 0}

    def new_page(first=False):
        page = doc.new_page(width=842, height=595)
        state["page"] = page
        y = 40
        if first:
            page.insert_text((left, y + 14), table["title"], fontname="hebo", fontsize=15, color=_BRAND)
            page.insert_text(
                (left, y + 30),
                f"{project_name}  |  generated {datetime.now().strftime('%d %b %Y %H:%M')}",
                fontname="helv", fontsize=8, color=_MUTED,
            )
            y += 44
        labels = [_wrap_header(pymupdf, table["header"][i], w - 10, size) for i, w in zip(columns, widths)]
        head_h = row_h + 2 + (10 if any(len(lines) > 1 for lines in labels) else 0)
        page.draw_rect(pymupdf.Rect(left, y, left + width_total, y + head_h), color=None, fill=_BRAND)
        x = left
        for i, w, lines in zip(columns, widths, labels):
            numeric = kinds[i] != "text"
            for n, text in enumerate(lines):
                tx = x + w - 5 - pymupdf.get_text_length(text, fontname="hebo", fontsize=size) if numeric else x + 5
                page.insert_text((tx, y + 11 + n * 10), text, fontname="hebo", fontsize=size, color=(1, 1, 1))
            x += w
        state["y"] = y + head_h

    def ensure_room(height):
        if state["y"] + height > 595 - 48:
            new_page()

    def draw_row(values, bold=False, band=False):
        ensure_room(row_h)
        page, y = state["page"], state["y"]
        if band:
            page.draw_rect(pymupdf.Rect(left, y, left + width_total, y + row_h), color=None, fill=_BAND)
        font = "hebo" if bold else "helv"
        x = left
        for (i, w), value in zip(zip(columns, widths), values):
            text = _fit_text(pymupdf, value, w - 10, font, size)
            numeric = kinds[i] != "text"
            tx = x + w - 5 - pymupdf.get_text_length(text, fontname=font, fontsize=size) if numeric else x + 5
            page.insert_text((tx, y + 10.5), text, fontname=font, fontsize=size, color=_BRAND if band else _INK)
            x += w
        if not band:
            page.draw_line((left, y + row_h), (left + width_total, y + row_h), color=_RULE, width=0.5)
        state["y"] = y + row_h

    new_page(first=True)
    section = None
    for row in table["rows"]:
        if grouped and row[0] != section:
            section = row[0]
            ensure_room(row_h * 2)
            draw_row([section or "General"] + [""] * (len(columns) - 1), bold=True, band=True)
        draw_row([_fmt(row[i], kinds[i]) for i in columns])
    if table["totals"]:
        state["y"] += 6
        for label, value in table["totals"]:
            ensure_room(row_h)
            page, y = state["page"], state["y"]
            amount = _fmt(value, "money")
            right = left + width_total - 5
            page.insert_text(
                (right - pymupdf.get_text_length(amount, fontname="hebo", fontsize=9), y + 11),
                amount, fontname="hebo", fontsize=9, color=_INK,
            )
            label_right = right - widths[-1]
            page.insert_text(
                (label_right - pymupdf.get_text_length(label, fontname="hebo", fontsize=9), y + 11),
                label, fontname="hebo", fontsize=9, color=_INK,
            )
            state["y"] = y + row_h + 2
    total = doc.page_count
    for number, page in enumerate(doc, start=1):
        page.insert_text(
            (left, 595 - 24),
            f"Constech  |  {project_name}  |  page {number} of {total}",
            fontname="helv", fontsize=7, color=_MUTED,
        )
    data = doc.tobytes(deflate=True, garbage=3)
    doc.close()
    return data
