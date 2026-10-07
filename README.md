# Constech — structural quantity takeoff

## Repository layout

```
Constech/
  README.md
  frontend/          ← takeoff UI (React + Vite; run `npm run build` before production)
  backend/           ← Python engine, dwg_dump, scripts, tests
  work/              ← project folders (DWGs, bills, out/)
  docs/              ← evaluation notes and reports
  data/archives/     ← original zip deliveries (backup only)
```

## Projects (`work/`)

| Folder | Purpose |
|--------|---------|
| `khanna-villa` | Khanna 269 — tender subset, bill compare |
| `khanna-villa-dd` | Khanna 269 — full DD set |
| `project-2099` | Tower 2099 — cross-job regression |

## Quick start

```powershell
cd D:\Constech\backend
py -3 -m structural_boq app --work D:\Constech\work --port 8780
```

See [backend/README.md](backend/README.md) and [frontend/README.md](frontend/README.md).

**GitHub:** [Constech_Frontend-](https://github.com/MustafaSubhani/Constech_Frontend-) (monorepo: `frontend/`, `backend/`, `work/`, `docs/`). Original zip deliveries under `data/archives/` are local-only (~5GB) and are not pushed.

If an empty legacy `tools/` or `structural_boq/` folder remains, delete it after closing terminals that used the old paths.
