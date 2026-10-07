"""Serve the Constech takeoff frontend and connect it to structural_boq."""
import base64
import json
import mimetypes
import re
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

from .discovery import run_discover
from .foundations import run_foundations
from .frontend_adapter import (
    build_project_payload,
    discover_project_dirs,
    project_slug,
    project_summary,
)
from .bill_lines import adjust_bill_line
from .measurements import adjust_measurement, append_manual
from .structure import run_structure
from .paths import DEFAULT_WORK, frontend_dir
from .workspace import ensure_sheet_png

RUN_MESSAGES = {
    "discover": "Drawing register updated.",
    "foundations": "Foundation measure finished. Review the outlines on the foundation sheet.",
    "structure": "Structure measure finished. Columns, slabs, beams, and walls are ready to review.",
}


def _json_response(handler, code, payload):
    data = json.dumps(payload).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def _read_body(handler):
    length = int(handler.headers.get("Content-Length") or 0)
    raw = handler.rfile.read(length) if length else b"{}"
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return {}


class TakeoffApp:
    def __init__(self, work_root, extra_projects=None):
        self.work_root = Path(work_root).resolve()
        self.extra_projects = [Path(p).resolve() for p in (extra_projects or [])]
        self._cache = {}

    def _all_dirs(self):
        dirs = discover_project_dirs(self.work_root)
        seen = {project_slug(d) for d in dirs}
        for path in self.extra_projects:
            if path.is_dir() and project_slug(path) not in seen:
                dirs.append(path)
                seen.add(project_slug(path))
        return dirs

    def resolve_dir(self, project_id):
        for path in self._all_dirs():
            if project_slug(path) == project_id:
                return path
        return None

    def load_projects(self, detail=False):
        projects = []
        for path in self._all_dirs():
            payload = build_project_payload(path, include_catalog=detail)
            if detail:
                self._cache[payload["id"]] = payload
                public = {k: v for k, v in payload.items() if not k.startswith("_")}
                projects.append(public)
            else:
                projects.append(project_summary(payload))
        return projects

    def get_project(self, project_id, detail=True):
        path = self.resolve_dir(project_id)
        if not path:
            return None
        payload = build_project_payload(path, include_catalog=detail)
        if detail:
            self._cache[project_id] = payload
        return {k: v for k, v in payload.items() if not k.startswith("_")}

    def run_kind(self, project_id, kind):
        path = self.resolve_dir(project_id)
        if not path:
            raise FileNotFoundError("That project is not on this account.")
        if kind == "discover":
            run_discover(path, quick=False)
        elif kind == "foundations":
            run_foundations(path)
        elif kind == "structure":
            run_structure(path)
        else:
            raise ValueError(f"Unknown run step: {kind}")
        self._cache.pop(project_id, None)
        return {"message": RUN_MESSAGES.get(kind, "Finished.")}

    def create_project(self, name, place, files=None):
        safe = re.sub(r"[^\w\-]+", "-", name.strip()).strip("-").lower()
        if not safe:
            safe = "project"
        target = self.work_root / safe
        suffix = 0
        while target.exists():
            suffix += 1
            target = self.work_root / f"{safe}-{suffix}"
        target.mkdir(parents=True)
        (target / "dwg").mkdir(exist_ok=True)
        (target / "pdf").mkdir(exist_ok=True)
        (target / "out").mkdir(exist_ok=True)
        meta = {"place": place or "UAE", "created": True}
        (target / "project.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        if files:
            for f in files:
                fname = Path(f.get("name", "file")).name
                b64 = f.get("content_base64", "")
                if not b64 or not fname:
                    continue
                try:
                    raw = base64.b64decode(b64)
                    ext = Path(fname).suffix.lower()
                    if ext in (".dwg", ".dxf"):
                        dest = target / "dwg" / fname
                    elif ext in (".pdf", ".png", ".jpg", ".jpeg"):
                        dest = target / "pdf" / fname
                    elif ext in (".xlsx", ".xls", ".csv"):
                        dest = target / fname
                    else:
                        dest = target / "dwg" / fname
                    dest.write_bytes(raw)
                except Exception:
                    pass
        payload = build_project_payload(target, include_catalog=False)
        self._cache[payload["id"]] = payload
        return {k: v for k, v in payload.items() if not k.startswith("_")}

    def load_rates(self, project_id):
        path = self.resolve_dir(project_id)
        if not path:
            return {"currency": "AED", "rates": {}}
        rates_file = path / "out" / "rates.json"
        if rates_file.is_file():
            try:
                return json.loads(rates_file.read_text(encoding="utf-8"))
            except Exception:
                return {"currency": "AED", "rates": {}}
        return {"currency": "AED", "rates": {}}

    def save_rates(self, project_id, data):
        path = self.resolve_dir(project_id)
        if not path:
            raise FileNotFoundError("That project is not on this account.")
        out = path / "out"
        out.mkdir(parents=True, exist_ok=True)
        rates_file = out / "rates.json"
        rates_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return data


def serve_app(work_root=None, extra_projects=None, port=8780):
    work_root = Path(work_root or DEFAULT_WORK)
    work_root.mkdir(parents=True, exist_ok=True)
    app = TakeoffApp(work_root, extra_projects=extra_projects)
    frontend = frontend_dir()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            print(f"  {self.address_string()} {fmt % args}", flush=True)

        def _send_bytes(self, code, data, content_type):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _static(self, rel_path):
            path = (frontend / rel_path).resolve()
            if not str(path).startswith(str(frontend.resolve())) or not path.is_file():
                return False
            data = path.read_bytes()
            ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            self._send_bytes(200, data, ctype)
            return True

        def do_GET(self):
            parsed = urlparse(self.path)
            path = unquote(parsed.path)
            if path == "/api/projects":
                detail = parse_qs(parsed.query).get("detail", [""])[0].lower() in {"1", "true", "full"}
                projects = app.load_projects(detail=detail)
                return _json_response(self, 200, projects)
            if path == "/api/exports":
                file_items = []
                for pdir in app._all_dirs():
                    slug = project_slug(pdir)
                    pname = pdir.name
                    # Excel files in root
                    for ext in ("*.xlsx", "*.xls"):
                        for f in pdir.glob(ext):
                            if f.is_file():
                                stat = f.stat()
                                file_items.append({
                                    "projectId": slug,
                                    "projectName": pname,
                                    "fileName": f.name,
                                    "category": "BOQ Spreadsheet",
                                    "ext": f.suffix.lstrip(".").lower(),
                                    "sizeBytes": stat.st_size,
                                    "modifiedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                                    "downloadUrl": f"/api/projects/{slug}/download/{quote(f.name)}",
                                })
                    # CSVs and JSON in out/
                    out_dir = pdir / "out"
                    if out_dir.is_dir():
                        for f in out_dir.glob("*.csv"):
                            if f.is_file():
                                stat = f.stat()
                                file_items.append({
                                    "projectId": slug,
                                    "projectName": pname,
                                    "fileName": f.name,
                                    "category": "Structural Comparison",
                                    "ext": "csv",
                                    "sizeBytes": stat.st_size,
                                    "modifiedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                                    "downloadUrl": f"/api/projects/{slug}/download/{quote(f.name)}",
                                })
                        rates_file = out_dir / "rates.json"
                        if rates_file.is_file():
                            stat = rates_file.stat()
                            file_items.append({
                                "projectId": slug,
                                "projectName": pname,
                                "fileName": "rates.json",
                                "category": "Rates Schedule",
                                "ext": "json",
                                "sizeBytes": stat.st_size,
                                "modifiedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                                "downloadUrl": f"/api/projects/{slug}/download/rates.json",
                            })
                        meas_file = out_dir / "measurements.json"
                        if meas_file.is_file():
                            stat = meas_file.stat()
                            file_items.append({
                                "projectId": slug,
                                "projectName": pname,
                                "fileName": "measurements.json",
                                "category": "Raw Measurements",
                                "ext": "json",
                                "sizeBytes": stat.st_size,
                                "modifiedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                                "downloadUrl": f"/api/projects/{slug}/download/measurements.json",
                            })
                        for f in out_dir.glob("*.md"):
                            if f.is_file():
                                stat = f.stat()
                                file_items.append({
                                    "projectId": slug,
                                    "projectName": pname,
                                    "fileName": f.name,
                                    "category": "Audit Report",
                                    "ext": "md",
                                    "sizeBytes": stat.st_size,
                                    "modifiedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                                    "downloadUrl": f"/api/projects/{slug}/download/{quote(f.name)}",
                                })
                return _json_response(self, 200, file_items)
            download_match = re.match(r"^/api/projects/([^/]+)/download/([^/]+)$", path)
            if download_match:
                project_id, raw_fname = download_match.group(1), unquote(download_match.group(2))
                project_dir = app.resolve_dir(project_id)
                if not project_dir:
                    return self._send_bytes(404, b"Project not found", "text/plain; charset=utf-8")
                candidate = project_dir / raw_fname
                if not candidate.is_file():
                    candidate = project_dir / "out" / raw_fname
                if not candidate.is_file():
                    return self._send_bytes(404, b"File not found", "text/plain; charset=utf-8")
                data = candidate.read_bytes()
                ctype = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Content-Disposition", f'attachment; filename="{candidate.name}"')
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data)
                return
            match = re.match(r"^/api/projects/([^/]+)$", path)
            if match:
                catalog = parse_qs(parsed.query).get("catalog", ["1"])[0].lower()
                include_catalog = catalog not in {"0", "false", "no", "summary"}
                project = app.get_project(match.group(1), detail=include_catalog)
                if not project:
                    return _json_response(self, 404, {"message": "Project not found."})
                return _json_response(self, 200, project)
            rates_match = re.match(r"^/api/projects/([^/]+)/rates$", path)
            if rates_match:
                project_id = rates_match.group(1)
                rates = app.load_rates(project_id)
                return _json_response(self, 200, rates)
            sheet_img = re.match(r"^/api/projects/([^/]+)/sheets/(.+\.png)$", path, re.I)
            if sheet_img:
                project_id, name = sheet_img.group(1), Path(sheet_img.group(2)).name
                project_dir = app.resolve_dir(project_id)
                if not project_dir:
                    return self._send_bytes(404, b"Not found", "text/plain; charset=utf-8")
                image = project_dir / "out" / "workspace" / name
                if not image.is_file():
                    ensured = ensure_sheet_png(project_dir, Path(name).stem)
                    if ensured:
                        image = ensured
                if image.is_file():
                    return self._send_bytes(200, image.read_bytes(), "image/png")
                return self._send_bytes(404, b"Sheet image not found", "text/plain; charset=utf-8")
            rel = path.lstrip("/")
            if rel and self._static(rel):
                return
            if self._static("index.html"):
                return
            self._send_bytes(404, b"Not found", "text/plain; charset=utf-8")

        def do_POST(self):
            parsed = urlparse(self.path)
            path = unquote(parsed.path)
            if path == "/api/auth/login":
                body = _read_body(self)
                email = body.get("email") or "user@constech.local"
                name = email.split("@")[0].replace(".", " ").title()
                return _json_response(self, 200, {"token": "local-dev", "user": {"email": email, "name": name}})
            if path == "/api/auth/logout":
                self.send_response(204)
                self.end_headers()
                return
            if path == "/api/projects":
                body = _read_body(self)
                project = app.create_project(
                    body.get("name") or "New project",
                    body.get("place"),
                    files=body.get("files"),
                )
                return _json_response(self, 201, project)
            upload_match = re.match(r"^/api/projects/([^/]+)/upload$", path)
            if upload_match:
                project_id = upload_match.group(1)
                project_dir = app.resolve_dir(project_id)
                if not project_dir:
                    return _json_response(self, 404, {"message": "Project not found."})
                body = _read_body(self)
                files = body.get("files") or []
                saved = []
                for f in files:
                    fname = Path(f.get("name", "file")).name
                    b64 = f.get("content_base64", "")
                    if not b64 or not fname:
                        continue
                    try:
                        raw = base64.b64decode(b64)
                        ext = Path(fname).suffix.lower()
                        if ext in (".dwg", ".dxf"):
                            dest = project_dir / "dwg" / fname
                        elif ext in (".pdf", ".png", ".jpg", ".jpeg"):
                            dest = project_dir / "pdf" / fname
                        elif ext in (".xlsx", ".xls", ".csv"):
                            dest = project_dir / fname
                        else:
                            dest = project_dir / "dwg" / fname
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        dest.write_bytes(raw)
                        saved.append(fname)
                    except Exception:
                        pass
                app._cache.pop(project_id, None)
                return _json_response(self, 200, {"saved": saved})
            match = re.match(r"^/api/projects/([^/]+)/(discover|foundations|structure)$", path)
            if match:
                project_id, kind = match.group(1), match.group(2)
                try:
                    result = app.run_kind(project_id, kind)
                    return _json_response(self, 200, result)
                except FileNotFoundError as exc:
                    return _json_response(self, 404, {"message": str(exc)})
                except Exception as exc:
                    return _json_response(self, 500, {"message": str(exc)[:500]})
            manual = re.match(r"^/api/projects/([^/]+)/measurements/manual$", path)
            if manual:
                project_dir = app.resolve_dir(manual.group(1))
                if not project_dir:
                    return _json_response(self, 404, {"message": "Project not found."})
                body = _read_body(self)
                try:
                    entry = append_manual(project_dir, body)
                    app._cache.pop(manual.group(1), None)
                    return _json_response(self, 201, {"entry": entry})
                except Exception as exc:
                    return _json_response(self, 400, {"message": str(exc)[:500]})
            adjust = re.match(r"^/api/projects/([^/]+)/measurements/([^/]+)$", path)
            if adjust:
                project_id, mid = adjust.group(1), unquote(adjust.group(2))
                project_dir = app.resolve_dir(project_id)
                if not project_dir:
                    return _json_response(self, 404, {"message": "Project not found."})
                body = _read_body(self)
                try:
                    saved = adjust_measurement(project_dir, mid, body)
                    app._cache.pop(project_id, None)
                    return _json_response(self, 200, {"override": saved})
                except Exception as exc:
                    return _json_response(self, 400, {"message": str(exc)[:500]})
            bill_line = re.match(r"^/api/projects/([^/]+)/bill/([^/]+)$", path)
            if bill_line:
                project_id, item_key = bill_line.group(1), unquote(bill_line.group(2))
                project_dir = app.resolve_dir(project_id)
                if not project_dir:
                    return _json_response(self, 404, {"message": "Project not found."})
                body = _read_body(self)
                try:
                    saved = adjust_bill_line(project_dir, item_key, body)
                    app._cache.pop(project_id, None)
                    return _json_response(self, 200, {"line": saved})
                except Exception as exc:
                    return _json_response(self, 400, {"message": str(exc)[:500]})
            rates_post = re.match(r"^/api/projects/([^/]+)/rates$", path)
            if rates_post:
                project_id = rates_post.group(1)
                body = _read_body(self)
                try:
                    saved = app.save_rates(project_id, body)
                    return _json_response(self, 200, saved)
                except Exception as exc:
                    return _json_response(self, 400, {"message": str(exc)[:500]})
            self._send_bytes(404, b"Not found", "text/plain; charset=utf-8")

    if not frontend.is_dir():
        raise SystemExit(f"Frontend folder missing: {frontend}")

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Constech takeoff  http://127.0.0.1:{port}/", flush=True)
    print(f"  work folder: {work_root}", flush=True)
    print(f"  projects: {', '.join(project_slug(p) for p in app._all_dirs()) or '(none yet)'}", flush=True)
    print("  legacy workspace still available: py -3 -m structural_boq workspace --project ...", flush=True)
    server.serve_forever()
