from pathlib import Path
from structural_boq.structure import _load_plans, _slab_regions

project = Path(r"D:\Constech\work\khanna-villa-dd")
out = project / "out"
total = 0.0
for item in _load_plans(project, out):
    for region in _slab_regions(item["dump"]):
        vol = region["area_m2"] * region["thickness"] / 1000.0
        kind = "SOG" if region["on_grade"] else "SUS"
        if kind == "SUS":
            total += vol
        print(
            f"{item['floor']:6} {kind} {region['area_m2']:7.1f} m2 x {region['thickness']:.0f} mm"
            f" = {vol:6.2f} m3 spread={region.get('spread')}"
        )
print("suspended sum", round(total, 2))
