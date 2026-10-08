"""The assistant loop: model turn, run tools, feed results back, until the model answers.

A message starts a run in a background thread and returns at once. The run saves the
thread after every step, so the browser polls the thread and shows progress (tool steps,
streamed text) as it happens, and can stop the run. Runs are serialised per conversation;
a second message to a running conversation is refused rather than interleaved.

Edge cases handled here:
- The server restarts mid-run: the thread is marked interrupted on the next read and its
  native history repaired (missing tool results appended) so it can continue.
- The provider or model changes between messages: a new native history starts that carries
  the earlier exchange as text, instead of discarding the conversation.
- The model stops on max_tokens or a refusal with tool calls pending: those calls get error
  results so the history stays valid; max_tokens gets one more round to finish.
- Transient provider errors are retried once with a short backoff.
"""
import json
import os
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

from ..accounts import replace_file
from . import usage as usage_ledger
from .config import load_config
from .prompts import system_prompt
from .providers import ProviderError, make_adapter, transcript_history
from .tools import TOOLS, ToolContext, describe_view, run_tool


class AssistantDisabled(RuntimeError):
    pass


class AssistantBusy(RuntimeError):
    pass


_RUNS = {}  # thread_id -> Run
_RUNS_LOCK = threading.RLock()
_FILE_LOCK = threading.RLock()


class Run:
    def __init__(self, thread_id):
        self.id = f"r-{uuid.uuid4().hex[:8]}"
        self.thread_id = thread_id
        self.cancel = threading.Event()
        self.started = _now()


def _threads_dir(project):
    return Path(project) / "out" / "assistant" / "threads"


def _now():
    return datetime.now().isoformat(timespec="seconds")


def _thread_path(project, thread_id):
    safe = "".join(ch for ch in str(thread_id) if ch.isalnum() or ch in "-_")
    return _threads_dir(project) / f"{safe}.json"


def _read(path):
    with _FILE_LOCK:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None


def load_thread(project, thread_id):
    path = _thread_path(project, thread_id)
    if not path.is_file():
        return None
    thread = _read(path)
    run = (thread or {}).get("run")
    if run and run.get("status") == "running" and thread_id not in _RUNS:
        # Decide under the run lock, from a fresh read: a run that just finished saves and
        # unregisters under the same lock, so its final answer is never overwritten here.
        with _RUNS_LOCK:
            thread = _read(path)
            run = (thread or {}).get("run")
            if run and run.get("status") == "running" and thread_id not in _RUNS:
                # The process that ran it is gone (server restart or crash).
                run["status"] = "interrupted"
                run["partial"] = ""
                thread["transcript"].append({"role": "notice", "tone": "warn", "text": "The previous answer was interrupted. Send the message again to continue.", "at": _now()})
                _save(project, thread)
    return thread


def list_threads(project):
    folder = _threads_dir(project)
    if not folder.is_dir():
        return []
    items = []
    for path in sorted(folder.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:40]:
        data = _read(path)
        if not data:
            continue
        first = next((t["text"] for t in data.get("transcript") or [] if t.get("role") == "user"), "")
        items.append({
            "id": data["id"], "title": data.get("title") or first[:80], "updated": data.get("updated"),
            "task": data.get("task"), "messages": sum(1 for t in data.get("transcript") or [] if t.get("role") == "user"),
        })
    return items[:30]


def delete_thread(project, thread_id):
    if thread_id in _RUNS:
        raise AssistantBusy("Stop the answer in progress before deleting this conversation.")
    path = _thread_path(project, thread_id)
    with _FILE_LOCK:
        if path.is_file():
            path.unlink()
    return {"deleted": thread_id}


def public_thread(thread):
    data = {k: thread.get(k) for k in ("id", "created", "updated", "provider", "model", "task", "transcript", "run", "usage", "title")}
    data["running"] = bool(thread.get("run") and thread["run"].get("status") == "running")
    return data


def _save(project, thread):
    folder = _threads_dir(project)
    with _FILE_LOCK:
        folder.mkdir(parents=True, exist_ok=True)
        thread["updated"] = _now()
        path = _thread_path(project, thread["id"])
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(thread, indent=1, default=str), encoding="utf-8")
        replace_file(tmp, path)


def _summary(name, args, result, error):
    result = result if isinstance(result, dict) else {}
    if error:
        return f"{name.replace('_', ' ').capitalize()} failed: {str(result.get('error', ''))[:140]}"
    if name == "search_text":
        return f"Searched for \"{args.get('query')}\": {len(result.get('matches') or [])} matches in {result.get('sheets_searched')} sheets"
    if name == "read_sheet":
        return f"Read {result.get('sheet')} ({len(result.get('lines') or [])} lines)"
    if name == "find_schedules":
        return f"Looked for {(args.get('element') or 'any').lower()} schedules: {len(result.get('schedules') or [])} found"
    if name == "list_sheets":
        return f"Listed {len(result.get('sheets') or [])} sheets"
    if name == "get_project_overview":
        return "Read the project overview"
    if name == "get_bill_line":
        return f"Opened bill line {result.get('label') or args.get('line_id')}"
    if name == "list_bill_lines":
        return f"Read {len(result.get('lines') or [])} bill lines"
    if name == "list_measurements":
        return f"Read {len(result.get('measurements') or [])} of {result.get('total')} element records"
    if name == "get_measurement":
        return f"Opened element {result.get('tag') or args.get('measurement_id')}"
    if name == "get_rates":
        return f"Read the estimate: {result.get('priced')} lines priced"
    if name == "list_proposals":
        return f"Checked {len(result.get('proposals') or [])} earlier changes"
    if name == "get_project_rules":
        return "Read the project rules and inputs"
    if name == "evaluate_formula":
        return f"Checked {args.get('expression')} = {result.get('value')}"
    if name == "show_in_workspace":
        return result.get("summary") or "Showed it in the workspace"
    if name == "revert_change":
        return f"{str(result.get('status', '')).capitalize()}: {result.get('summary', '')}"
    if name.startswith("propose_"):
        return result.get("summary", "")
    return name.replace("_", " ")


def _new_thread(config, task):
    return {
        "id": f"t-{uuid.uuid4().hex[:10]}",
        "created": _now(),
        "provider": config.provider,
        "model": config.model,
        "task": task,
        "native": [],
        "transcript": [],
        "usage": usage_ledger.empty(),
    }


def start_message(project, payload_fn, text, thread_id=None, context=None, task="chat", auto_apply=False, wait=False):
    """Record the QS's message and start the run. Returns the thread as saved so far."""
    config = load_config()
    if not config.enabled:
        raise AssistantDisabled("The assistant is switched off. Turn it on in Settings.")
    problems = config.problems()
    if problems:
        raise AssistantDisabled(" ".join(problems))

    with _RUNS_LOCK:
        if thread_id and thread_id in _RUNS:
            raise AssistantBusy("The assistant is still answering in this conversation. Wait for it or stop it first.")
        thread = load_thread(project, thread_id) if thread_id else None
        if thread is None:
            thread = _new_thread(config, task)
        run = Run(thread["id"])
        _RUNS[thread["id"]] = run

    try:
        return _begin(project, payload_fn, text, thread, run, config, context, task, auto_apply, wait)
    except BaseException:
        # Anything that stops the run from starting must not leave the conversation locked.
        with _RUNS_LOCK:
            if _RUNS.get(thread["id"]) is run:
                _RUNS.pop(thread["id"], None)
        raise


def _begin(project, payload_fn, text, thread, run, config, context, task, auto_apply, wait):
    try:
        adapter = make_adapter(config)
    except ProviderError as exc:
        raise AssistantDisabled(str(exc)) from exc
    except Exception as exc:  # SDK constructors raise their own errors (e.g. a missing key)
        raise AssistantDisabled(f"The model client could not start: {str(exc)[:240]}") from exc

    switched = thread.get("provider") != config.provider or thread.get("model") != config.model
    if switched and thread.get("native"):
        # Native history is model specific; carry the conversation over as text.
        recap = transcript_history(thread.get("transcript"))
        thread["native"] = []
        if recap:
            adapter.add_user(thread["native"], "Earlier in this conversation (with another model):\n" + recap)
            thread["native"].append({"role": "assistant", "content": "Understood. I have the earlier conversation."})
        thread["transcript"].append({"role": "notice", "text": f"Continuing with {config.model}. Earlier messages were carried over as text.", "at": _now()})
    thread["provider"], thread["model"] = config.provider, config.model
    thread.setdefault("usage", usage_ledger.empty())
    adapter.repair(thread["native"])

    thread["transcript"].append({"role": "user", "text": text, "at": _now()})
    if not thread.get("title"):
        thread["title"] = text.strip().splitlines()[0][:80]
    thread["run"] = {"id": run.id, "status": "running", "startedAt": run.started, "partial": "", "step": "Reading the project", "autoApply": bool(auto_apply)}
    _save(project, thread)

    args = (project, payload_fn, thread, adapter, config, run, text, context or {}, task, auto_apply)
    if wait:
        _run(*args)
    else:
        threading.Thread(target=_run, args=args, daemon=True, name=f"assistant-{thread['id']}").start()
    return thread


def cancel(project, thread_id):
    run = _RUNS.get(thread_id)
    if not run:
        return {"cancelled": False}
    run.cancel.set()
    return {"cancelled": True}


def _run(project, payload_fn, thread, adapter, config, run, text, context, task, auto_apply):
    ctx = ToolContext(project, payload_fn, thread["id"], auto_apply=auto_apply)
    state = thread["run"]
    last_flush = [0.0]

    def flush(force=False):
        now = time.time()
        if force or now - last_flush[0] > 0.35:
            last_flush[0] = now
            _save(project, thread)

    def on_text(delta):
        state["partial"] += delta
        flush()

    def notice(tone, message):
        thread["transcript"].append({"role": "notice", "tone": tone, "text": message, "at": _now()})

    try:
        try:
            view = describe_view(ctx, context)
        except Exception as exc:  # a broken view must not block the question
            view = ""
            print(f"  assistant view warning: {exc}", flush=True)
        adapter.add_user(thread["native"], text, context=view)
        system = system_prompt(thread.get("task") or task)
        extra_round = False
        step = 0
        while True:
            if run.cancel.is_set():
                notice("warn", "Stopped.")
                state["status"] = "cancelled"
                break
            if step >= config.max_steps + (1 if extra_round else 0):
                notice("warn", f"Stopped after {config.max_steps} tool rounds. Ask to continue if more work is needed.")
                state["status"] = "done"
                break
            step += 1
            state["partial"] = ""
            turn = None
            for attempt in (1, 2):
                try:
                    turn = adapter.complete(thread["native"], system, TOOLS, on_text=on_text, should_stop=run.cancel.is_set)
                    break
                except ProviderError as exc:
                    if exc.retryable and attempt == 1 and not run.cancel.is_set():
                        state["step"] = "Retrying after a provider error"
                        flush(True)
                        time.sleep(2.5)
                        continue
                    notice("error", str(exc))
                    state["status"] = "error"
            if turn is None:
                break
            if turn.usage:
                usage_ledger.add(thread["usage"], turn.usage, turn.model or config.model)
                usage_ledger.record(project, thread["id"], config.provider, turn.model or config.model, turn.usage)
            if turn.stop == "cancelled":
                notice("warn", "Stopped.")
                state["status"] = "cancelled"
                break
            state["partial"] = ""
            if turn.text:
                thread["transcript"].append({"role": "assistant", "text": turn.text, "at": _now()})
            if turn.stop in ("refusal", "max_tokens") and turn.calls:
                # Unfinished or declined calls must still get results, or the history is invalid.
                adapter.add_tool_results(thread["native"], [
                    {"id": c.id, "content": "Not run: the response was cut off before this call was complete. Call it again." if turn.stop == "max_tokens" else "Not run.", "error": True}
                    for c in turn.calls
                ])
            if turn.stop == "refusal":
                notice("warn", "The model declined this request." + (f" ({turn.detail})" if turn.detail else ""))
                state["status"] = "done"
                break
            if turn.stop == "max_tokens":
                if turn.calls and not extra_round:
                    extra_round = True
                    continue
                notice("warn", "The answer was cut off. Ask for a shorter answer or narrow the question.")
                state["status"] = "done"
                break
            if not turn.calls:
                state["status"] = "done"
                break
            results = []
            for call in turn.calls:
                if run.cancel.is_set():
                    results.append({"id": call.id, "content": "Not run: the QS stopped the request.", "error": True})
                    continue
                state["step"] = call.name.replace("_", " ").capitalize()
                flush(True)
                content, error, result = run_tool(ctx, call.name, call.input)
                results.append({"id": call.id, "content": content, "error": error})
                item = {"role": "tool", "name": call.name, "summary": _summary(call.name, call.input, result, error), "error": error, "at": _now()}
                if call.name.startswith("propose_") and not error and result.get("proposal_id"):
                    item["proposalId"] = result["proposal_id"]
                if call.name == "show_in_workspace" and not error and result.get("action"):
                    item["action"] = result["action"]
                if call.name == "revert_change" and not error:
                    item["proposalId"] = result.get("proposal_id")
                thread["transcript"].append(item)
                flush(True)
            adapter.add_tool_results(thread["native"], results)
            state["step"] = "Thinking"
            flush(True)
    except Exception as exc:  # never leave a run hanging in "running"
        notice("error", f"The assistant hit an unexpected error: {type(exc).__name__}: {str(exc)[:300]}")
        state["status"] = "error"
        adapter.repair(thread["native"])
    finally:
        if state.get("status") == "running":
            state["status"] = "done"
        state["partial"] = ""
        state["endedAt"] = _now()
        state["changed"] = ctx.changed
        with _RUNS_LOCK:
            try:
                _save(project, thread)
            except OSError as exc:
                print(f"  assistant: could not save thread {thread['id']}: {exc}", flush=True)
            finally:
                _RUNS.pop(thread["id"], None)


def run_message(project, payload_fn, text, thread_id=None, context=None, task="chat"):
    """Synchronous run (used by agentic discovery inside the pipeline)."""
    thread = start_message(project, payload_fn, text, thread_id=thread_id, context=context, task=task, wait=True)
    saved = load_thread(project, thread["id"]) or thread
    start = max(i for i, t in enumerate(saved["transcript"]) if t.get("role") == "user")
    return {"thread": public_thread(saved), "new": saved["transcript"][start:]}
