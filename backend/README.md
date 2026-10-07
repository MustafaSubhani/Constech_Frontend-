# Backend — structural BOQ engine

Python package, DWG dump helper, diagnostics scripts, and tests.

| Path | Role |
|------|------|
| `structural_boq/` | Importable package: discover, measure, compare, HTTP API |
| `dwg_dump/` | Node script to dump DWG geometry to JSON |
| `scripts/` | One-off audits and diagnostics |
| `tests/` | Verification scripts |

Drawing sets and outputs: **`../work/<project>/`**.

## Run

```powershell
cd D:\Constech\backend
py -3 -m structural_boq app --work D:\Constech\work --port 8780
```

Build the React UI once (`cd ../frontend && npm install && npm run build`), then open http://127.0.0.1:8780/ (serves `../frontend/dist/`). For dev with hot reload, use `npm run dev` in `frontend/` (see frontend README).

Commands: `discover`, `foundations`, `structure`, `validate`, `workspace`.
