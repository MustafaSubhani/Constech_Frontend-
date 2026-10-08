"""Facade between the HTTP server and the assistant package (off until enabled in Settings)."""
from .assistant import proposals
from .assistant import usage as usage_ledger
from .assistant.config import load_config, save_config, test_connection as _test
from .assistant.harness import (
    AssistantBusy,
    AssistantDisabled,
    cancel,
    delete_thread,
    list_threads,
    load_thread,
    public_thread,
    run_message,
    start_message,
)

AssistantNotConnected = AssistantDisabled

INTENTS = ("chat", "discovery")
# Pages the assistant works on; elsewhere the panel is not offered.
PAGES = {"drawings", "bill", "rates", "inputs"}


def status():
    return load_config().public()


def save_settings(body):
    return save_config(body or {}).public()


def test_connection():
    return _test()


def usage(days=30):
    return usage_ledger.summary(days)


def clear_usage():
    return usage_ledger.clear()


def chat(project, payload_fn, body):
    """Start an answer in the background; the browser polls the thread for progress."""
    body = body or {}
    text = str(body.get("message") or "").strip()
    if not text:
        raise ValueError("Write a message first")
    task = body.get("task") or "chat"
    if task not in INTENTS:
        raise ValueError(f"Unknown task '{task}'")
    raw_context = body.get("context") if isinstance(body.get("context"), dict) else {}
    context = {str(k): str(v)[:200] for k, v in raw_context.items() if v not in (None, "")}
    if context.get("page") and context["page"] not in PAGES:
        context["page"] = "drawings"
    thread = start_message(
        project, payload_fn, text[:8000],
        thread_id=body.get("threadId") or None,
        context=context,
        task=task,
        auto_apply=bool(body.get("autoApply")),
    )
    return {"thread": public_thread(thread)}


def stop(project, thread_id):
    return cancel(project, thread_id)


def agentic_discovery(project, payload_fn=None):
    """Runs after the rule-based pass: the assistant reviews the register and proposes corrections."""
    if not load_config().enabled:
        raise AssistantDisabled("Assistant discovery needs the assistant enabled in Settings.")
    return run_message(
        project, payload_fn or (lambda: {}),
        "Review this drawing set: find every schedule, the notes values and storey levels, and propose corrections.",
        task="discovery",
    )


def thread(project, thread_id):
    data = load_thread(project, thread_id)
    if not data:
        raise ValueError("Conversation not found")
    return public_thread(data)


def threads(project):
    return list_threads(project)


def remove_thread(project, thread_id):
    return delete_thread(project, thread_id)


def proposal_list(project):
    return proposals.load_all(project)


def proposal_action(project, proposal_id, action):
    if action == "apply":
        return proposals.apply(project, proposal_id)
    if action == "reject":
        return proposals.reject(project, proposal_id)
    if action == "undo":
        return proposals.undo(project, proposal_id)
    raise ValueError(f"Unknown action '{action}'")
