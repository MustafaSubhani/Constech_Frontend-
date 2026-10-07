# Project workspaces

Each directory here is one drawing set the engine can measure.

```
<project>/
  dwg/              ← source DWGs (required)
  pdf/              ← optional sheet PDFs beside DWGs
  *.xlsx            ← consultant bill / Courtyard reference (optional)
  out/              ← generated: JSON dumps, compare CSVs, workspace PNGs
```

Run discover/foundations/structure from the UI or:

```powershell
cd D:\Constech\backend
py -3 -m structural_boq validate --project D:\Constech\work\khanna-villa-dd
```
