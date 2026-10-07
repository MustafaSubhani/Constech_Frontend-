# Cross-project BOQ engine check

Runs on **2026-10-05** using `py -3 -m structural_boq` from `D:\Constech\backend`.

Each project folder can build a **capability manifest** (no hardcoded villa/tower profiles):

```powershell
py -3 -m structural_boq discover --project D:\Constech\work\project-2099
```

Writes `out/project-manifest.json` (sheet roles, signals, plan↔reinf pairs, ready/partial/blocked capabilities). The workspace refreshes this register when DWGs are newer than the manifest.

## Projects tested

| Folder | Source | Role |
|--------|--------|------|
| `khanna-villa` | Tender subset (13 DWGs) | Trained / tuned baseline |
| `khanna-villa-dd` | Full DD zip (29 DWGs, incl. S-202, S-400, typicals) | Same job, **unseen sheet set** |
| `project-2099` | Tower **2099** (9 DWGs in folder — full set for this tool) | **Different job**, pile caps + PT framing |

Bill workbook (Khanna Bill No. 2) was attached only for the two 269 projects. **2099 has no matching bill in this workspace** — do not compare 2099 numbers to Bill No. 2.

**Scope rule:** Each run uses **only** the DWGs/PDFs under that project folder (`D:\Constech\work\<project>\`). There is no fallback to drawings outside the folder; if a schedule is on another sheet **inside the same folder**, the engine must join them there (e.g. 2099: **S-514** sizes + **S-201** layout).

---

## Khanna DD package (269) — stability

**Foundations** on `khanna-villa-dd` match the tuned subset exactly (footings, raft, blinding, rebar within the same ±1–2% band).

**Structure** outputs are **byte-for-byte identical** to `khanna-villa` on every bill line (columns, slabs, beams, walls, tank, etc.).

Extra sheets (S-202 core/shear walls, S-400 stairs, S-010–S-019 typicals, S-105 loading) are dumped but **not wired into quantity rules yet**, so adding them does not change totals. That is expected until wall steel and stair beams consume S-202 / S-400.

**Conclusion:** Same drawing family + same plan/foundation sheets → **reproducible** results. Generalisation across *more sheets of the same villa* is fine; generalisation across *drawing conventions* is not tested here.

---

## Project 2099 (tower) — unseen conventions

### DWG read

- LibreDWG returns non-fatal open warnings (codes 64/68) on many files; dumps still write JSON after a **hatch-edge guard** fix in `dwg_dump/dump.mjs`.
- **No closed `S-SLAB` polylines** on framing plans (`closed=0` on slab layers); slabs are PT/decomposed geometry, not Khanna-style closed outlines.

### Foundations

```
No sheet had a footing schedule
```

- `2099-S-201-FOUNDATION LAYOUT` is **piles / pile caps**, not an isolated footing table (`F1`, `FC1`, …).
- `2099-S-514-BEAMS AND PILE CAPS SCHEDULES` is not parsed as a footing schedule today.

### Structure (9 DWGs copied)

All measured totals **0** (no SSL spot levels, no `SLAB THK = xxx mm` notes, no `GB1(250X400)` beam labels).

Observed on S-300 instead:

- Post-tensioned slab notes, double-slab TOC levels (`+0.30`, `-1.10`), beam marks like `A1`, `RT6`, `C9`.
- Floor naming: `1ST FLOOR`, `2ND FLOOR`, `FRAMING PLAN` — `_floor_of()` only knows `GROUND` / `FIRST` / `ROOF` / `UPPER`.

**Conclusion:** The engine is **Khanna-shaped**. On 2099 it **fails open to zero** rather than inventing quantities — good for safety, bad for coverage. **`discover`** should report `footings_pile_caps` (partial), blocked `slabs_villa_style`, and partial `storey_heights` — adapters for pile caps, PT slabs, and TOC/FFL levels are still to build.

---

## What would generalise vs what is villa-specific

| Capability | Khanna 269 | 2099 tower |
|------------|------------|------------|
| Footing schedule + pad outlines | Yes | No — pile caps |
| `SLAB THK = n mm` regions | Yes | No — PT / narrative notes |
| `±x.xx SSL` storey heights | Yes | No |
| `GB/FB/RB(250X400)` beams | Yes | No — other mark systems |
| W1–W3 wall hatches | Partial | Not seen |
| Tank/lift hatch annulus | Yes (269 S-100) | Not tested (different foundation sheet) |
| Bill line matching | Yes (Bill No. 2) | N/A |

---

## Suggested next steps for true multi-project support

1. Use **`discover` / `project-manifest.json`** to gate which modules run (capabilities), not a trained villa-vs-tower classifier.
2. **Foundation module** for pile-cap schedules (S-514-style tables).
3. **Framing plans** as first-class inputs (`structure._load_plans` now accepts `FRAMING PLAN` / `FLOOR PLAN`).
4. **Level discovery** from manifest `level_marks` (TOC/FFL), not only `SSL`.
5. Keep **2099** as the regression project alongside **269**.

Outputs:

- `work/project-2099/out/*.json` — dumps for manual inspection
- `work/khanna-villa-dd/out/foundations-compare.csv` — matches baseline
- `work/khanna-villa-dd/out/structure-compare.csv` — matches baseline
