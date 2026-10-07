"""Assistant settings.

Saved from the Settings page into a per-user file outside the repository
(~/.constech/assistant.json, or the path in CONSTECH_ASSISTANT_CONFIG). Environment
variables, when set, override the file:

CONSTECH_ASSISTANT        on | off
CONSTECH_LLM_PROVIDER     anthropic | openai | openai_compatible
CONSTECH_LLM_MODEL        model id (claude-opus-5-5 by default for anthropic)
CONSTECH_LLM_BASE_URL     e.g. http://localhost:11434/v1 (Ollama), http://localhost:1234/v1 (LM Studio)
CONSTECH_LLM_API_KEY      key; otherwise ANTHROPIC_API_KEY / OPENAI_API_KEY as the SDKs read them
CONSTECH_LLM_EFFORT       low | medium | high | xhigh (Claude only)
CONSTECH_ASSISTANT_STEPS  max tool rounds per message

The API key is never returned to the browser.
"""
import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_MODELS = {"anthropic": "claude-opus-5-5"}
PROVIDERS = ("anthropic", "openai", "openai_compatible")
EFFORTS = ("low", "medium", "high", "xhigh")
_ENV = {
    "enabled": "CONSTECH_ASSISTANT",
    "provider": "CONSTECH_LLM_PROVIDER",
    "model": "CONSTECH_LLM_MODEL",
    "base_url": "CONSTECH_LLM_BASE_URL",
    "api_key": "CONSTECH_LLM_API_KEY",
    "effort": "CONSTECH_LLM_EFFORT",
    "max_steps": "CONSTECH_ASSISTANT_STEPS",
}


def config_path():
    custom = os.environ.get("CONSTECH_ASSISTANT_CONFIG")
    return Path(custom) if custom else Path.home() / ".constech" / "assistant.json"


@dataclass
class AssistantConfig:
    enabled: bool = False
    provider: str = "anthropic"
    model: str = ""
    base_url: str = ""
    api_key: str = ""
    effort: str = "high"
    max_steps: int = 12
    from_env: list = field(default_factory=list)

    def problems(self):
        issues = []
        if self.provider not in PROVIDERS:
            issues.append(f"Unknown provider '{self.provider}'.")
        if not self.model:
            issues.append("Choose a model.")
        if self.provider == "openai_compatible" and not self.base_url:
            issues.append("Enter the local server address, e.g. http://localhost:11434/v1.")
        return issues

    def key_available(self):
        if self.api_key:
            return True
        if self.provider == "anthropic":
            return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))
        if self.provider == "openai":
            return bool(os.environ.get("OPENAI_API_KEY"))
        return True

    def public(self):
        return {
            "enabled": self.enabled,
            "provider": self.provider,
            "model": self.model,
            "baseUrl": self.base_url,
            "effort": self.effort,
            "maxSteps": self.max_steps,
            "local": self.provider == "openai_compatible",
            "keySaved": bool(self.api_key),
            "keyAvailable": self.key_available(),
            "fromEnvironment": self.from_env,
            "problems": self.problems() if self.enabled else [],
            "configFile": str(config_path()),
        }


def _read_file():
    path = config_path()
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _steps(value, default=12):
    try:
        return max(2, min(40, int(value)))
    except (TypeError, ValueError):
        return default


def load_config():
    data = _read_file()
    cfg = AssistantConfig(
        enabled=bool(data.get("enabled", False)),
        provider=str(data.get("provider") or "anthropic").lower(),
        model=str(data.get("model") or ""),
        base_url=str(data.get("base_url") or ""),
        api_key=str(data.get("api_key") or ""),
        effort=str(data.get("effort") or "high").lower(),
        max_steps=_steps(data.get("max_steps", 12)),
    )
    for name, var in _ENV.items():
        raw = os.environ.get(var)
        if raw is None or raw.strip() == "":
            continue
        raw = raw.strip()
        cfg.from_env.append(name)
        if name == "enabled":
            cfg.enabled = raw.lower() in {"1", "on", "true", "yes"}
        elif name == "max_steps":
            cfg.max_steps = _steps(raw)
        elif name in ("provider", "effort"):
            setattr(cfg, name, raw.lower())
        else:
            setattr(cfg, name, raw)
    if not cfg.model:
        cfg.model = DEFAULT_MODELS.get(cfg.provider, "")
    return cfg


def save_config(patch):
    """Update the settings file. api_key: a new value replaces it, "" keeps it, clear_key removes it."""
    data = _read_file()
    if "enabled" in patch:
        data["enabled"] = bool(patch["enabled"])
    if "provider" in patch:
        provider = str(patch["provider"]).lower()
        if provider not in PROVIDERS:
            raise ValueError(f"Provider must be one of {', '.join(PROVIDERS)}")
        data["provider"] = provider
    if "model" in patch:
        data["model"] = str(patch["model"] or "").strip()[:120]
    if "baseUrl" in patch:
        url = str(patch["baseUrl"] or "").strip()
        if url and not url.startswith(("http://", "https://")):
            raise ValueError("The server address must start with http:// or https://")
        data["base_url"] = url[:300]
    if "effort" in patch:
        effort = str(patch["effort"]).lower()
        if effort not in EFFORTS:
            raise ValueError(f"Effort must be one of {', '.join(EFFORTS)}")
        data["effort"] = effort
    if "maxSteps" in patch:
        data["max_steps"] = _steps(patch["maxSteps"])
    if patch.get("clearKey"):
        data.pop("api_key", None)
    elif patch.get("apiKey"):
        data["api_key"] = str(patch["apiKey"]).strip()
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return load_config()


def test_connection():
    """One small request to the configured model. Returns {ok, model, ms} or {ok: False, error}."""
    from .providers import ProviderError, make_adapter

    cfg = load_config()
    issues = cfg.problems()
    if issues:
        return {"ok": False, "error": " ".join(issues)}
    started = time.time()
    try:
        adapter = make_adapter(cfg)
        native = []
        adapter.add_user(native, "Reply with the single word OK.")
        turn = adapter.complete(native, "You are a connection test. Reply with OK.", [])
    except ProviderError as exc:
        return {"ok": False, "error": str(exc)}
    except Exception as exc:  # unexpected SDK errors are reported, not raised
        return {"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:300]}"}
    return {"ok": True, "model": turn.model or cfg.model, "ms": int((time.time() - started) * 1000), "reply": (turn.text or "")[:60]}
