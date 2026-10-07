"""The assistant loop: model turn, run tools, feed results back, until the model answers."""
import json
import uuid
from datetime import datetime
from pathlib import Path

from .config import load_config
from .prompts import system_prompt
from .providers import ProviderError, make_adapter
from .tools import TOOLS, ToolContext, run_tool


class AssistantDisabled(RuntimeError):
    pass


def _threads_dir(project):
    return Path(project) / "out" / "assistant" / "threads"


def _now():
    return datetime.now().isoformat(timespec="seconds")


def load_thread(project, thread_id):
    path = _threads_dir(project) / f"{thread_id}.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def list_threads(project):
    folder = _threads_dir(project)
    if not folder.is_dir():
        return []
    items = []
    for path in sorted(folder.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        first = next((t["text"] for t in data.get("transcript") or [] if t.get("role") == "user"), "")
        items.append({"id": data["id"], "title": first[:80], "updated": data.get("updated"), "task": data.get("task")})
    return items[:30]


def public_thread(thread):
    return {k: thread.get(k) for k in ("id", "created", "updated", "provider", "model", "task", "transcript")}


def _save(project, thread):
    folder = _threads_dir(project)
    folder.mkdir(parents=True, exist_ok=True)
    thread["updated"] = _now()
    (folder / f"{thread['id']}.json").write_text(json.dumps(thread, indent=1, default=str), encoding="utf-8")


def _summary(name, args, result_text, error):
    try:
        result = json.loads(result_text)
    except json.JSONDecodeError:
        result = {}
    if error:
        return f"{name.replace('_', ' ')} failed: {str(result.get('error', ''))[:120]}"
    if name == "search_text":
        return f"Searched for \"{args.get('query')}\": {len(result.get('matches') or [])} matches in {result.get('sheets_searched')} sheets"
    if name == "read_sheet":
        return f"Read {result.get('sheet')} ({len(result.get('lines') or [])} lines)"
    if name == "find_schedules":
        return f"Looked for {(args.get('element') or 'any').lower()} schedules: {len(result.get('schedules') or [])} found"
    if name == "list_sheets":
        return f"Listed {len(result.get('sheets') or [])} sheets"
    if name == "get_bill_line":
        return f"Opened bill line {result.get('label') or args.get('line_id')}"
    if name == "list_bill_lines":
        return f"Read {len(result.get('lines') or [])} bill lines"
    if name in ("list_measurements",):
        return f"Read {len(result.get('measurements') or [])} element records"
    if name == "get_measurement":
        return f"Opened element {result.get('tag') or args.get('measurement_id')}"
    if name == "evaluate_formula":
        return f"Checked {args.get('expression')} = {result.get('value')}"
    if name.startswith("propose_"):
        return f"Proposed: {result.get('summary', '')}"
    return name.replace("_", " ")


def run_message(project, payload_fn, text, thread_id=None, context=None, task="chat"):
    config = load_config()
    if not config.enabled:
        raise AssistantDisabled("The assistant is switched off. Set CONSTECH_ASSISTANT=on on the server to enable it.")
    problems = config.problems()
    if problems:
        raise AssistantDisabled(" ".join(problems))
    adapter = make_adapter(config)

    thread = load_thread(project, thread_id) if thread_id else None
    if thread and (thread.get("provider") != config.provider or thread.get("model") != config.model):
        thread = None  # native history is provider specific; start fresh rather than translate it
    if thread is None:
        thread = {
            "id": f"t-{uuid.uuid4().hex[:10]}",
            "created": _now(),
            "provider": config.provider,
            "model": config.model,
            "task": task,
            "native": [],
            "transcript": [],
        }
    ctx = ToolContext(project, payload_fn, thread["id"])
    view = ""
    if context:
        view = "; ".join(f"{k}: {v}" for k, v in context.items() if v)
    prompt = f"{text}\n\n(Currently open: {view})" if view else text
    adapter.add_user(thread["native"], prompt)
    thread["transcript"].append({"role": "user", "text": text, "at": _now()})
    system = system_prompt(thread.get("task") or task)
    start = len(thread["transcript"]) - 1

    for _step in range(config.max_steps):
        try:
            turn = adapter.complete(thread["native"], system, TOOLS)
        except ProviderError as exc:
            thread["transcript"].append({"role": "notice", "tone": "error", "text": str(exc), "at": _now()})
            break
        if turn.text:
            thread["transcript"].append({"role": "assistant", "text": turn.text, "at": _now()})
        if turn.stop == "refusal":
            thread["transcript"].append({"role": "notice", "tone": "warn", "text": "The model declined this request." + (f" ({turn.detail})" if turn.detail else ""), "at": _now()})
            break
        if turn.stop == "max_tokens":
            thread["transcript"].append({"role": "notice", "tone": "warn", "text": "The answer was cut off. Ask for a shorter answer or narrow the question.", "at": _now()})
            break
        if not turn.calls:
            break
        results = []
        for call in turn.calls:
            content, error = run_tool(ctx, call.name, call.input)
            results.append({"id": call.id, "content": content, "error": error})
            item = {"role": "tool", "name": call.name, "summary": _summary(call.name, call.input, content, error), "error": error, "at": _now()}
            if call.name.startswith("propose_") and not error:
                try:
                    item["proposalId"] = json.loads(content).get("proposal_id")
                except json.JSONDecodeError:
                    pass
            thread["transcript"].append(item)
        adapter.add_tool_results(thread["native"], results)
    else:
        thread["transcript"].append({
            "role": "notice", "tone": "warn",
            "text": f"Stopped after {config.max_steps} tool rounds. Ask to continue if more work is needed.", "at": _now(),
        })
    _save(project, thread)
    return {"thread": public_thread(thread), "new": thread["transcript"][start:]}
