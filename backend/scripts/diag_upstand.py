"""Compare upstand length strategies vs current engine."""
from pathlib import Path

from structural_boq.structure import (
    UPSTAND,
    _collinear_run_length,
    _load_plans,
    _parapet_edges,
    _point_line_distance,
    _texts,
    _upstands,
)

project = Path(r"D:\Constech\work\khanna-villa-dd")
out = project / "out"


def longest_parallel(edges, label, max_dist=3000.0):
    best = None
    for edge in edges:
        dist = _point_line_distance(edge, label["x"], label["y"])
        if dist > max_dist:
            continue
        run = _collinear_run_length(edges, edge)
        if best is None or run > best[0] or (run == best[0] and dist < best[1]):
            best = (run, dist, edge)
    return best


for item in _load_plans(project, out):
    labels = []
    for text in _texts(item["dump"]):
        match = UPSTAND.search(text["text"].replace("\n", " "))
        if not match:
            continue
        labels.append(
            {
                "w": int(match.group(1)),
                "h": int(match.group(2)) if match.group(2) else 550,
                "x": text["x"],
                "y": text["y"],
                "raw": text["text"].replace("\n", " ")[:40],
            }
        )
    if not labels:
        continue
    edges = _parapet_edges(item["dump"])
    eng = _upstands(item["dump"])
    print(f"\n=== {item['floor']} labels={len(labels)} engine m3={eng['concrete_m3']:.3f} ===")
    for label in labels:
        near = min(
            (( _point_line_distance(e, label["x"], label["y"]), e["L"], e) for e in edges),
            key=lambda t: t[0],
        )
        long_p = longest_parallel(edges, label)
        run_near = _collinear_run_length(edges, near[2]) / 1000.0
        run_long = (long_p[0] / 1000.0) if long_p else 0.0
        depth = label["h"] / 1000.0
        width = label["w"] / 1000.0
        print(
            f"  {label['raw']:22} nearest {run_near:.2f} m  longest_parallel {run_long:.2f} m"
            f"  vol nearest {width*depth*run_near:.3f}  vol long {width*depth*run_long:.3f}"
        )
