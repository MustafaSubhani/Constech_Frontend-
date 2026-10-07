# Frontend — Constech takeoff UI

React + Vite + TypeScript. Icons: [Lucide](https://lucide.dev/).

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

Open http://127.0.0.1:5173/ (proxies `/api` to port 8780).

## Production build (served by Python)

```powershell
cd D:\Constech\frontend
npm run build
```

Then start the backend app; it serves `dist/` automatically.

Legacy static UI is in `legacy/` for reference only.
