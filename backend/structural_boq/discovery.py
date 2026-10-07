"""Discover what a drawing set supports before measuring quantities.

The manifest is built from filenames, title-block text, and lightweight scans
of each DWG dump. Nothing here names a project or picks a hardcoded profile.
"""
import json
import re
from pathlib import Path

from .foundations import (
    SIZE_RE,
    _schedule_titles,
    _texts,
    ensure_dump,
    ensure_pdf_dump,
    _find_bill,
)
from .rules import find_rules

_PDF_DRAWING = re.compile(
    r"SCHEDULE|FOUNDATION|FOOTING|FRAMING|FLOOR\s*PLAN|REINF|GENERAL\s+NOTES|"
    r"SECTION|TYPICAL|LAYOUT|S-\d{3}",
    re.I,
)
_SCHEDULE_ROLES = {
    "footing_schedule",
    "pile_cap_schedule",
    "beam_schedule",
    "column_schedule",
    "wall_schedule",
}

SSL = re.compile(r"([+-]?\d+\.\d+)\s*SSL\b", re.I)
LEVEL = re.compile(
    r"(?:^|\s)([+-]?\d+\.\d+)\s*(?:SSL|FFL|FL|RL|TOC|DMD|B\.O\.F|T\.O\.F)\b|"
    r"TOC\s*\(([+-]?\d+\.\d+)\)|T\.O\.C\s*([+-]?\d+\.\d+)",
    re.I,
)
SLAB_THK = re.compile(r"SLAB(?:\s+ON\s+GRADE)?\s+THK\s*=\s*(\d+)\s*mm", re.I)
SLAB_THK_ALT = re.compile(r"(?:lower|upper)\s+slab\s+(\d+)\s*mm|SLAB\s+THICKNESS", re.I)
BEAM_SIZED = re.compile(r"^[A-Z]+\d*\(\d+[xX]\d+", re.I)
BEAM_GENERIC = re.compile(r"^[A-Z]{1,3}\d+[A-Z]?[-(]", re.I)
W_MARK = re.compile(r"^W\d+$")
FOOTING_SCHEDULE = re.compile(r"FOOTING", re.I)
PILE_CAP_SCHEDULE = re.compile(r"PILE\s*CAP|PILES?\s+LAYOUT", re.I)
BEAM_SCHEDULE = re.compile(r"BEAM", re.I)
COLUMN_SCHEDULE = re.compile(r"COLUMN", re.I)
WALL_SCHEDULE = re.compile(r"WALL", re.I)
REINF = re.compile(r"REINF", re.I)
FRAMING = re.compile(r"FRAMING|FLOOR\s+PLAN", re.I)
FOUNDATION = re.compile(r"FOUNDATION|FOOTING", re.I)
SECTION = re.compile(r"SECTION", re.I)
TYPICAL = re.compile(r"TYPICAL|DETAIL", re.I)
NOTES = re.compile(r"GENERAL\s+NOTES", re.I)
STAIR = re.compile(r"STAIR", re.I)
LOADING = re.compile(r"LOADING", re.I)

SHEET_NO = re.compile(r"(?<![A-Z0-9])([A-Z]{1,4})[-_ ]?(\d{2,4})(?:[-_ ]([A-Z0-9]{1,2}))?(?![A-Z0-9])")
_ELEMENT_DETAIL = re.compile(r"SCHEDULE|DETAILS?\b|\bREINF")
# Cross references written on drawings, e.g. "CONCRETE COLUMN PER SCHEDULE/S-201", "SEE BEAM SCHEDULE ON DWG ST-210".
CROSS_REF = re.compile(
    r"\b(FOOTING|FOUNDATION|PILE\s*CAP|BEAM|COLUMN|WALL|SLAB)S?\b[^/\n]{0,40}?\b(?:PER|SEE|REFER(?:\s+TO)?|AS\s+PER)\b"
    r"[^/\n]{0,20}?\bSCHEDULE\b\s*(?:/|ON|IN|SHEET|DWG|DRAWING|NO\.?)?\s*"
    r"((?:[A-Z]{1,4}[-_ ]?\d{2,4}(?:[-_ ][A-Z0-9]{1,2})?))",
    re.I,
)
_REF_ROLE = {
    "FOOTING": "footing_schedule", "FOUNDATION": "footing_schedule", "PILECAP": "pile_cap_schedule",
    "BEAM": "beam_schedule", "COLUMN": "column_schedule", "WALL": "wall_schedule", "SLAB": "slab_schedule",
}


def _sheet_number(upper):
    """Drawing number such as S-101-A, ST-110 or GA02 from a sheet name; ('', '') when none."""
    for match in SHEET_NO.finditer(upper):
        prefix, number, variant = match.groups()
        if prefix in {"T", "PT", "THK", "MM", "X"}:
            continue
        return number, (variant or "")
    return "", ""


def _stem_meta(stem):
    from .sheets import floor_of

    upper = stem.upper()
    floor = floor_of(upper)
    role = "other"
    if NOTES.search(upper):
        role = "general_notes"
    elif SECTION.search(upper):
        role = "section_detail"
    elif TYPICAL.search(upper) and not FRAMING.search(upper) and not (
        _ELEMENT_DETAIL.search(upper) and (COLUMN_SCHEDULE.search(upper) or WALL_SCHEDULE.search(upper) or BEAM_SCHEDULE.search(upper))
    ):
        role = "typical_detail"
    elif STAIR.search(upper):
        role = "stair_detail"
    elif LOADING.search(upper):
        role = "loading_plan"
    elif PILE_CAP_SCHEDULE.search(upper) and "SCHEDULE" in upper:
        role = "pile_cap_schedule"
    elif FOOTING_SCHEDULE.search(upper) and "SCHEDULE" in upper:
        role = "footing_schedule"
    elif BEAM_SCHEDULE.search(upper) and "SCHEDULE" in upper:
        role = "beam_schedule"
    elif COLUMN_SCHEDULE.search(upper) and _ELEMENT_DETAIL.search(upper) and not floor:
        role = "column_schedule"
    elif WALL_SCHEDULE.search(upper) and _ELEMENT_DETAIL.search(upper) and not floor:
        role = "wall_schedule"
    elif REINF.search(upper):
        role = "reinforcement_plan"
    elif FOUNDATION.search(upper) and "LAYOUT" in upper:
        role = "foundation_layout"
    elif FOUNDATION.search(upper):
        role = "foundation_plan"
    elif FRAMING.search(upper) or "FLOOR PLAN" in upper:
        role = "framing_plan" if "FRAMING" in upper else "floor_plan"
    elif floor and re.search(r"\bPLAN\b|\bG\.?A\.?\b|GENERAL\s+ARRANGEMENT|SLAB", upper):
        role = "floor_plan"

    sheet_no, variant = _sheet_number(upper)

    return {
        "stem": stem,
        "role": role,
        "floor": floor,
        "sheet_no": sheet_no,
        "variant": variant,
    }


def _title_block_line(dump, stem):
    for text in _texts(dump):
        flat = text["text"].replace("\n", " ").strip()
        if stem.split("-")[0] in flat or flat.startswith(stem[:12]):
            return flat[:120]
        if re.search(r"S-\d{3}", flat) and len(flat) < 80:
            return flat
    return ""


def _scan_dump(dump):
    texts = [_flatten(t["text"]) for t in _texts(dump)]
    joined = " ".join(texts)
    signals = []
    if _schedule_titles(dump):
        signals.append("footing_schedule_table")
    if PILE_CAP_SCHEDULE.search(joined) and "SCHEDULE" in joined.upper():
        signals.append("pile_cap_schedule_title")
    if any(SLAB_THK.search(t) for t in texts):
        signals.append("slab_thk_notes")
    if SLAB_THK_ALT.search(joined):
        signals.append("slab_thickness_text")
    if SSL.search(joined):
        signals.append("ssl_spot_levels")
    if LEVEL.search(joined) and "ssl_spot_levels" not in signals:
        signals.append("other_level_marks")
    if any(BEAM_SIZED.match(t.replace(" ", "")) for t in texts):
        signals.append("beam_labels_sized")
    elif any(BEAM_GENERIC.match(t.replace(" ", "")) for t in texts if len(t) < 20):
        signals.append("beam_labels_other")
    if any(W_MARK.match(t.strip()) for t in texts):
        signals.append("wall_marks")
    if "LIFT PIT" in joined.upper():
        signals.append("lift_pit_note")
    if "RAFT THK" in joined.upper():
        signals.append("raft_thk_notes")
    size_cells = sum(1 for t in texts if SIZE_RE.search(t))
    if size_cells >= 4:
        signals.append("size_table_cells")

    closed_slab = sum(
        1 for e in dump.get("entities", [])
        if e.get("kind") == "polyline" and e.get("closed")
        and "SLAB" in (e.get("layer") or "").upper()
    )
    if closed_slab:
        signals.append("closed_slab_polylines")

    ssl_values = sorted({round(float(m.group(1)), 2) for m in SSL.finditer(joined)})
    level_values = sorted({
        round(float(g), 2)
        for m in LEVEL.finditer(joined)
        for g in m.groups() if g
    })

    text_entities = len(_texts(dump))
    source_format = dump.get("source") or "dwg"
    needs_ocr = source_format == "pdf" and text_entities == 0

    references = {}
    for text in texts:
        for match in CROSS_REF.finditer(text):
            element = re.sub(r"\s+", "", match.group(1).upper())
            token = re.sub(r"[_ ]", "-", match.group(2).upper())
            references.setdefault((element, token), match.group(0)[:80])

    return {
        "references": [{"element": e, "token": t, "text": s} for (e, t), s in sorted(references.items())],
        "signals": sorted(set(signals)),
        "ssl_levels": ssl_values,
        "level_marks": level_values[:20],
        "closed_slab_polylines": closed_slab,
        "text_entity_count": text_entities,
        "source_format": source_format,
        "needs_ocr": needs_ocr,
    }


def _flatten(text):
    return re.sub(r"\s+", " ", text or "").strip()


def _sheet_modules(entry):
    """Which engine modules consume this sheet."""
    role = entry.get("role") or "other"
    signals = set(entry.get("signals") or [])
    mods = []
    if role == "footing_schedule" or "footing_schedule_table" in signals:
        mods.append("foundations.schedule")
    if role in ("foundation_plan", "foundation_layout"):
        mods.append("foundations.layout")
    if role == "pile_cap_schedule" or "pile_cap_schedule_title" in signals:
        mods.append("foundations.pile_caps")
    if role in ("floor_plan", "framing_plan"):
        mods.extend(["structure.slabs", "structure.columns", "structure.beams"])
        if "wall_marks" in signals:
            mods.append("structure.walls")
        if "lift_pit_note" in signals:
            mods.append("structure.lift_pit")
    if role == "reinforcement_plan":
        mods.append("structure.rebar")
    if role == "section_detail":
        mods.append("structure.sections")
    if role == "wall_schedule":
        mods.append("structure.wall_schedule")
    if role == "beam_schedule":
        mods.append("structure.beam_schedule")
    if role == "column_schedule":
        mods.append("structure.column_schedule")
    if role == "general_notes":
        mods.append("rules.general_notes")
    return sorted(set(mods))


def _project_files(project):
    skip = {"out", "node_modules", ".git"}
    files = []
    leading = {}
    drawings = 0
    for path in sorted(project.rglob("*")):
        if not path.is_file() or set(path.parts) & skip or path.name.startswith("~$"):
            continue
        rel = str(path.relative_to(project))
        files.append({"name": path.name, "path": rel})
        if path.suffix.lower() in (".dwg", ".pdf"):
            drawings += 1
            token = re.split(r"[-_ ]", path.stem.upper(), maxsplit=1)[0]
            if token:
                leading[token] = leading.get(token, 0) + 1
    # A job number shared by most drawing names (e.g. "2304-ST-110"), whatever it is.
    prefixes = sorted(t for t, n in leading.items() if drawings >= 3 and n >= 0.6 * drawings and any(ch.isdigit() for ch in t))
    return {
        "file_count": len(files),
        "drawing_prefixes": prefixes,
        "has_bill_workbook": any("bill" in f["name"].lower() for f in files),
        "has_courtyard_workbook": any(
            "courtyard" in f["name"].lower()
            or ("quantity takeoff" in f["name"].lower() and "structural" in f["name"].lower())
            for f in files
        ),
    }


_JOIN_ROLES = (
    ("foundation", ("foundation_plan", "foundation_layout"), ["foundations.layout"]),
    ("footing schedule", ("footing_schedule",), ["foundations.schedule"]),
    ("column schedule", ("column_schedule",), ["structure.column_schedule"]),
    ("wall schedule", ("wall_schedule",), ["structure.wall_schedule"]),
    ("beam schedule", ("beam_schedule",), ["structure.beam_schedule"]),
    ("sections", ("section_detail",), ["structure.sections"]),
)


def _sheet_join_graph(sheets):
    """Which sheet each engine module will read, found by role (not by a project's sheet numbers)."""
    joins = []
    for name, roles, modules in _JOIN_ROLES:
        hits = [s for s in sheets if s.get("role") in roles]
        joins.append({
            "token": name,
            "stem": hits[0]["stem"] if hits else "",
            "stems": [s["stem"] for s in hits],
            "modules": modules,
            "present": bool(hits),
        })
    for r in sheets:
        if r.get("role") == "reinforcement_plan":
            joins.append({
                "token": f"reinforcement {r.get('floor') or 'unassigned'}",
                "stem": r["stem"],
                "stems": [r["stem"]],
                "modules": ["structure.rebar"],
                "present": True,
            })
    return joins


def _apply_role_corrections(project, sheets):
    """Roles confirmed by the QS (directly or by accepting an assistant proposal) win over detection."""
    path = Path(project) / "out" / "sheet-roles.json"
    if not path.is_file():
        return
    try:
        roles = json.loads(path.read_text(encoding="utf-8")).get("roles") or {}
    except (json.JSONDecodeError, OSError):
        return
    for entry in sheets:
        fix = roles.get(entry.get("stem"))
        if not fix:
            continue
        entry["role"] = fix.get("role") or entry.get("role")
        if fix.get("floor"):
            entry["floor"] = fix["floor"]
        entry["role_source"] = fix.get("reason") or "set by the QS"


def _refine_from_content(entry):
    """Use what is drawn on the sheet when the file name says too little."""
    from .sheets import floor_of

    if not entry.get("floor") and entry.get("title"):
        entry["floor"] = floor_of(entry["title"])
    if entry.get("role") not in ("other", "typical_detail"):
        return
    signals = set(entry.get("signals") or [])
    title = (entry.get("title") or "").upper()
    if "footing_schedule_table" in signals:
        entry["role"] = "footing_schedule"
        entry["role_source"] = "footing schedule table found on the sheet"
    elif "pile_cap_schedule_title" in signals:
        entry["role"] = "pile_cap_schedule"
        entry["role_source"] = "pile cap schedule title found on the sheet"
    elif entry.get("floor") and signals & {"slab_thk_notes", "closed_slab_polylines"} and "REINF" not in title:
        entry["role"] = "floor_plan"
        entry["role_source"] = "slab notes or slab outlines on a storey sheet"


def _resolve_references(sheets):
    """Turn 'PER SCHEDULE/S-201' notes into roles on the referenced sheets.

    A sheet named "COLUMNS REINF. DETAILS" that every plan calls the column schedule is the
    column schedule, whatever its title says. Returns the resolved links for the manifest.
    """
    links = []
    for sheet in sheets:
        for ref in sheet.get("references") or []:
            role = _REF_ROLE.get(ref["element"])
            if not role:
                continue
            token = ref["token"]
            number, variant = _sheet_number(token)
            target = None
            for other in sheets:
                if other is sheet:
                    continue
                if token in other["stem"].upper().replace("_", "-").replace(" ", "-"):
                    target = other
                    break
                if number and other.get("sheet_no") == number and (not variant or other.get("variant") == variant):
                    target = target or other
            links.append({
                "from": sheet["stem"],
                "element": ref["element"].lower(),
                "role": role,
                "token": token,
                "stem": target["stem"] if target else "",
                "text": ref.get("text", ""),
            })
            if target and not target.get("floor") and target.get("role") in ("other", "typical_detail", "reinforcement_plan", "section_detail"):
                target["role"] = role
                target["role_source"] = f"referenced as the {ref['element'].lower()} schedule on {sheet['stem']}"
    unique = {}
    for link in links:
        unique.setdefault((link["role"], link["token"], link["stem"]), link)
    return list(unique.values())


def _pair_plans(sheets):
    """Pair structural plans with reinforcement sheets by sheet number and floor."""
    plans = [s for s in sheets if s["role"] in ("floor_plan", "framing_plan", "foundation_plan")]
    reinf = [s for s in sheets if s["role"] == "reinforcement_plan"]
    pairs = []
    used = set()
    for plan in plans:
        best = None
        for r in reinf:
            if r["stem"] in used:
                continue
            score = 0
            if plan["sheet_no"] and plan["sheet_no"] == r["sheet_no"]:
                score += 3
            if plan["floor"] and plan["floor"] == r["floor"]:
                score += 2
            if plan["stem"][:8] == r["stem"][:8]:
                score += 1
            if score and (best is None or score > best[0]):
                best = (score, r)
        partner = best[1] if best else None
        if partner:
            used.add(partner["stem"])
        pairs.append({
            "plan": plan["stem"],
            "reinf": partner["stem"] if partner else "",
            "floor": plan["floor"] or partner["floor"] if partner else "",
            "confidence": "high" if best and best[0] >= 3 else "medium" if best else "none",
        })
    for r in reinf:
        if r["stem"] not in used:
            pairs.append({
                "plan": "",
                "reinf": r["stem"],
                "floor": r["floor"],
                "confidence": "unpaired",
            })
    return pairs


def _pdf_indexable(path):
    """PDF drawing sheets worth dumping; skip bills and takeoff workbooks."""
    name = path.name.lower()
    if name.startswith("~$") or "bill" in name and "schedule" not in name:
        return False
    if "courtyard" in name or ("quantity takeoff" in name and "structural" in name):
        return False
    meta = _stem_meta(path.stem)
    if meta["role"] != "other":
        return True
    return bool(_PDF_DRAWING.search(path.stem))


def _append_pdf_only_sheets(project, out_dir, sheets, dwg_stems, dump_json):
    skip = {"out", "node_modules", ".git"}
    for pdf in sorted(project.rglob("*.pdf")):
        if set(pdf.parts) & skip or pdf.name.startswith("._"):
            continue
        if pdf.stem in dwg_stems:
            continue
        if not _pdf_indexable(pdf):
            continue
        meta = _stem_meta(pdf.stem)
        entry = {
            **meta,
            "file": pdf.name,
            "path": str(pdf),
            "source_format": "pdf",
            "signals": [],
            "ssl_levels": [],
            "level_marks": [],
            "title": "",
            "text_entity_count": 0,
            "needs_ocr": False,
        }
        if dump_json:
            dump_path = out_dir / f"{pdf.stem}.json"
            try:
                dump = ensure_pdf_dump(pdf, dump_path)
                scan = _scan_dump(dump)
                entry.update(scan)
                entry["title"] = _title_block_line(dump, pdf.stem) or pdf.stem.replace("-", " ")
            except Exception as exc:
                entry["dump_error"] = str(exc)[:200]
                entry["needs_ocr"] = True
        else:
            entry["title"] = pdf.stem.replace("-", " ")
        entry["modules"] = _sheet_modules(entry)
        sheets.append(entry)


def _capabilities(sheets, rules):
    all_signals = set()
    for s in sheets:
        all_signals.update(s.get("signals") or [])

    def has(role):
        return any(s["role"] == role for s in sheets)

    ocr_sheets = [s for s in sheets if s.get("needs_ocr")]
    pdf_sheets = [s for s in sheets if s.get("source_format") == "pdf"]
    schedule_pdf_ocr = [
        s for s in ocr_sheets
        if s.get("role") in _SCHEDULE_ROLES
        or "footing_schedule_table" in (s.get("signals") or [])
        or "size_table_cells" in (s.get("signals") or [])
    ]

    caps = []

    if schedule_pdf_ocr:
        names = ", ".join(s["stem"] for s in schedule_pdf_ocr[:4])
        extra = f" (+{len(schedule_pdf_ocr) - 4} more)" if len(schedule_pdf_ocr) > 4 else ""
        caps.append({
            "id": "footings_isolated",
            "status": "blocked",
            "reason": f"Schedule PDF(s) have no text layer (OCR required): {names}{extra}",
        })
    elif "footing_schedule_table" in all_signals or has("footing_schedule"):
        pdf_only = any(
            s.get("source_format") == "pdf"
            and (
                "footing_schedule_table" in (s.get("signals") or [])
                or s.get("role") == "footing_schedule"
            )
            for s in sheets
        )
        caps.append({
            "id": "footings_isolated",
            "status": "partial" if pdf_only else "ready",
            "reason": (
                "Footing schedule read from searchable PDF; plan outlines still need DWG (or vector PDF)"
                if pdf_only
                else "Footing schedule table found on at least one sheet"
            ),
        })
    elif "pile_cap_schedule_title" in all_signals or has("pile_cap_schedule"):
        caps.append({
            "id": "footings_pile_caps",
            "status": "partial",
            "reason": "Pile cap schedule title found; pile cap quantity rules are not implemented yet",
        })
    elif has("foundation_layout"):
        caps.append({
            "id": "footings_isolated",
            "status": "blocked",
            "reason": "Foundation layout present but no footing or pile cap schedule detected",
        })

    if "ssl_spot_levels" in all_signals:
        caps.append({
            "id": "storey_heights_ssl",
            "status": "ready",
            "reason": "SSL spot levels found on plan sheets",
        })
    elif "other_level_marks" in all_signals:
        caps.append({
            "id": "storey_heights",
            "status": "partial",
            "reason": "Level text found but not in SSL form; storey logic may not run",
        })
    else:
        caps.append({
            "id": "storey_heights",
            "status": "blocked",
            "reason": "No slab spot levels (SSL or TOC/FFL) detected",
        })

    plan_roles = {"floor_plan", "framing_plan"}
    if any(s["role"] in plan_roles for s in sheets):
        if "slab_thk_notes" in all_signals and "closed_slab_polylines" in all_signals:
            caps.append({
                "id": "slabs_outlined",
                "status": "ready",
                "reason": "SLAB THK notes and closed S-SLAB outlines",
            })
        elif "slab_thickness_text" in all_signals or "slab_thk_notes" in all_signals:
            caps.append({
                "id": "slabs",
                "status": "partial",
                "reason": "Slab thickness notes found, but no closed slab outlines on a slab layer to measure them against",
            })
        else:
            caps.append({
                "id": "slabs",
                "status": "blocked",
                "reason": "Plan sheets present but no SLAB THK = n mm notes",
            })

    if "beam_labels_sized" in all_signals:
        caps.append({
            "id": "beams_sized_labels",
            "status": "ready",
            "reason": "Beam labels with section size, e.g. GB1(250X400)",
        })
    elif "beam_labels_other" in all_signals or has("beam_schedule"):
        caps.append({
            "id": "beams",
            "status": "partial",
            "reason": "Beam marks or a beam schedule found, but plan labels do not carry section sizes such as GB1(250X400)",
        })

    if "wall_marks" in all_signals or has("wall_schedule"):
        caps.append({
            "id": "walls",
            "status": "partial" if has("wall_schedule") else "ready",
            "reason": "Wall marks on plans" + (" and wall schedule sheet" if has("wall_schedule") else ""),
        })

    if rules.get("blinding_mm"):
        caps.append({
            "id": "blinding",
            "status": "ready",
            "reason": rules.get("blinding_source", "Blinding note from general notes PDF"),
        })

    if ocr_sheets:
        names = ", ".join(s["stem"] for s in ocr_sheets[:4])
        extra = f" (+{len(ocr_sheets) - 4} more)" if len(ocr_sheets) > 4 else ""
        caps.append({
            "id": "pdf_searchable_text",
            "status": "blocked",
            "reason": f"{len(ocr_sheets)} PDF sheet(s) returned no extractable text: {names}{extra}",
        })
    elif pdf_sheets:
        caps.append({
            "id": "pdf_searchable_text",
            "status": "ready",
            "reason": f"{len(pdf_sheets)} PDF-only sheet(s) indexed with text layer",
        })

    return caps


def build_manifest(project, dump_json=True):
    project = Path(project)
    out_dir = project / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    skip = {"out", "node_modules", ".git"}
    dwgs = sorted(
        p for p in project.rglob("*.dwg")
        if not (set(p.parts) & skip) and not p.name.startswith("._")
    )
    sheets = []
    dwg_stems = set()
    for dwg in dwgs:
        dwg_stems.add(dwg.stem)
        meta = _stem_meta(dwg.stem)
        entry = {
            **meta,
            "file": dwg.name,
            "path": str(dwg),
            "source_format": "dwg",
            "signals": [],
            "ssl_levels": [],
            "level_marks": [],
            "title": "",
            "text_entity_count": 0,
            "needs_ocr": False,
        }
        if dump_json:
            dump_path = out_dir / f"{dwg.stem}.json"
            try:
                dump = ensure_dump(dwg, dump_path)
                scan = _scan_dump(dump)
                entry.update(scan)
                entry["title"] = _title_block_line(dump, dwg.stem)
            except Exception as exc:
                entry["dump_error"] = str(exc)[:200]
        else:
            entry["title"] = dwg.stem.replace("-", " ")
        entry["modules"] = _sheet_modules(entry)
        sheets.append(entry)

    _append_pdf_only_sheets(project, out_dir, sheets, dwg_stems, dump_json)
    for entry in sheets:
        _refine_from_content(entry)
    references = _resolve_references(sheets)
    _apply_role_corrections(project, sheets)
    for entry in sheets:
        entry["modules"] = _sheet_modules(entry)

    pairs = _pair_plans(sheets)
    rules = find_rules(project, search_parent_zip=False)
    bill = _find_bill(project)
    manifest = {
        "project": project.name,
        "project_path": str(project.resolve()),
        "scan_mode": "filename_only" if not dump_json else "full",
        "drawing_count": len(sheets),
        "dwg_count": len(dwgs),
        "pdf_only_count": sum(1 for s in sheets if s.get("source_format") == "pdf"),
        "bill_workbook": bill.name if bill else "",
        "rules_from_notes": {
            k: rules[k]
            for k in (
                "blinding_mm", "blinding_source", "footing_cover_mm", "cover_source",
            )
            if k in rules
        },
        "sheets": sheets,
        "plan_reinf_pairs": pairs,
        "capabilities": _capabilities(sheets, rules),
        "project_files": _project_files(project),
        "sheet_joins": _sheet_join_graph(sheets),
        "references": references,
    }
    path = out_dir / "project-manifest.json"
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest, path


def run_discover(project, quick=False):
    manifest, path = build_manifest(project, dump_json=not quick)
    pdf_only = manifest.get("pdf_only_count") or 0
    dwg_n = manifest.get("dwg_count") or manifest["drawing_count"]
    extra = f" (+{pdf_only} PDF-only)" if pdf_only else ""
    print(f"project {manifest['project']}  {dwg_n} DWG, {manifest['drawing_count']} sheets{extra}", flush=True)
    if manifest.get("bill_workbook"):
        print(f"bill {manifest['bill_workbook']}", flush=True)
    print("capabilities:", flush=True)
    for cap in manifest["capabilities"]:
        print(f"  [{cap['status']}] {cap['id']}: {cap['reason']}", flush=True)
    print("plan <-> reinf pairs:", flush=True)
    for pair in manifest["plan_reinf_pairs"][:12]:
        print(
            f"  {pair.get('plan') or '-'}  <->  {pair.get('reinf') or '-'}  "
            f"({pair.get('confidence')}, floor={pair.get('floor') or '?'})",
            flush=True,
        )
    if len(manifest["plan_reinf_pairs"]) > 12:
        print(f"  … {len(manifest['plan_reinf_pairs']) - 12} more", flush=True)
    print(f"wrote {path}", flush=True)
    return manifest
