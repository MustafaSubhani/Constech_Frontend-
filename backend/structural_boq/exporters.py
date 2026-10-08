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


# PDF palette (RGB 0-1), matching the app's tokens.
_INK = (0.07, 0.07, 0.08)
_INK2 = (0.25, 0.25, 0.28)
_MUTED = (0.43, 0.43, 0.47)
_FAINT = (0.64, 0.64, 0.68)
_BRAND = (0.169, 0.008, 0.4)
_BRAND_SOFT = (0.953, 0.941, 0.984)
_RULE = (0.925, 0.925, 0.94)
_ZEBRA = (0.982, 0.982, 0.986)
_OK = (0.082, 0.478, 0.322)
_WARN = (0.604, 0.357, 0.0)
_BAD = (0.753, 0.149, 0.106)
_TONES = {
    "ok": (_OK, (0.91, 0.961, 0.933)),
    "warn": (_WARN, (0.988, 0.953, 0.89)),
    "bad": (_BAD, (0.992, 0.925, 0.922)),
    "open": (_MUTED, (0.945, 0.945, 0.957)),
}
_PAGE_W, _PAGE_H, _MARGIN = 842, 595, 36


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


def _tone_of_pct(value):
    if value is None:
        return "open"
    magnitude = abs(value)
    return "ok" if magnitude <= 5 else "warn" if magnitude <= 15 else "bad"


def _tone_of_status(text):
    text = str(text or "")
    if text.startswith("Within 5%"):
        return "ok"
    if text.startswith("Within 15%"):
        return "warn"
    if text.startswith("Over 15%"):
        return "bad"
    return "open"


def _summary_cards(table):
    """KPI cards for the first page: variance bands for a comparison, totals for an estimate."""
    rows = [row for row in table["rows"] if row and row[0] != "Summary"]
    if table.get("totals"):
        currency = table.get("currency") or ""
        priced = sum(1 for row in rows if isinstance(row[-1], (int, float)))
        cards = [("Priced lines", f"{priced} of {len(rows)}", None)]
        cards += [(label, f"{currency} {_fmt(value, 'money')}".strip(), None) for label, value in table["totals"]]
        return cards
    kinds, header = table["kinds"], table["header"]
    status_col = header.index("Status") if "Status" in header else None
    pct_col = next((i for i, k in enumerate(kinds) if k == "pct"), None)
    if status_col is None and pct_col is None:
        return [("Lines", str(len(rows)), None)]
    counts = {"ok": 0, "warn": 0, "bad": 0, "open": 0}
    for row in rows:
        tone = _tone_of_status(row[status_col]) if status_col is not None else _tone_of_pct(row[pct_col])
        counts[tone] += 1
    return [
        ("Lines", str(len(rows)), None),
        ("Within 5%", str(counts["ok"]), "ok"),
        ("Within 15%", str(counts["warn"]), "warn"),
        ("Over 15%", str(counts["bad"]), "bad"),
        ("No bill value", str(counts["open"]), "open"),
    ]


def to_pdf(table, project_name, meta=None):
    """A4 landscape report: branded header, summary cards, a table with repeated headers,
    section bands (with subtotals on an estimate), coloured variance, totals and page footers."""
    import pymupdf

    meta = meta or {}
    kinds = table["kinds"]
    header = table["header"]
    grouped = table.get("grouped", True)
    drop_basis = header[-1] == "Basis"
    columns = list(range(1 if grouped else 0, len(header) - (1 if drop_basis else 0)))
    weights = {"text": 1.0, "num": 0.55, "money": 0.62, "pct": 0.5, "share": 0.5}
    first_weight = 3.0 if len(columns) <= 8 else 2.1
    width_total = _PAGE_W - 2 * _MARGIN
    item_col = 1
    raw = []
    for i in columns:
        if i == item_col:
            raw.append(first_weight)
        elif header[i] == "Unit":
            raw.append(0.36)
        elif header[i] == "Status":
            raw.append(0.85)
        else:
            raw.append(weights.get(kinds[i], 0.6))
    scale = width_total / sum(raw)
    widths = [w * scale for w in raw]
    size, row_h, left = 8, 16, _MARGIN
    if item_col in columns:
        item = columns.index(item_col)
        for n, i in enumerate(columns):
            longest = max(pymupdf.get_text_length(word, fontname="hebo", fontsize=size) for word in header[i].split() or [""])
            short = longest + 14 - widths[n]
            if n != item and short > 0 and widths[item] - short >= 140:
                widths[n] += short
                widths[item] -= short
    money_col = len(header) - 1 if kinds[-1] == "money" and table.get("totals") else None
    generated = datetime.now().strftime("%d %b %Y, %H:%M")

    doc = pymupdf.open()
    state = {"page": None, "y": 0, "zebra": False}

    def put(page, x, y, value, size=8, font="helv", color=_INK, align="left", width=None):
        value = str(value)
        if width is not None:
            value = _fit_text(pymupdf, value, width, font, size)
        if align == "right":
            x -= pymupdf.get_text_length(value, fontname=font, fontsize=size)
        elif align == "center":
            x -= pymupdf.get_text_length(value, fontname=font, fontsize=size) / 2
        page.insert_text((x, y), value, fontname=font, fontsize=size, color=color)

    def page_header(page, first):
        page.draw_rect(pymupdf.Rect(0, 0, _PAGE_W, 6), color=None, fill=_BRAND)
        put(page, left, 30, "CONSTECH", 9, "hebo", _BRAND)
        put(page, left + 62, 30, "Structural takeoff", 8, "helv", _MUTED)
        put(page, _PAGE_W - _MARGIN, 30, project_name, 8, "hebo", _INK2, "right", 300)
        page.draw_line((left, 40), (_PAGE_W - _MARGIN, 40), color=_RULE, width=0.8)
        if not first:
            put(page, left, 58, table["title"], 11, "hebo", _INK)
            return 70
        put(page, left, 72, table["title"], 20, "hebo", _INK)
        facts = [("Project", project_name)]
        if meta.get("scope"):
            facts.append(("Scope", meta["scope"]))
        if meta.get("bill"):
            facts.append(("Compared against", meta["bill"]))
        facts.append(("Generated", generated))
        x = left
        for label, value in facts:
            put(page, x, 92, label.upper(), 6.5, "hebo", _FAINT)
            shown = _fit_text(pymupdf, str(value), 230, "helv", 8.5)
            put(page, x, 104, shown, 8.5, "helv", _INK2)
            x += max(110, pymupdf.get_text_length(shown, fontname="helv", fontsize=8.5) + 28)
        cards = _summary_cards(table)
        gap = 8
        card_w = (width_total - gap * (len(cards) - 1)) / len(cards)
        y0 = 118
        for n, (label, value, tone) in enumerate(cards):
            x0 = left + n * (card_w + gap)
            fill = _TONES[tone][1] if tone else _BRAND_SOFT
            accent = _TONES[tone][0] if tone else _BRAND
            page.draw_rect(pymupdf.Rect(x0, y0, x0 + card_w, y0 + 46), color=None, fill=fill, radius=0.12)
            page.draw_rect(pymupdf.Rect(x0, y0 + 9, x0 + 2.5, y0 + 37), color=None, fill=accent)
            put(page, x0 + 12, y0 + 17, label, 7.5, "helv", _MUTED, width=card_w - 20)
            put(page, x0 + 12, y0 + 35, value, 14, "hebo", accent if tone else _INK, width=card_w - 20)
        return y0 + 62

    def table_head(page, y):
        labels = [_wrap_header(pymupdf, header[i], w - 12, size) for i, w in zip(columns, widths)]
        head_h = row_h + 4 + (10 if any(len(lines) > 1 for lines in labels) else 0)
        page.draw_rect(pymupdf.Rect(left, y, left + width_total, y + head_h), color=None, fill=_BRAND, radius=0.08)
        x = left
        for i, w, lines in zip(columns, widths, labels):
            numeric = kinds[i] != "text"
            for n, label in enumerate(lines):
                put(page, x + w - 6 if numeric else x + 6, y + 12 + n * 10, label, size, "hebo", (1, 1, 1), "right" if numeric else "left")
            x += w
        return y + head_h

    def new_page(first=False):
        page = doc.new_page(width=_PAGE_W, height=_PAGE_H)
        state["page"] = page
        state["y"] = table_head(page, page_header(page, first))
        state["zebra"] = False

    def ensure_room(height):
        if state["y"] + height > _PAGE_H - 44:
            new_page()

    def draw_band(label, amount=None):
        ensure_room(row_h * 2 + 5)
        page, y = state["page"], state["y"]
        page.draw_rect(pymupdf.Rect(left, y + 3, left + width_total, y + row_h + 3), color=None, fill=_BRAND_SOFT)
        put(page, left + 6, y + 14, label or "General", 8, "hebo", _BRAND)
        if amount is not None:
            put(page, left + width_total - 6, y + 14, _fmt(amount, "money"), 8, "hebo", _BRAND, "right")
        state["y"] = y + row_h + 5
        state["zebra"] = False

    def draw_row(row, bold=False, fill=None):
        ensure_room(row_h)
        page, y = state["page"], state["y"]
        if fill or state["zebra"]:
            page.draw_rect(pymupdf.Rect(left, y, left + width_total, y + row_h), color=None, fill=fill or _ZEBRA)
        state["zebra"] = not state["zebra"]
        x = left
        for i, w in zip(columns, widths):
            value, kind = row[i], kinds[i]
            font = "hebo" if bold else "helv"
            if header[i] == "Status" and value:
                tone = _tone_of_status(value)
                page.draw_circle((x + 9, y + row_h / 2), 2.4, color=None, fill=_TONES[tone][0])
                put(page, x + 15, y + 11, value, size, font, _TONES[tone][0], width=w - 20)
            elif kind == "text":
                put(page, x + 6, y + 11, _fmt(value, kind), size, font, _INK if i == item_col else _INK2, width=w - 12)
            else:
                color = _TONES[_tone_of_pct(value)][0] if kind == "pct" and isinstance(value, (int, float)) else _INK
                cell_font = "hebo" if kind == "pct" or bold else font
                shown = _fmt(value, kind)
                cell_size = size
                # A number is never shortened: shrink it to fit the column instead.
                while cell_size > 5 and pymupdf.get_text_length(shown, fontname=cell_font, fontsize=cell_size) > w - 10:
                    cell_size -= 0.5
                put(page, x + w - 6, y + 11, shown, cell_size, cell_font, color, "right")
            x += w
        page.draw_line((left, y + row_h), (left + width_total, y + row_h), color=_RULE, width=0.4)
        state["y"] = y + row_h

    new_page(first=True)
    rows = table["rows"]
    if not rows:
        put(state["page"], left + width_total / 2, state["y"] + 40, "No lines to show for this view.", 10, "helv", _MUTED, "center")
    section = None
    for row in rows:
        if grouped and row[0] != section:
            section = row[0]
            subtotal = None
            priced = [r[money_col] for r in rows if money_col is not None and r[0] == section and isinstance(r[money_col], (int, float))]
            if priced and section != "Summary":
                subtotal = sum(priced)
            draw_band(section, subtotal)
        summary = row[0] == "Summary"
        draw_row(row, bold=summary, fill=_BRAND_SOFT if summary else None)

    if table["totals"]:
        box_w = 300
        ensure_room(len(table["totals"]) * 20 + 30)
        page, y = state["page"], state["y"] + 14
        x0 = left + width_total - box_w
        for n, (label, value) in enumerate(table["totals"]):
            last = n == len(table["totals"]) - 1
            h = 22 if last else 18
            if last:
                page.draw_rect(pymupdf.Rect(x0, y, x0 + box_w, y + h), color=None, fill=_BRAND, radius=0.15)
            else:
                page.draw_line((x0, y + h), (x0 + box_w, y + h), color=_RULE, width=0.5)
            color = (1, 1, 1) if last else _INK2
            put(page, x0 + 10, y + h - 6.5, label, 9 if last else 8.5, "hebo" if last else "helv", color)
            amount = f"{table.get('currency') or ''} {_fmt(value, 'money')}".strip()
            put(page, x0 + box_w - 10, y + h - 6.5, amount, 10 if last else 8.5, "hebo", color, "right")
            y += h + (2 if last else 0)
        state["y"] = y

    total = doc.page_count
    for number, page in enumerate(doc, start=1):
        page.draw_line((left, _PAGE_H - 30), (_PAGE_W - _MARGIN, _PAGE_H - 30), color=_RULE, width=0.6)
        put(page, left, _PAGE_H - 18, f"Constech  |  {project_name}  |  {table['title']}", 7, "helv", _MUTED, width=520)
        put(page, _PAGE_W - _MARGIN, _PAGE_H - 18, f"Page {number} of {total}", 7, "hebo", _MUTED, "right")
    data = doc.tobytes(deflate=True, garbage=3)
    doc.close()
    return data
