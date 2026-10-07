import argparse
from pathlib import Path

from .discovery import run_discover
from .foundations import run_foundations
from .structure import run_structure
from .validation import run_validate
from .app_server import serve_app
from .paths import DEFAULT_WORK
from .workspace import serve


def main():
    parser = argparse.ArgumentParser(prog="structural_boq")
    sub = parser.add_subparsers(dest="cmd", required=True)
    foundations = sub.add_parser(
        "foundations",
        help="Measure footings, blinding, and rafts on every DWG in a project folder",
    )
    foundations.add_argument("--project", type=Path, help="Folder of DWG, PDF, and the bill workbook")
    foundations.add_argument("--dwg", type=Path, help="One drawing, instead of scanning a folder")
    foundations.add_argument("--pdf", type=Path, help="PDF of that drawing, for the overlay")
    foundations.add_argument("--bill", type=Path, help="Consultant workbook to compare against")
    foundations.add_argument("--out", type=Path, help="Where to write the CSV and overlay")
    structure = sub.add_parser(
        "structure",
        help="Columns, slabs, and grade beams on the floor plans",
    )
    structure.add_argument("--project", required=True, type=Path)
    discover = sub.add_parser(
        "discover",
        help="Build a drawing register and capability manifest for any project folder",
    )
    discover.add_argument("--project", required=True, type=Path)
    discover.add_argument(
        "--quick",
        action="store_true",
        help="Classify from filenames only; skip DWG dump and signal scan",
    )
    workspace = sub.add_parser(
        "workspace",
        help="Legacy single-project canvas (embedded HTML) beside the bill",
    )
    workspace.add_argument("--project", required=True, type=Path)
    workspace.add_argument("--port", type=int, default=8765)
    app = sub.add_parser(
        "app",
        help="Constech takeoff UI (new frontend) backed by the updated engine",
    )
    app.add_argument(
        "--work",
        type=Path,
        default=DEFAULT_WORK,
        help="Folder of project directories (each with dwg/ and out/)",
    )
    app.add_argument(
        "--project",
        type=Path,
        action="append",
        default=[],
        help="Also expose this project folder (can repeat)",
    )
    app.add_argument("--port", type=int, default=8780)
    validate = sub.add_parser(
        "validate",
        help="Discover, measure foundations and structure, then write a three-way compare",
    )
    validate.add_argument("--project", required=True, type=Path)
    args = parser.parse_args()
    if args.cmd == "foundations":
        run_foundations(args.project, dwg=args.dwg, pdf=args.pdf, bill=args.bill, out=args.out)
    elif args.cmd == "structure":
        run_structure(args.project)
    elif args.cmd == "discover":
        run_discover(args.project, quick=args.quick)
    elif args.cmd == "workspace":
        serve(args.project, port=args.port)
    elif args.cmd == "app":
        serve_app(args.work, extra_projects=args.project, port=args.port)
    elif args.cmd == "validate":
        run_validate(args.project)


if __name__ == "__main__":
    main()
