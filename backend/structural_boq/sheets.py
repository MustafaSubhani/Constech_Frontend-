"""Find the sheets a measurement needs by role, floor and content, never by a project's sheet numbers.

Drawing sets name and number sheets differently (S-101-A, GF-01, L00 GA PLAN, 2304-ST-110...).
This index classifies every DWG and PDF once, using the discovery manifest when it exists
(title block text and content signals) and the file name otherwise, and answers questions like
"the reinforcement plan for the first floor" or "the column schedule".
"""
import json
import re
from pathlib import Path

_SKIP = {"out", "node_modules", ".git", "bills", "rates"}

# Ordered from the lowest storey up. Plans are paired with the next storey present, not the next name.
FLOOR_ORDER = (
    "basement3", "basement2", "basement", "lower_ground", "ground", "mezzanine",
    "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
    "roof", "upper",
)

_ORDINALS = ("first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth")
_SUFFIX = {1: "ST", 2: "ND", 3: "RD"}


def _floor_patterns():
    pats = [
        (r"\bUPPER\s+ROOF\b|\bTOP\s+ROOF\b|\bROOF\s+TOP\b|\bSTAIR\s*ROOF\b|\bHEAD\s*ROOM\b", "upper"),
        (r"\bROOF\b", "roof"),
        (r"\b(?:THIRD|3RD)\s+BASEMENT\b|\bB3\b", "basement3"),
        (r"\b(?:SECOND|2ND)\s+BASEMENT\b|\bB2\b", "basement2"),
        (r"\bBASEMENT\b|\bB1\b|\bCELLAR\b", "basement"),
        (r"\bLOWER\s+GROUND\b|\bLGF\b", "lower_ground"),
        (r"\bMEZZ(?:ANINE)?\b", "mezzanine"),
        (r"\bGROUND\b|\bG\.?F\.?\b|\bLEVEL\s*0+\b|\bL\s*0+\b|\bPODIUM-?1\b", "ground"),
    ]
    for n, word in enumerate(_ORDINALS, start=1):
        suffix = _SUFFIX.get(n, "TH")
        pats.append((rf"\b{word.upper()}\b|\b{n}{suffix}\b|\bLEVEL\s*0?{n}\b|\bL\s*0?{n}\b|\b{n}F\b", word))
    return [(re.compile(p, re.I), key) for p, key in pats]


_FLOOR_PATTERNS = _floor_patterns()


def floor_of(text):
    """Storey named in a sheet name or title ('' when none is named)."""
    flat = re.sub(r"[_\-]+", " ", text or "")
    for pattern, key in _FLOOR_PATTERNS:
        if pattern.search(flat):
            return key
    return ""


def floor_rank(floor):
    return FLOOR_ORDER.index(floor) if floor in FLOOR_ORDER else len(FLOOR_ORDER)


_EXCLUDE_FROM_PLANS = re.compile(r"LOADING|SCHEDULE|SECTION|TYPICAL|STAIR|DETAIL|ELEVATION|NOTES|FOUNDATION|FOOTING|PILE", re.I)
_PLAN_WORDS = re.compile(r"FRAMING|FLOOR\s*PLAN|SLAB\s*PLAN|STRUCTURAL\s*PLAN|GENERAL\s*ARRANGEMENT|\bG\.?A\.?\b|\bPLAN\b", re.I)
_REINF_WORDS = re.compile(r"REINF|\bRFT\b|REBAR|\bBBS\b|TOP\s+STEEL|BOTTOM\s+STEEL", re.I)


class SheetIndex:
    def __init__(self, project):
        self.project = Path(project)
        self.out_dir = self.project / "out"
        manifest = {}
        path = self.out_dir / "project-manifest.json"
        if path.is_file():
            try:
                manifest = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                manifest = {}
        by_stem = {s.get("stem"): s for s in manifest.get("sheets") or [] if s.get("stem")}
        from .discovery import _stem_meta

        self.sheets = []
        seen = set()
        for path in sorted(self.project.rglob("*")):
            if not path.is_file() or path.suffix.lower() not in (".dwg", ".pdf"):
                continue
            if set(path.relative_to(self.project).parts) & _SKIP or path.name.startswith(("~$", "._")):
                continue
            if path.stem in seen and path.suffix.lower() == ".pdf":
                continue  # the DWG of the same sheet is the geometry source
            seen.add(path.stem)
            entry = by_stem.get(path.stem) or _stem_meta(path.stem)
            title = entry.get("title") or ""
            label = f"{path.stem} {title}"
            self.sheets.append({
                "path": path,
                "stem": path.stem,
                "role": entry.get("role") or "other",
                "signals": set(entry.get("signals") or []),
                "floor": floor_of(path.stem) or floor_of(title),
                "label": label.upper(),
            })

    def _load(self, sheet):
        from .foundations import ensure_dump, ensure_geometry_dump

        dump_path = self.out_dir / f"{sheet['stem']}.json"
        if sheet["path"].suffix.lower() == ".dwg":
            return ensure_dump(sheet["path"], dump_path)
        return ensure_geometry_dump(sheet["path"], dump_path)

    def load(self, sheet):
        if not sheet:
            return None
        dump = self._load(sheet)
        return dump

    def plans(self):
        """Floor or framing plans with a storey, lowest first. One per storey; DWG beats PDF."""
        picked = {}
        for sheet in self.sheets:
            if not sheet["floor"] or _REINF_WORDS.search(sheet["label"]):
                continue
            if sheet["path"].suffix.lower() != ".dwg":
                continue  # plan measurement needs vector outlines; PDF dumps carry text only
            role_ok = sheet["role"] in ("floor_plan", "framing_plan", "structural_plan")
            name_ok = _PLAN_WORDS.search(sheet["label"]) and not _EXCLUDE_FROM_PLANS.search(sheet["stem"])
            if not (role_ok or name_ok):
                continue
            picked.setdefault(sheet["floor"], sheet)
        return sorted(picked.values(), key=lambda s: floor_rank(s["floor"]))

    def reinforcement(self, floor):
        hits = [
            s for s in self.sheets
            if s["floor"] == floor and (s["role"] == "reinforcement_plan" or _REINF_WORDS.search(s["label"]))
            and "SCHEDULE" not in s["label"] and "SECTION" not in s["label"]
        ]
        return hits[0] if hits else None

    def foundation(self):
        hits = [s for s in self.sheets if s["role"] in ("foundation_plan", "foundation_layout")]
        if not hits:
            hits = [s for s in self.sheets if re.search(r"FOUNDATION|FOOTING", s["label"]) and "SCHEDULE" not in s["label"]]
        hits.sort(key=lambda s: (
            0 if "footing_schedule_table" in s["signals"] else 1,
            0 if s["role"] == "foundation_plan" else 1,
            0 if s["path"].suffix.lower() == ".dwg" else 1,
        ))
        return hits[0] if hits else None

    def _schedule_for(self, word, role):
        hits = [s for s in self.sheets if s["role"] == role]
        if not hits:
            pattern = re.compile(rf"\b{word}S?\b.*\b(SCHEDULE|DETAILS?|REINF)|\b(SCHEDULE|DETAILS?)\b.*\b{word}S?\b")
            hits = [s for s in self.sheets if pattern.search(s["label"]) and not s["floor"]]
        hits.sort(key=lambda s: (0 if s["path"].suffix.lower() == ".dwg" else 1, s["stem"]))
        return hits[0] if hits else None

    def column_schedule(self):
        return self._schedule_for("COLUMN", "column_schedule")

    def wall_schedule(self):
        return self._schedule_for("WALL", "wall_schedule")

    def sections(self):
        hits = [s for s in self.sheets if s["role"] == "section_detail"]
        if not hits:
            hits = [s for s in self.sheets if re.search(r"\bSECTIONS?\b", s["label"])]
        return sorted(hits, key=lambda s: s["stem"])
