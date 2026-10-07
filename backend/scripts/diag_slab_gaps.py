from pathlib import Path

from shapely.geometry import Point

from structural_boq.foundations import _texts, point_in_poly
from structural_boq.structure import (
    SLAB_NOTE,
    _area_m2,
    _load_plans,
    _outline_ok,
    _slab_regions,
)

project = Path(r"D:\Constech\work\khanna-villa-dd")
out = project / "out"
item = next(p for p in _load_plans(project, out) if p["floor"] == "first")
dump = item["dump"]
polys = [
    e for e in dump["entities"]
    if e.get("kind") == "polyline" and _outline_ok(e)
]
claimed = set()
for note in _texts(dump):
    match = SLAB_NOTE.search(note["text"].replace("\n", " "))
    if not match:
        continue
    hits = [
        (index, _area_m2(shape["vertices"]))
        for index, shape in enumerate(polys)
        if point_in_poly(note["x"], note["y"], shape["vertices"])
    ]
    if hits:
        claimed.add(min(hits, key=lambda item: item[1])[0])

regions = _slab_regions(dump)
reg_area = sum(r["area_m2"] for r in regions if not r["on_grade"])
print("first floor suspended region area m2", round(reg_area, 1))
print("claimed polys", len(claimed), "of", len(polys))
for index, shape in enumerate(polys):
    area = _area_m2(shape["vertices"])
    if index in claimed:
        continue
    print(" unclaimed poly", round(area, 1), "m2", shape.get("layer", "")[:20])
