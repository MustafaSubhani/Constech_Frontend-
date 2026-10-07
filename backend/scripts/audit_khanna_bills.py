"""List bill lines and compare coverage vs engine keys."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from structural_boq.bill import quantity_lines, foundation_baseline
from structural_boq.structure import _structure_bill


def main():
    project = Path(r"D:\Constech\work\khanna-villa")
    bill2 = project / "Bill No. 2 - Main Villa.xlsx"
    courtyard = project / "Quantity Takeoff - structural- Khanna Courtyard-R01 (1).xlsx"

    print("=== Bill No. 2 ===")
    lines = quantity_lines(bill2)
    print("total quantity lines:", len(lines))
    sheets = sorted({l["sheet"] for l in lines})
    print("sheets with quantities:", sheets)

    found = foundation_baseline(bill2)
    print("foundation_baseline keys:", sorted(found.keys()))
    struct = _structure_bill(bill2)
    print("structure_bill keys:", len(struct), sorted(struct.keys()))

    print("\nAll Bill No. 2 lines (description | qty unit):")
    for line in lines:
        print(f"  {line['qty']:>12} {line['unit']:<4} | {line['description'][:90]}")

    if courtyard.is_file():
        print("\n=== Courtyard takeoff ===")
        cl = quantity_lines(courtyard)
        print("total quantity lines:", len(cl))
        print("sheets:", sorted({l["sheet"] for l in cl})[:20], "count", len({l['sheet'] for l in cl}))
        for line in cl[:40]:
            print(f"  {line['qty']:>12} {line['unit']:<4} | {line['description'][:90]}")
        if len(cl) > 40:
            print(f"  ... {len(cl) - 40} more")
    else:
        print("\nCourtyard workbook not found at", courtyard)


if __name__ == "__main__":
    main()
