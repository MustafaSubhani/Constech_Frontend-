"""Read measurement rules from the drawing set.

Notes, schedules, and details are separate sheets. A quantity that depends on
a thickness or a cover has to come from the sheet that states it.
"""
import json
import re
import zipfile
from pathlib import Path

import pymupdf

pymupdf.TOOLS.mupdf_display_errors(False)

_BLINDING = re.compile(
    r"(?P<what>[a-z][a-z ,]*?)\s+shall be placed on (?:a\s+)?minimum\s+"
    r"(?:thickness of\s+)?(?P<mm>\d+)\s*mm (?:thick\s+)?(?:of\s+)?(?:grade\s+)?"
    r"(?P<grade>C\d+\s*/\s*\d+)?\s*(?:concrete\s+)?blinding",
    re.I,
)
_SUBJECTS = (
    ("foundations", re.compile(r"foundation|footing|raft|pile cap", re.I)),
    ("beams", re.compile(r"ground beam|grade beam|tie beam", re.I)),
    ("slabs", re.compile(r"ground slab|slab on grade|slabs on grade|ground floor slab", re.I)),
)
_FOOTING_COVER = re.compile(r"footings[\s\S]{0,120}?all\s+(\d+)", re.I)
_BLINDING_ALT = re.compile(
    r"minimum\s+thickness\s+of\s+(?P<mm>\d+)\s*mm\s+of\s+grade\s+"
    r"(?P<grade>C\d+\s*/\s*\d+)\s+concrete\s+blinding",
    re.I,
)
_NOTES_DUMP = re.compile(r"general\s+notes|typical\s+detail", re.I)
_NAME = re.compile(r"general notes|typical detail|foundation|section", re.I)


def _flatten(text):
    return re.sub(r"\s+", " ", text)


def _from_text(text, source):
    flat = _flatten(text)
    found = {}
    blind = _BLINDING.search(flat)
    if blind:
        subjects = [
            part.strip() for part in re.split(r",|\band\b", blind.group("what"))
            if part.strip()
        ]
        applies = [
            name for name, pattern in _SUBJECTS
            if any(pattern.search(subject) for subject in subjects)
        ]
    else:
        blind = _BLINDING_ALT.search(flat)
        subjects = []
        applies = ["foundations", "beams", "slabs"]
    if blind:
        found["blinding_mm"] = int(blind.group("mm"))
        found["blinding_grade"] = re.sub(r"\s+", "", blind.group("grade") or "")
        found["blinding_subjects"] = subjects
        found["blinding_applies_to"] = applies or ["foundations", "beams", "slabs"]
        found["blinding_source"] = source
    cover = _FOOTING_COVER.search(flat)
    if cover:
        found["footing_cover_mm"] = int(cover.group(1))
        found["cover_source"] = source
    return found


def _pdf_text(data):
    doc = pymupdf.open(stream=data, filetype="pdf")
    text = "\n".join(page.get_text() for page in doc)
    doc.close()
    return text


def _consider(text, source, rules):
    found = _from_text(text, source)
    for key, value in found.items():
        rules.setdefault(key, value)


def _consider_note_dumps(project, rules):
    """General-notes text from cached DWG dumps under project/out (after discover)."""
    out = Path(project) / "out"
    if not out.is_dir():
        return
    skip_names = {
        "measurements.json",
        "project-manifest.json",
        "review-queue.json",
        "manual-measurements.json",
        "measurement-overrides.json",
    }
    for path in sorted(out.glob("*.json")):
        if path.name in skip_names or not _NOTES_DUMP.search(path.stem):
            continue
        try:
            dump = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        parts = [
            e.get("text") or ""
            for e in dump.get("entities", [])
            if e.get("kind") == "text"
        ]
        if not parts:
            continue
        _consider(" ".join(parts), path.stem, rules)


def find_rules(project, search_parent_zip=True):
    """Search drawing PDFs under the project folder (and optional zip beside it)."""
    project = Path(project) if project else None
    rules = {}
    files = []
    seen = set()

    def add(path):
        if path.suffix.lower() not in {".pdf", ".zip", ".txt", ".md"}:
            return
        if "out" in path.parts or path.name.startswith("~$"):
            return
        key = str(path.resolve()).lower()
        if key in seen or not path.is_file():
            return
        seen.add(key)
        files.append(path)

    if project and project.exists():
        for path in project.rglob("*"):
            add(path)
        if search_parent_zip:
            parent = project.parent
            if parent != project:
                for path in parent.glob("*.zip"):
                    add(path)
    files.sort(key=lambda path: (
        0 if "general notes" in path.name.lower() else 1,
        0 if path.suffix.lower() == ".pdf" else 1,
        path.stat().st_size,
    ))
    for path in files:
        suffix = path.suffix.lower()
        if suffix in {".txt", ".md"}:
            _consider(path.read_text(encoding="utf-8", errors="replace"), path.name, rules)
        elif suffix == ".pdf":
            if not _NAME.search(path.name):
                continue
            _consider(_pdf_text(path.read_bytes()), path.name, rules)
        else:
            try:
                zipped = zipfile.ZipFile(path)
            except zipfile.BadZipFile:
                continue
            names = [name for name in zipped.namelist() if name.lower().endswith(".pdf") and _NAME.search(Path(name).name)]
            names.sort(key=lambda name: (0 if "general notes" in name.lower() else 1, name))
            for name in names:
                _consider(_pdf_text(zipped.read(name)), Path(name).name, rules)
                if "blinding_mm" in rules and "footing_cover_mm" in rules:
                    break
            zipped.close()
        if "blinding_mm" in rules and "footing_cover_mm" in rules:
            return rules
    if project and project.exists():
        _consider_note_dumps(project, rules)
    return rules
