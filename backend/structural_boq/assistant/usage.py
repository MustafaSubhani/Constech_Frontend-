"""Token usage ledger for the assistant.

Every model call appends one line to ~/.constech/usage.jsonl (next to the settings file):
which project and conversation it was for, the model, and the token counts the provider
reported. Settings reads it back as totals per day, project and model, with a cost estimate
for providers that publish prices.
"""
import json
import threading
from collections import defaultdict
from datetime import datetime, timedelta

from .config import config_path

_LOCK = threading.Lock()

# USD per million tokens: input, output, cache read, cache write (5 minute TTL).
PRICES = {
    "claude-fable-5-1": (10.0, 50.0, 0.25, 12.5),
    "claude-fable-5": (10.0, 50.0, 1.0, 12.5),
    "claude-opus-5-5": (4.0, 20.0, 0.20, 5.0),
    "claude-opus-5": (5.0, 25.0, 0.50, 6.25),
    "claude-opus-4-8": (5.0, 25.0, 0.50, 6.25),
    "claude-opus-4-7": (5.0, 25.0, 0.50, 6.25),
    "claude-opus-4-6": (5.0, 25.0, 0.50, 6.25),
    "claude-sonnet-5-5": (2.0, 10.0, 0.20, 2.5),
    "claude-sonnet-5": (2.0, 10.0, 0.20, 2.5),
    "claude-sonnet-4-6": (3.0, 15.0, 0.30, 3.75),
    "claude-haiku-5-5": (0.10, 0.50, 0.01, 0.125),
    "claude-haiku-4-5": (1.0, 5.0, 0.10, 1.25),
}


def _ledger():
    return config_path().parent / "usage.jsonl"


def _price(model):
    if not model:
        return None
    if model in PRICES:
        return PRICES[model]
    # Served model ids can carry a suffix; match the longest known prefix.
    for key in sorted(PRICES, key=len, reverse=True):
        if model.startswith(key):
            return PRICES[key]
    return None


def cost(model, usage):
    """Estimated USD for one call, or None when the model has no published price here."""
    price = _price(model)
    if not price:
        return None
    p_in, p_out, p_read, p_write = price
    return (
        usage.get("input", 0) * p_in
        + usage.get("output", 0) * p_out
        + usage.get("cache_read", 0) * p_read
        + usage.get("cache_write", 0) * p_write
    ) / 1_000_000


def empty():
    return {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0, "calls": 0, "cost": 0.0, "priced": True}


def add(total, usage, model):
    for key in ("input", "output", "cache_read", "cache_write"):
        total[key] = total.get(key, 0) + int(usage.get(key) or 0)
    total["calls"] = total.get("calls", 0) + 1
    value = cost(model, usage)
    if value is None:
        total["priced"] = False
    else:
        total["cost"] = round(total.get("cost", 0.0) + value, 6)
    return total


def record(project, thread_id, provider, model, usage):
    entry = {
        "at": datetime.now().isoformat(timespec="seconds"),
        "project": str(getattr(project, "name", project)),
        "thread": thread_id,
        "provider": provider,
        "model": model,
        **{k: int(usage.get(k) or 0) for k in ("input", "output", "cache_read", "cache_write")},
    }
    path = _ledger()
    try:
        with _LOCK:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(entry) + "\n")
    except OSError:
        pass  # usage tracking must never break a conversation
    return entry


def _entries():
    path = _ledger()
    if not path.is_file():
        return []
    items = []
    with _LOCK:
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return []
    for line in lines:
        try:
            items.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return items


def summary(days=30):
    """Totals for today, the last `days` days and all time; per day, per project and per model."""
    entries = _entries()
    today = datetime.now().date()
    since = today - timedelta(days=days - 1)
    totals = {"today": empty(), "period": empty(), "all": empty()}
    by_day = defaultdict(empty)
    by_project = defaultdict(empty)
    by_model = defaultdict(empty)
    for e in entries:
        try:
            day = datetime.fromisoformat(e["at"]).date()
        except (KeyError, ValueError):
            continue
        model = e.get("model") or ""
        add(totals["all"], e, model)
        if day >= since:
            add(totals["period"], e, model)
            add(by_day[day.isoformat()], e, model)
            add(by_project[e.get("project") or "?"], e, model)
            add(by_model[model or "?"], e, model)
        if day == today:
            add(totals["today"], e, model)
    days_list = []
    for n in range(days):
        key = (since + timedelta(days=n)).isoformat()
        days_list.append({"day": key, **(by_day.get(key) or empty())})
    return {
        "days": days,
        "totals": totals,
        "byDay": days_list,
        "byProject": sorted(({"project": k, **v} for k, v in by_project.items()), key=lambda r: -(r["input"] + r["output"])),
        "byModel": sorted(({"model": k, **v} for k, v in by_model.items()), key=lambda r: -(r["input"] + r["output"])),
        "ledger": str(_ledger()),
    }


def clear():
    path = _ledger()
    with _LOCK:
        if path.is_file():
            path.unlink()
    return summary()
