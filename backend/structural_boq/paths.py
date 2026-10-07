"""Stable paths for repo layout: Constech/{backend,frontend,work}."""
from pathlib import Path

_PKG = Path(__file__).resolve().parent
BACKEND_ROOT = _PKG.parent
REPO_ROOT = BACKEND_ROOT.parent

def frontend_dir():
    dist = REPO_ROOT / "frontend" / "dist"
    if (dist / "index.html").is_file():
        return dist
    return REPO_ROOT / "frontend"


FRONTEND_DIR = frontend_dir()
DWG_DUMP_DIR = BACKEND_ROOT / "dwg_dump"
DUMP_MJS = DWG_DUMP_DIR / "dump.mjs"
DEFAULT_WORK = REPO_ROOT / "work"
