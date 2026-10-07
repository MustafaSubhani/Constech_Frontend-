"""Staged project pipeline with live progress for the takeoff UI.

Stages run in a background thread. Each stage reports its own status, timing,
and the engine's printed lines, so the UI can show the work as it happens.
"""
import io
import json
import sys
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

STAGES = (
    ("files", "Load project files"),
    ("discover", "Discover drawing set"),
    ("foundations", "Measure foundations"),
    ("structure", "Measure structure"),
    ("sheets", "Build sheet views"),
    ("compare", "Compare with bill"),
)
ENGINE_STAGES = ("discover", "foundations", "structure")
DISCOVERY_STRATEGIES = ("rules", "agentic")
_SKIP_DIRS = {"out", "node_modules", ".git"}
_APP_FILES = {
    "bill-adjustments.json", "measurement-overrides.json", "manual-measurements.json",
    "shape-overrides.json", "rates.json", "bill-selection.json", "pipeline-state.json",
    "project-inputs.json",
}


class _ThreadStdout(io.TextIOBase):
    """Routes print() from a pipeline thread into that job's log, and still echoes to the console."""

    def __init__(self, base):
        self._base = base
        self._local = threading.local()

    def bind(self, sink):
        self._local.sink = sink

    def unbind(self):
        self._local.sink = None

    def write(self, text):
        sink = getattr(self._local, "sink", None)
        if sink is not None and text:
            sink(text)
        return self._base.write(text)

    def flush(self):
        self._base.flush()

    def __getattr__(self, name):
        return getattr(self._base, name)


def _install_stdout():
    if not isinstance(sys.stdout, _ThreadStdout):
        sys.stdout = _ThreadStdout(sys.stdout)
    return sys.stdout


def project_files(project):
    project = Path(project)
    files = []
    for path in sorted(project.rglob("*")):
        rel_parts = path.relative_to(project).parts
        if not path.is_file() or set(rel_parts) & _SKIP_DIRS or path.name.startswith(("~$", "._")):
            continue
        if path.name == "project.json":
            continue
        suffix = path.suffix.lower().lstrip(".")
        if suffix in ("dwg", "dxf"):
            kind = "drawing"
        elif suffix == "pdf":
            kind = "sheet"
        elif suffix in ("xlsx", "csv", "xls"):
            kind = "rates" if rel_parts[0] == "rates" else "bill"
        elif suffix in ("txt", "md"):
            kind = "notes"
        else:
            kind = "other"
        stat = path.stat()
        files.append({
            "path": str(path.relative_to(project)).replace("\\", "/"),
            "name": path.name,
            "ext": suffix,
            "kind": kind,
            "sizeBytes": stat.st_size,
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
        })
    return files


def _stat_items(paths):
    items = []
    for path in paths:
        try:
            stat = path.stat()
        except OSError:
            continue
        items.append((path.name, stat.st_mtime_ns, stat.st_size))
    return items


def catalog_fingerprint(project):
    """Changes when anything the sheet views are built from changes."""
    project = Path(project)
    out = project / "out"
    inputs = [p for p in out.glob("*.json") if p.name not in _APP_FILES] if out.is_dir() else []
    pdfs = list((project / "pdf").glob("*.pdf")) if (project / "pdf").is_dir() else []
    return hash(tuple(sorted(_stat_items(inputs + pdfs))))


def payload_fingerprint(project):
    """Changes when anything shown in the workspace changes."""
    project = Path(project)
    out = project / "out"
    files = [p for p in out.glob("*") if p.is_file() and p.name != "pipeline-state.json"] if out.is_dir() else []
    roots = [p for p in project.glob("*") if p.is_file()]
    bills = list((project / "bills").glob("*")) if (project / "bills").is_dir() else []
    return hash(tuple(sorted(_stat_items(files + roots + bills))))


def _state_path(project):
    return Path(project) / "out" / "pipeline-state.json"


def load_state(project):
    path = _state_path(project)
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save_state(project, stages):
    path = _state_path(project)
    path.parent.mkdir(parents=True, exist_ok=True)
    keep = {
        s["key"]: {k: s.get(k) for k in ("status", "detail", "endedAt", "durationMs")}
        for s in stages
        if s["key"] in ENGINE_STAGES and s["status"] in ("done", "error")
    }
    state = load_state(project)
    state.setdefault("stages", {}).update(keep)
    state["updated"] = datetime.now().isoformat(timespec="seconds")
    path.write_text(json.dumps(state, indent=2), encoding="utf-8")


class PipelineJob:
    def __init__(self, project_id, plan):
        self.id = uuid.uuid4().hex[:10]
        self.project_id = project_id
        self.status = "running"
        self.started = time.time()
        self.ended = None
        self.error = ""
        self.lock = threading.Lock()
        self.log = []
        self.stages = []
        for key, label in STAGES:
            action = plan.get(key, "run")
            self.stages.append({
                "key": key,
                "label": label,
                "status": "pending" if action == "run" else action,
                "detail": "",
                "progress": None,
                "startedAt": None,
                "endedAt": None,
                "durationMs": None,
                "lines": [],
            })

    def _stage(self, key):
        return next(s for s in self.stages if s["key"] == key)

    def write(self, key, text):
        with self.lock:
            stage = self._stage(key)
            for line in text.splitlines():
                line = line.rstrip()
                if not line:
                    continue
                stage["lines"].append(line[:240])
                self.log.append({"stage": key, "line": line[:240], "t": round(time.time() - self.started, 2)})
            stage["lines"] = stage["lines"][-60:]
            self.log = self.log[-400:]

    def update(self, key, **fields):
        with self.lock:
            self._stage(key).update(fields)

    def snapshot(self):
        with self.lock:
            return {
                "id": self.id,
                "projectId": self.project_id,
                "status": self.status,
                "error": self.error,
                "startedAt": datetime.fromtimestamp(self.started).isoformat(timespec="seconds"),
                "elapsedMs": int(((self.ended or time.time()) - self.started) * 1000),
                "stages": [dict(s, lines=list(s["lines"][-12:])) for s in self.stages],
            }


def run_job(job, project, runners):
    """Run each planned stage in order. runners: {key: callable(job, report)} returning a detail string."""
    out = _install_stdout()

    def run_stage(stage):
        key = stage["key"]
        job.update(key, status="running", startedAt=datetime.now().isoformat(timespec="seconds"))
        started = time.time()
        out.bind(lambda text: job.write(key, text))
        try:
            detail = runners[key](lambda **fields: job.update(key, **fields)) or ""
            job.update(key, status="done", detail=detail, progress=1.0)
        except BaseException as exc:  # engine code raises SystemExit for missing inputs
            message = str(exc) or exc.__class__.__name__
            job.update(key, status="error", detail=message[:400])
            return False
        finally:
            out.unbind()
            job.update(
                key,
                endedAt=datetime.now().isoformat(timespec="seconds"),
                durationMs=int((time.time() - started) * 1000),
            )
        return True

    failed = False
    for stage in job.stages:
        if stage["status"] != "pending":
            continue
        if failed and stage["key"] in ENGINE_STAGES:
            job.update(stage["key"], status="blocked", detail="Stopped because an earlier stage failed")
            continue
        ok = run_stage(stage)
        if not ok and stage["key"] in ("files", "discover"):
            failed = True
    try:
        _save_state(project, job.stages)
    except OSError:
        pass
    with job.lock:
        job.ended = time.time()
        errors = [s for s in job.stages if s["status"] == "error"]
        job.status = "error" if errors and all(s["status"] != "done" for s in job.stages if s["key"] in ("sheets", "compare")) else "done"
        if errors:
            job.error = f"{errors[0]['label']}: {errors[0]['detail']}"
