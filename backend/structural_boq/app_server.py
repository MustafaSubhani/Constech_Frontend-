"""Serve the Constech takeoff frontend and connect it to structural_boq."""
import base64
import json
import mimetypes
import re
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

from . import agent
from .bill_lines import (
    add_custom_line,
    adjust_bill_line,
    delete_custom_line,
    reset_bill_line,
    set_line_hidden,
    update_custom_line,
)
from .bill_source import bill_candidates, select_bill, selected_bill
from .discovery import run_discover
from .exporters import bill_table, rates_table, to_csv, to_pdf, to_xlsx
from .formula import FormulaError
from .foundations import run_foundations
from .frontend_adapter import (
    _runs,
    build_project_payload,
    discover_project_dirs,
    display_name,
    load_catalog,
    project_slug,
    project_summary,
    save_shape_override,
)
from .inputs import inputs_register, save_inputs
from .measurements import (
    adjust_measurement,
    append_manual,
    delete_manual,
    load_measurement_bundle,
    reset_measurement,
    update_manual,
)
from .paths import DEFAULT_WORK, frontend_dir
from .pipeline import (
    ENGINE_STAGES,
    PipelineJob,
    catalog_fingerprint,
    load_state,
    payload_fingerprint,
    project_files,
    run_job,
)
from .rates import load_rates, read_rate_rows, save_rates, suggest_matches
from .structure import run_structure
from .workspace import ensure_sheet_png

RUN_MESSAGES = {
    "discover": "Drawing register updated.",
    "foundations": "Foundation measure finished. Review the outlines on the foundation sheet.",
    "structure": "Structure measure finished. Columns, slabs, beams, and walls are ready to review.",
}
UPLOAD_SUFFIXES = {".dwg", ".dxf", ".pdf", ".xlsx", ".csv", ".txt", ".md"}
UPLOAD_TARGETS = {"bills", "rates"}
DOWNLOAD_DIRS = ("", "out", "bills", "rates")
EXPORT_TYPES = {
    "csv": "text/csv; charset=utf-8",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pdf": "application/pdf",
}


class ApiError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def _plural(count, word):
    return f"{count} {word}{'' if count == 1 else 's'}"


def _refresh_full_compare(project_dir):
    """The merged comparison is what the UI reads; rebuild it when foundations change on their own."""
    if (Path(project_dir) / "out" / "structure-compare.csv").is_file():
        from .validation import run_full_compare

        run_full_compare(project_dir)


def _save_upload(project_dir, item, target=None):
    name = Path(str(item.get("name") or "")).name
    raw_b64 = item.get("content_base64") or ""
    suffix = Path(name).suffix.lower()
    if not name or not raw_b64:
        return None
    if suffix not in UPLOAD_SUFFIXES:
        raise ApiError(400, f"{name}: {suffix or 'this'} files are not supported")
    data = base64.b64decode(raw_b64)
    if target in UPLOAD_TARGETS:
        folder = project_dir / target
    elif suffix in (".dwg", ".dxf"):
        folder = project_dir / "dwg"
    elif suffix == ".pdf":
        folder = project_dir / "pdf"
    else:
        folder = project_dir
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / name
    dest.write_bytes(data)
    return str(dest.relative_to(project_dir)).replace("\\", "/")


class TakeoffApp:
    def __init__(self, work_root, extra_projects=None):
        self.work_root = Path(work_root).resolve()
        self.extra_projects = [Path(p).resolve() for p in (extra_projects or [])]
        self._lock = threading.Lock()
        self._catalog = {}
        self._payload = {}
        self._summary = {}
        self._jobs = {}

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

    def require_dir(self, project_id):
        path = self.resolve_dir(project_id)
        if not path:
            raise ApiError(404, "That project is not on this account.")
        return path

    # Cached builds -------------------------------------------------------

    def catalog(self, project_id, path, on_sheet=None):
        fp = catalog_fingerprint(path)
        cached = self._catalog.get(project_id)
        if cached and cached[0] == fp:
            return cached[1], True
        catalog = load_catalog(path, on_sheet=on_sheet)
        self._catalog[project_id] = (catalog_fingerprint(path), catalog)
        return catalog, False

    def payload(self, project_id, detail=True):
        path = self.require_dir(project_id)

        def fingerprint():
            return (payload_fingerprint(path), catalog_fingerprint(path) if detail else 0)

        fp = fingerprint()
        store = self._payload if detail else self._summary
        cached = store.get(project_id)
        if cached and cached[0] == fp:
            return cached[1]
        catalog = None
        if detail:
            try:
                catalog, _ = self.catalog(project_id, path)
            except Exception as exc:
                print(f"  catalog warning for {project_id}: {exc}", flush=True)
                catalog = {}
        built = build_project_payload(path, include_catalog=detail, catalog_by_id=catalog)
        public = {k: v for k, v in built.items() if not k.startswith("_")}
        store[project_id] = (fingerprint(), public)
        return public

    def summaries(self):
        items = []
        for path in self._all_dirs():
            slug = project_slug(path)
            try:
                payload = self.payload(slug, detail=False)
            except Exception as exc:
                print(f"  summary warning for {slug}: {exc}", flush=True)
                continue
            summary = project_summary(payload)
            job = self._jobs.get(slug)
            summary["pipelineRunning"] = bool(job and job.status == "running")
            items.append(summary)
        return items

    # Pipeline ------------------------------------------------------------

    def pipeline_status(self, project_id):
        path = self.require_dir(project_id)
        job = self._jobs.get(project_id)
        if job:
            snap = job.snapshot()
        else:
            snap = None
        return {
            "job": snap,
            "runs": _runs(path / "out"),
            "lastRun": load_state(path).get("stages") or {},
        }

    def start_pipeline(self, project_id, body):
        path = self.require_dir(project_id)
        with self._lock:
            current = self._jobs.get(project_id)
            if current and current.status == "running":
                return current.snapshot()
            mode = body.get("mode") or "open"
            requested = [s for s in body.get("stages") or [] if s in ENGINE_STAGES]
            strategy = body.get("discovery") or "rules"
            runs = _runs(path / "out")
            fresh = not any(runs.values())
            plan = {"files": "run", "sheets": "run", "compare": "run"}
            for key in ENGINE_STAGES:
                if mode == "run" and key in requested:
                    plan[key] = "run"
                elif mode == "open" and fresh and body.get("autorun", True):
                    plan[key] = "run"
                else:
                    plan[key] = "cached" if runs[key] else "skipped"
            job = PipelineJob(project_id, plan)
            self._jobs[project_id] = job
        runners = self._runners(project_id, path, strategy)
        thread = threading.Thread(target=run_job, args=(job, path, runners), daemon=True)
        thread.start()
        return job.snapshot()

    def _runners(self, project_id, path, strategy):
        def files(report):
            items = project_files(path)
            counts = {}
            for item in items:
                counts[item["kind"]] = counts.get(item["kind"], 0) + 1
            if not counts.get("drawing") and not counts.get("sheet"):
                raise ValueError("No drawings in this project yet. Upload DWG or PDF sheets to continue.")
            parts = []
            for kind, label in (("drawing", "DWG"), ("sheet", "PDF"), ("bill", "bill"), ("notes", "notes")):
                if counts.get(kind):
                    parts.append(f"{counts[kind]} {label}")
            return f"{_plural(len(items), 'file')}: " + ", ".join(parts)

        def discover(report):
            manifest = run_discover(path, quick=False)
            caps = manifest.get("capabilities") or []
            ready = sum(1 for c in caps if c.get("status") == "ready")
            detail = f"{_plural(manifest.get('drawing_count', 0), 'sheet')} indexed, {ready} of {len(caps)} capabilities ready"
            if strategy == "agentic":
                try:
                    result = agent.agentic_discovery(path, lambda: self.payload(project_id, detail=False))
                    made = sum(1 for item in result["new"] if item.get("proposalId"))
                    detail += f"; assistant review proposed {made} correction{'' if made == 1 else 's'}"
                except agent.AssistantNotConnected as exc:
                    detail += f"; assistant review skipped ({exc})"
            return detail

        def foundations(report):
            run_foundations(path)
            _refresh_full_compare(path)
            return "Footings, rafts and blinding measured"

        def structure(report):
            run_structure(path)
            return "Columns, slabs, beams and walls measured"

        def sheets(report):
            def on_sheet(index, total, stem):
                report(progress=index / max(total, 1), detail=f"Sheet {index + 1} of {total}: {stem}")

            catalog, cached = self.catalog(project_id, path, on_sheet=on_sheet)
            shapes = sum(len(sheet.get("shapes") or []) for sheet in catalog.values())
            prefix = "Up to date. " if cached else ""
            return f"{prefix}{_plural(len(catalog), 'sheet')} with {_plural(shapes, 'outline')}"

        def compare(report):
            payload = self.payload(project_id, detail=True)
            rows = [r for r in payload.get("comparison") or [] if not r.get("hidden")]
            compared = sum(1 for r in rows if r.get("bill") is not None and r.get("ours") is not None)
            bill = (payload.get("billSource") or {}).get("name") or "no bill selected"
            return f"{_plural(len(rows), 'line')}, {compared} compared against {bill}"

        return {
            "files": files,
            "discover": discover,
            "foundations": foundations,
            "structure": structure,
            "sheets": sheets,
            "compare": compare,
        }

    def run_kind(self, project_id, kind):
        path = self.require_dir(project_id)
        try:
            if kind == "discover":
                run_discover(path, quick=False)
            elif kind == "foundations":
                run_foundations(path)
                _refresh_full_compare(path)
            elif kind == "structure":
                run_structure(path)
            else:
                raise ApiError(400, f"Unknown run step: {kind}")
        except SystemExit as exc:
            raise ApiError(422, str(exc) or f"{kind} could not run on this project") from exc
        return {"message": RUN_MESSAGES.get(kind, "Finished.")}

    # Projects ------------------------------------------------------------

    def create_project(self, name, place, files=None):
        name = (name or "").strip() or "New project"
        safe = re.sub(r"[^\w\-]+", "-", name).strip("-").lower() or "project"
        target = self.work_root / safe
        suffix = 0
        while target.exists():
            suffix += 1
            target = self.work_root / f"{safe}-{suffix}"
        target.mkdir(parents=True)
        for folder in ("dwg", "pdf", "out"):
            (target / folder).mkdir(exist_ok=True)
        meta = {"name": name[:120], "place": (place or "").strip()[:120], "created": datetime.now().isoformat(timespec="seconds")}
        (target / "project.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        saved = []
        for item in files or []:
            rel = _save_upload(target, item)
            if rel:
                saved.append(rel)
        return {**self.payload(project_slug(target), detail=False), "saved": saved}


def _exports_listing(app):
    file_items = []

    def add(slug, pname, path, category):
        stat = path.stat()
        file_items.append({
            "projectId": slug,
            "projectName": pname,
            "fileName": path.name,
            "category": category,
            "ext": path.suffix.lstrip(".").lower(),
            "sizeBytes": stat.st_size,
            "modifiedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
            "downloadUrl": f"/api/projects/{quote(slug)}/download/{quote(str(path.relative_to(app.resolve_dir(slug))).replace(chr(92), '/'))}",
        })

    for pdir in app._all_dirs():
        slug = project_slug(pdir)
        try:
            pname = app.payload(slug, detail=False).get("name") or pdir.name
        except Exception:
            pname = pdir.name
        for folder, category in (("", "Bill workbook"), ("bills", "Bill workbook"), ("rates", "Rates sheet")):
            base = pdir / folder if folder else pdir
            if not base.is_dir():
                continue
            for pattern in ("*.xlsx", "*.csv"):
                for f in base.glob(pattern):
                    if f.is_file() and not f.name.startswith("~$"):
                        add(slug, pname, f, category)
        out_dir = pdir / "out"
        if out_dir.is_dir():
            for f in out_dir.glob("*.csv"):
                add(slug, pname, f, "Engine comparison")
            for name, category in (("rates.json", "Saved rates"), ("measurements.json", "Measurements")):
                if (out_dir / name).is_file():
                    add(slug, pname, out_dir / name, category)
            for f in out_dir.glob("*.md"):
                add(slug, pname, f, "Engine report")
    return file_items


def _safe_download(project_dir, rel):
    project_dir = project_dir.resolve()
    rel = rel.replace("\\", "/").lstrip("/")
    candidates = [project_dir / rel] if "/" in rel else [project_dir / d / rel if d else project_dir / rel for d in DOWNLOAD_DIRS]
    for candidate in candidates:
        resolved = candidate.resolve()
        if project_dir not in resolved.parents or not resolved.is_file():
            continue
        top = resolved.relative_to(project_dir).parts[0] if len(resolved.relative_to(project_dir).parts) > 1 else ""
        if top not in DOWNLOAD_DIRS:
            continue
        return resolved
    return None


def serve_app(work_root=None, extra_projects=None, port=8780):
    work_root = Path(work_root or DEFAULT_WORK)
    work_root.mkdir(parents=True, exist_ok=True)
    app = TakeoffApp(work_root, extra_projects=extra_projects)
    frontend = frontend_dir()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            print(f"  {self.address_string()} {fmt % args}", flush=True)

        def _send_bytes(self, code, data, content_type, filename=None):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            if filename:
                self.send_header(
                    "Content-Disposition",
                    f"attachment; filename=\"{filename.encode('ascii', 'replace').decode()}\"; filename*=UTF-8''{quote(filename)}",
                )
            self.end_headers()
            self.wfile.write(data)

        def _json(self, code, payload):
            self._send_bytes(code, json.dumps(payload).encode("utf-8"), "application/json; charset=utf-8")

        def _body(self):
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            try:
                return json.loads(raw.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                raise ApiError(400, "The request body is not valid JSON.") from exc

        def _static(self, rel_path):
            path = (frontend / rel_path).resolve()
            if frontend.resolve() not in path.parents or not path.is_file():
                return False
            data = path.read_bytes()
            ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            self._send_bytes(200, data, ctype)
            return True

        def _dispatch(self, routes):
            parsed = urlparse(self.path)
            path = parsed.path
            query = parse_qs(parsed.query)
            for pattern, handler in routes:
                match = re.match(pattern, path)
                if not match:
                    continue
                groups = [unquote(g) for g in match.groups()]
                try:
                    result = handler(*groups, query=query)
                except ApiError as exc:
                    return self._json(exc.code, {"message": exc.message})
                except (FormulaError, ValueError) as exc:
                    return self._json(400, {"message": str(exc)[:500]})
                except agent.AssistantNotConnected as exc:
                    return self._json(501, {"message": str(exc), "connected": False})
                except SystemExit as exc:
                    return self._json(422, {"message": str(exc)[:500] or "The engine could not run on this project."})
                except Exception as exc:
                    return self._json(500, {"message": str(exc)[:500]})
                if result is None:
                    return None
                return self._json(200, result)
            return False

        # GET ---------------------------------------------------------

        def do_GET(self):
            routes = [
                (r"^/api/projects$", lambda query: app.summaries()),
                (r"^/api/exports$", lambda query: _exports_listing(app)),
                (r"^/api/assistant/status$", lambda query: agent.status()),
                (r"^/api/assistant/settings$", lambda query: agent.status()),
                (r"^/api/projects/([^/]+)$", self._get_project),
                (r"^/api/projects/([^/]+)/pipeline$", lambda pid, query: app.pipeline_status(pid)),
                (r"^/api/projects/([^/]+)/files$", lambda pid, query: project_files(app.require_dir(pid))),
                (r"^/api/projects/([^/]+)/inputs$", self._get_inputs),
                (r"^/api/projects/([^/]+)/bills$", self._get_bills),
                (r"^/api/projects/([^/]+)/rates$", lambda pid, query: load_rates(app.require_dir(pid))),
                (r"^/api/projects/([^/]+)/export/(bill|rates)\.(csv|xlsx|pdf)$", self._export),
                (r"^/api/projects/([^/]+)/download/(.+)$", self._download),
                (r"^/api/projects/([^/]+)/sheets/([^/]+\.png)$", self._sheet_png),
                (r"^/api/projects/([^/]+)/assistant/threads$", lambda pid, query: agent.threads(app.require_dir(pid))),
                (r"^/api/projects/([^/]+)/assistant/threads/([^/]+)$", lambda pid, tid, query: agent.thread(app.require_dir(pid), tid)),
                (r"^/api/projects/([^/]+)/assistant/proposals$", lambda pid, query: agent.proposal_list(app.require_dir(pid))),
            ]
            if self._dispatch(routes) is not False:
                return
            rel = unquote(urlparse(self.path).path).lstrip("/")
            if rel.startswith("api/"):
                return self._json(404, {"message": "Not found."})
            if rel and self._static(rel):
                return
            if self._static("index.html"):
                return
            self._send_bytes(404, b"Not found", "text/plain; charset=utf-8")

        def _get_project(self, pid, query):
            catalog = (query.get("catalog") or ["1"])[0].lower()
            detail = catalog not in {"0", "false", "no", "summary"}
            return app.payload(pid, detail=detail)

        def _get_inputs(self, pid, query):
            path = app.require_dir(pid)
            manifest_path = path / "out" / "project-manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {}
            rel, _ = selected_bill(path)
            records = load_measurement_bundle(path).get("measurements") or []
            return {"discovered": bool(manifest), "entries": inputs_register(path, manifest, rel, records)}

        def _get_bills(self, pid, query):
            path = app.require_dir(pid)
            rel, _ = selected_bill(path)
            return {"selected": rel, "candidates": bill_candidates(path)}

        def _export(self, pid, which, fmt, query):
            path = app.require_dir(pid)
            payload = app.payload(pid, detail=False)
            scope = (query.get("scope") or ["project"])[0]
            sort_key = (query.get("sort") or [""])[0]
            sort = None
            if re.fullmatch(r"label|bill|ours|diff|pct|share|qty|rate|amount|floor:[a-z0-9_]+", sort_key):
                sort = {"key": sort_key, "dir": "desc" if (query.get("dir") or [""])[0] == "desc" else "asc"}
            if which == "bill":
                table = bill_table(payload, scope, sort)
            else:
                table = rates_table(payload, load_rates(path), scope, sort)
            name = payload.get("name") or pid
            if fmt == "csv":
                data = to_csv(table)
            elif fmt == "xlsx":
                data = to_xlsx(table, name)
            else:
                data = to_pdf(table, name)
            stamp = datetime.now().strftime("%Y%m%d")
            slug = re.sub(r"[^\w\-]+", "-", name).strip("-").lower()
            part = "" if scope in ("", "project") else f"-{re.sub(r'[^a-z0-9]+', '-', scope.lower()).strip('-')}"
            filename = f"{slug}-{'bill-comparison' if which == 'bill' else 'rates-estimate'}{part}-{stamp}.{fmt}"
            self._send_bytes(200, data, EXPORT_TYPES[fmt], filename=filename)
            return None

        def _download(self, pid, rel, query):
            path = app.require_dir(pid)
            target = _safe_download(path, rel)
            if not target:
                raise ApiError(404, "File not found.")
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            self._send_bytes(200, target.read_bytes(), ctype, filename=target.name)
            return None

        def _sheet_png(self, pid, name, query):
            project_dir = app.require_dir(pid)
            name = Path(name).name
            image = project_dir / "out" / "workspace" / name
            if not image.is_file():
                ensured = ensure_sheet_png(project_dir, Path(name).stem)
                if ensured:
                    image = ensured
            if not image.is_file():
                raise ApiError(404, "Sheet image not found.")
            self.send_response(200)
            data = image.read_bytes()
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "private, max-age=300")
            self.end_headers()
            self.wfile.write(data)
            return None

        # POST --------------------------------------------------------

        def do_POST(self):
            routes = [
                (r"^/api/auth/login$", self._login),
                (r"^/api/auth/logout$", lambda query: {}),
                (r"^/api/assistant/settings$", lambda query: agent.save_settings(self._body())),
                (r"^/api/assistant/test$", lambda query: agent.test_connection()),
                (r"^/api/projects$", self._create),
                (r"^/api/projects/([^/]+)/upload$", self._upload),
                (r"^/api/projects/([^/]+)/pipeline$", lambda pid, query: app.start_pipeline(pid, self._body())),
                (r"^/api/projects/([^/]+)/(discover|foundations|structure)$", lambda pid, kind, query: app.run_kind(pid, kind)),
                (r"^/api/projects/([^/]+)/inputs$", lambda pid, query: save_inputs(app.require_dir(pid), self._body().get("values"))),
                (r"^/api/projects/([^/]+)/bills/select$", self._select_bill),
                (r"^/api/projects/([^/]+)/measurements/manual$", lambda pid, query: {"entry": append_manual(app.require_dir(pid), self._manual_body())}),
                (r"^/api/projects/([^/]+)/measurements/manual/([^/]+)/delete$", self._delete_manual),
                (r"^/api/projects/([^/]+)/measurements/manual/([^/]+)$", self._update_manual),
                (r"^/api/projects/([^/]+)/measurements/([^/]+)/reset$", lambda pid, mid, query: {"reset": reset_measurement(app.require_dir(pid), mid)}),
                (r"^/api/projects/([^/]+)/measurements/([^/]+)$", lambda pid, mid, query: {"override": adjust_measurement(app.require_dir(pid), mid, self._body())}),
                (r"^/api/projects/([^/]+)/shapes$", self._shape),
                (r"^/api/projects/([^/]+)/bill-lines$", lambda pid, query: {"line": add_custom_line(app.require_dir(pid), self._body())}),
                (r"^/api/projects/([^/]+)/bill-lines/([^/]+)/delete$", lambda pid, lid, query: {"deleted": delete_custom_line(app.require_dir(pid), lid)}),
                (r"^/api/projects/([^/]+)/bill-lines/([^/]+)$", self._update_custom),
                (r"^/api/projects/([^/]+)/bill/([^/]+)/reset$", lambda pid, key, query: {"reset": reset_bill_line(app.require_dir(pid), key)}),
                (r"^/api/projects/([^/]+)/bill/([^/]+)/hide$", lambda pid, key, query: set_line_hidden(app.require_dir(pid), key, self._body().get("hidden", True))),
                (r"^/api/projects/([^/]+)/bill/([^/]+)$", lambda pid, key, query: {"line": adjust_bill_line(app.require_dir(pid), key, self._body())}),
                (r"^/api/projects/([^/]+)/rates/import$", self._import_rates),
                (r"^/api/projects/([^/]+)/rates$", lambda pid, query: save_rates(app.require_dir(pid), self._body())),
                (r"^/api/projects/([^/]+)/assistant/proposals/([^/]+)/(apply|reject|undo)$", self._proposal),
                (r"^/api/projects/([^/]+)/assistant$", self._assistant),
            ]
            if self._dispatch(routes) is not False:
                return
            self._json(404, {"message": "Not found."})

        def _login(self, query):
            body = self._body()
            email = (body.get("email") or "").strip()
            if not email or "@" not in email:
                raise ApiError(400, "Enter your work email.")
            name = display_name(email.split("@")[0])
            return {"token": "local-dev", "user": {"email": email, "name": name}}

        def _create(self, query):
            body = self._body()
            return app.create_project(body.get("name"), body.get("place"), files=body.get("files"))

        def _upload(self, pid, query):
            path = app.require_dir(pid)
            body = self._body()
            target = body.get("target")
            saved = []
            for item in body.get("files") or []:
                rel = _save_upload(path, item, target)
                if rel:
                    saved.append(rel)
            if target == "bills" and saved and body.get("select", True):
                select_bill(path, saved[-1])
            return {"saved": saved}

        def _select_bill(self, pid, query):
            path = app.require_dir(pid)
            rel = select_bill(path, self._body().get("file") or "")
            return {"selected": rel}

        def _manual_body(self):
            body = self._body()
            allowed = {"tag", "sheet", "element_type", "reason", "formula", "quantities", "inputs", "expressions", "points", "note"}
            return {k: v for k, v in body.items() if k in allowed}

        def _update_manual(self, pid, mid, query):
            entry = update_manual(app.require_dir(pid), mid, self._body())
            if entry is None:
                raise ApiError(404, "That manual element no longer exists.")
            return {"entry": entry}

        def _delete_manual(self, pid, mid, query):
            if not delete_manual(app.require_dir(pid), mid):
                raise ApiError(404, "That manual element no longer exists.")
            return {"deleted": True}

        def _shape(self, pid, query):
            path = app.require_dir(pid)
            body = self._body()
            sheet_id, shape_id = body.get("sheetId"), body.get("shapeId")
            if not sheet_id or not shape_id:
                raise ApiError(400, "sheetId and shapeId are required.")
            patch = None if body.get("reset") else {k: body[k] for k in ("points", "hidden") if k in body}
            return {"shape": save_shape_override(path, sheet_id, shape_id, patch)}

        def _update_custom(self, pid, lid, query):
            line = update_custom_line(app.require_dir(pid), lid, self._body())
            if line is None:
                raise ApiError(404, "That line no longer exists.")
            return {"line": line}

        def _import_rates(self, pid, query):
            path = app.require_dir(pid)
            body = self._body()
            rel = _save_upload(path, body, "rates")
            if not rel or Path(rel).suffix.lower() not in (".xlsx", ".csv"):
                raise ApiError(400, "Upload a .xlsx or .csv rates sheet.")
            rows = read_rate_rows(path / rel)
            if not rows:
                raise ApiError(422, "No rows with a description and a rate were found. Check the sheet has 'Description' and 'Rate' headers.")
            payload = app.payload(pid, detail=False)
            lines = [r for r in payload.get("comparison") or [] if not r.get("hidden")]
            suggestions, unmatched = suggest_matches(lines, rows)
            return {"file": rel, "rows": rows, "suggestions": suggestions, "unmatched": unmatched}

        def _assistant(self, pid, query):
            path = app.require_dir(pid)
            return agent.chat(path, lambda: app.payload(pid, detail=True), self._body())

        def _proposal(self, pid, proposal_id, action, query):
            path = app.require_dir(pid)
            return agent.proposal_action(path, proposal_id, action)

    if not frontend.is_dir():
        raise SystemExit(f"Frontend folder missing: {frontend}")

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Constech takeoff  http://127.0.0.1:{port}/", flush=True)
    print(f"  work folder: {work_root}", flush=True)
    print(f"  projects: {', '.join(project_slug(p) for p in app._all_dirs()) or '(none yet)'}", flush=True)
    server.serve_forever()
