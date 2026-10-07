"""Bill No. 2 Section C vs engine compare CSVs — coverage matrix."""
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from structural_boq.bill import foundation_baseline
from structural_boq.structure import _structure_bill


def read_compare(path):
    rows = {}
    if not path.is_file():
        return rows
    with path.open(encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            rows[r["item"]] = r
    return rows


def main():
    project = Path(r"D:\Constech\work\khanna-villa")
    bill = project / "Bill No. 2 - Main Villa.xlsx"
    fnd = read_compare(project / "out" / "foundations-compare.csv")
    st = read_compare(project / "out" / "structure-compare.csv")

    fb = foundation_baseline(bill)
    sb = _structure_bill(bill)

    print("KHANNA 269 — Bill No. 2 vs engine (run foundations + structure first)\n")
    print("FOUNDATIONS (7 bill keys)\n")
    for key in sorted(fb):
        row = fnd.get(key, {})
        print(f"  {key:16} bill={fb[key]:>10} ours={row.get('ours','?'):>10} pct={row.get('pct','')}")

    print("\nSTRUCTURE (26 bill keys mapped; engine may emit extra unbilled keys)\n")
    for key in sorted(sb):
        row = st.get(key, {})
        print(f"  {key:16} bill={sb[key]:>10} ours={row.get('ours','?'):>10} pct={row.get('pct','')}")

    extra = sorted(set(st) - set(sb))
    if extra:
        print("\nEngine lines WITHOUT a bill match (scope or mapping gap):")
        for key in extra:
            row = st.get(key, {})
            print(f"  {key:16} ours={row.get('ours','?'):>10}  {row.get('note','')[:60]}")

    bill_only_kg = [k for k in sb if k.endswith("_kg") and st.get(k, {}).get("ours") in (None, "", "?")]
    if bill_only_kg:
        print("\nBill rebar lines not in engine totals yet:", bill_only_kg)


if __name__ == "__main__":
    main()
