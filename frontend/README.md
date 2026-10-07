# Frontend — Constech takeoff UI

React + Vite + TypeScript, TanStack Query, React Router. Icons: [Lucide](https://lucide.dev/).

## Development

Terminal 1 (API):

```powershell
cd D:\Constech\backend
py -3 -m structural_boq app --work D:\Constech\work --port 8780
```

Terminal 2 (UI with hot reload):

```powershell
cd D:\Constech\frontend
npm install
npm run dev
```

Open http://127.0.0.1:5173/ (proxies `/api` to port 8780). If 5173 is taken, `npm run dev -- --port 5180`.

## Production build (served by Python)

```powershell
cd D:\Constech\frontend
npm run build
```

Then start the backend app; it serves `dist/` automatically.

## Layout

| Path | Role |
|------|------|
| `src/styles/tokens.css` | Colour, radius and motion tokens for light and dark. Every transition uses `--dur-*` and `--ease*`. |
| `src/components/shell/` | Left rail, top bar, command palette (`Ctrl K`), shortcuts (`?`) |
| `src/components/ui/` | Dialog, menu, toast, confirm, dropzone |
| `src/components/brand/` | Logo and the isometric frame used on sign-in and the loader |
| `src/components/workspace/` | Sheet canvas (select, draw, reshape), inspector, evidence crops |
| `src/components/formula/` | Formula editor that renders expressions as maths and edits dimensions as variables |
| `src/components/pipeline/` | Staged pipeline view shown when a project opens |
| `src/assistant/`, `src/components/assistant/` | Assistant contract and docked panel (not connected) |
| `src/pages/project/` | Drawings, bill comparison, rates, schedules and inputs, pipeline |
| `src/lib/formula.ts` | Same formula grammar as `backend/structural_boq/formula.py`, for live previews |

Legacy static UI is in `legacy/` for reference only.
