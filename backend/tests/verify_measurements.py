"""Smoke tests for measurement records and review queue."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from structural_boq.measurements import load_measurement_bundle, merge_manual_measurements
from structural_boq.rules import find_rules
from structural_boq.workspace import build_catalog


def main():
    project = Path(r"D:\Constech\work\khanna-villa")
    out = project / "out"
    bundle_path = out / "measurements.json"
    if not bundle_path.is_file():
        print("FAIL: run foundations first (measurements.json missing)")
        return 1

    bundle = load_measurement_bundle(project)
    measurements = bundle.get("measurements") or []
    review = bundle.get("review_queue") or []
    assert len(measurements) >= 20, f"expected many footing records, got {len(measurements)}"
    sample = measurements[0]
    for key in ("id", "element_type", "status", "sources", "quantities"):
        assert key in sample, f"missing {key} on measurement record"

    auto = [m for m in measurements if m.get("status") == "auto"]
    assert auto, "expected at least one auto footing"

    rules = find_rules(project, search_parent_zip=False)
    if rules.get("blinding_source"):
        src = rules["blinding_source"]
        assert "269" in src or project.name in src.lower(), "blinding rule should come from project PDFs"

    catalog = build_catalog(project)
    assert catalog.get("measurements"), "catalog should expose measurements"
    assert "review_queue" in catalog

    manual_path = out / "manual-measurements.json"
    if manual_path.is_file():
        merged = merge_manual_measurements(measurements, json.loads(manual_path.read_text())["entries"])
        assert len(merged) >= len(measurements)

    print(f"OK: {len(measurements)} measurements, {len(review)} review items, {len(catalog['sheets'])} sheets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
