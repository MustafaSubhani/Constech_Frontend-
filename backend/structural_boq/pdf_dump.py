"""Build a DWG-like text dump from searchable PDF pages.

Schedules are read from positioned words, not fixed cells or fonts. The same
row/column clustering in foundations.py applies once text has x, y, and height.
Scanned PDFs (no text layer) return an empty entity list; discovery should
treat that as needs_ocr rather than silently missing data.
"""
from pathlib import Path

import pymupdf

pymupdf.TOOLS.mupdf_display_errors(False)

PT_TO_MM = 25.4 / 72.0


def dump_from_pdf(pdf_path):
    """Minimal dump dict compatible with foundations._texts / _schedule_cells."""
    pdf_path = Path(pdf_path)
    doc = pymupdf.open(pdf_path)
    entities = []
    for page in doc:
        page_h = page.rect.height
        for word in page.get_text("words"):
            x0, y0, x1, y1, text, *_ = word
            if not (text or "").strip():
                continue
            xm = (x0 + x1) / 2 * PT_TO_MM
            ym = (page_h - (y0 + y1) / 2) * PT_TO_MM
            height_mm = max((y1 - y0) * PT_TO_MM, 1.0)
            entities.append(
                {
                    "kind": "text",
                    "text": text.strip(),
                    "x": xm,
                    "y": ym,
                    "height": height_mm,
                }
            )
    doc.close()
    return {
        "entities": entities,
        "source": "pdf",
        "file": pdf_path.name,
    }


def sibling_pdf(dwg_path):
    """PDF with the same stem as a DWG, if present."""
    dwg_path = Path(dwg_path)
    pdf = dwg_path.with_suffix(".pdf")
    return pdf if pdf.is_file() else None
