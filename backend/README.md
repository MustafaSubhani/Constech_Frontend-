# Backend — structural BOQ engine

Python package, DWG dump helper, diagnostics scripts, and tests.

| Path | Role |
|------|------|
| `structural_boq/` | Importable package: discover, measure, compare, HTTP API |
| `dwg_dump/` | Node script to dump DWG geometry to JSON |
| `scripts/` | One-off audits and diagnostics |
| `tests/` | Verification scripts |

Drawing sets and outputs: **`../work/<project>/`**.

## Setup

```powershell
py -3 -m pip install -r requirements.txt
```

`shapely` is required for sheet outlines (slabs, beams, footing unions). Without it the workspace has no outlines.

## Run

```powershell
cd D:\Constech\backend
py -3 -m structural_boq app --work D:\Constech\work --port 8780
```

Build the React UI once (`cd ../frontend && npm install && npm run build`), then open http://127.0.0.1:8780/ (serves `../frontend/dist/`). For dev with hot reload, use `npm run dev` in `frontend/` (see frontend README).

Commands: `discover`, `foundations`, `structure`, `validate`, `workspace`.

## App modules

| Module | Role |
|--------|------|
| `app_server.py` | HTTP API and static files. Caches payloads by file fingerprint. |
| `pipeline.py` | Staged runs (files, discover, foundations, structure, sheet views, compare) in a background thread with live status and engine log lines. |
| `frontend_adapter.py` | Engine outputs to the UI schema, including QS edits, outline overrides and bill selection. |
| `workspace.py` | Sheet rasters, fitted outlines and evidence boxes (where each value was read on the printed sheet). |
| `bill_lines.py` | Bill line traceability, overrides, custom and hidden lines, and how element edits move line totals. |
| `bill_source.py` | Bills found in the project or uploaded to `bills/`, and the one the comparison uses. |
| `inputs.py` | Inputs register: what the drawings supplied, what is missing, what was set by hand. |
| `rates.py` | Saved rates and import from `.xlsx`/`.csv` with suggested matches. |
| `exporters.py` | Bill comparison and estimate as CSV, XLSX and PDF, for the whole project, side by side per floor or one floor, in the order sorted on screen (query `scope` is `floors` or a floor key; `sort` and `dir` follow the table). |
| `floors.py` | Splits each line's measured quantity by storey from its element records (record inputs, then the sheet's floor; substructure as Foundations). Whatever the records do not account for is shown as "Not split by floor", never spread. |
| `sheets.py` | Finds sheets by role, floor and content (plans per storey, reinforcement plans, schedules, sections) instead of by a project's sheet numbers. |
| `formula.py` | Safe arithmetic for QS formulas (numbers, variables, `+ - * / ^`, `min max abs round sqrt`). |
| `agent.py`, `assistant/` | Optional assistant (Claude, OpenAI or a local OpenAI-compatible server) with read and propose tools. It is off by default. Configure it in Settings; the configuration is kept in `~/.constech/assistant.json` (or `CONSTECH_ASSISTANT_CONFIG`), and environment variables (`CONSTECH_ASSISTANT`, `CONSTECH_LLM_PROVIDER`, `CONSTECH_LLM_MODEL`, `CONSTECH_LLM_BASE_URL`, `CONSTECH_LLM_API_KEY`) take precedence. The key never reaches the browser. Proposals change nothing until accepted, and every accepted proposal can be undone. Needs `pip install anthropic` or `pip install openai` for the chosen provider. |

## Files the app writes in `out/`

| File | Content |
|------|---------|
| `measurement-overrides.json` | QS changes to element quantities (with formula and reason) and removed elements |
| `manual-measurements.json` | Elements added by hand, with their drawn outline |
| `shape-overrides.json` | Adjusted or hidden outlines |
| `bill-adjustments.json` | Line overrides, lines added by hand, hidden lines |
| `bill-selection.json` | The bill the comparison is measured against |
| `project-inputs.json` | Values set by hand (blinding thickness, footing cover); used by the engine through `rules.find_rules` |
| `rates.json` | Currency, overheads and profit, and rates per line |
| `pipeline-state.json` | Outcome of the last run of each engine stage |
| `sheet-roles.json` | Sheet roles confirmed by the QS (or accepted from the assistant); discovery applies them on the next run |
| `assistant/` | Assistant threads and proposals with their undo snapshots |
