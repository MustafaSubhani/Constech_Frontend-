"""Facade between the HTTP server and the assistant package (off unless CONSTECH_ASSISTANT=on)."""
from .assistant import proposals
from .assistant.config import load_config, save_config, test_connection as _test
from .assistant.harness import AssistantDisabled, list_threads, load_thread, public_thread, run_message

AssistantNotConnected = AssistantDisabled

INTENTS = ("chat", "discovery")


def status():
    return load_config().public()


def save_settings(body):
    return save_config(body or {}).public()


def test_connection():
    return _test()


def chat(project, payload_fn, body):
    text = str((body or {}).get("message") or "").strip()
    if not text:
        raise ValueError("Write a message first")
    task = (body or {}).get("task") or "chat"
    if task not in INTENTS:
        raise ValueError(f"Unknown task '{task}'")
    return run_message(
        project, payload_fn, text[:6000],
        thread_id=(body or {}).get("threadId"),
        context=(body or {}).get("context") or {},
        task=task,
    )


def agentic_discovery(project, payload_fn=None):
    """Runs after the rule-based pass: the assistant reviews the register and proposes corrections."""
    if not load_config().enabled:
        raise AssistantDisabled("Assistant discovery needs the assistant enabled (CONSTECH_ASSISTANT=on).")
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
