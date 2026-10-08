"""Model adapters with one shape for the harness.

Each adapter keeps the conversation in its provider's native format (so nothing is lost or
re-encoded between turns, which Claude's thinking blocks require) and returns a Turn:
text, tool calls, a stop reason in a small common vocabulary, and token usage.
SDKs are imported only when their provider is selected.

Native history is append-only. The one exception is the repair step, which only ever
appends: when a run stopped after the model asked for tools but before their results were
recorded, matching error results are added so the next request is valid.
"""
import json
from dataclasses import dataclass, field

# Claude models that accept the server-side refusal fallback ("default" routing).
_FALLBACK_MODELS = ("claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5")
# Optional request features switched off for a (base_url, model) after the API rejects them by name.
_DEGRADED = {}  # key -> set of feature names
_FEATURE_WORDS = {
    "context": ("context_management", "context-management", "clear_tool_uses"),
    "fallback": ("fallback",),
    "cache": ("cache_control",),
    "effort": ("effort", "output_config"),
}


@dataclass
class ToolCall:
    id: str
    name: str
    input: dict


@dataclass
class Turn:
    text: str
    calls: list = field(default_factory=list)
    stop: str = "end"  # end | tools | max_tokens | refusal | cancelled
    detail: str = ""
    model: str = ""
    usage: dict = field(default_factory=dict)


class ProviderError(RuntimeError):
    def __init__(self, message, retryable=False):
        super().__init__(message)
        self.retryable = retryable


STOPPED_RESULT = "This tool did not run: the request was stopped before it finished."


def transcript_history(transcript, limit_chars=24000):
    """Plain-text history rebuilt from the transcript, for a conversation that changes model.

    Native history is provider and model specific (Claude thinking blocks are bound to the
    model that wrote them), so a switch starts a new native history that carries the earlier
    exchange as text instead of dropping it.
    """
    lines = []
    for item in transcript or []:
        role = item.get("role")
        if role == "user":
            lines.append(f"QS: {item.get('text', '')}")
        elif role == "assistant":
            lines.append(f"Assistant: {item.get('text', '')}")
        elif role == "tool" and item.get("proposalId"):
            lines.append(f"(Assistant {item.get('summary', '')}; proposal {item['proposalId']})")
    text = "\n".join(lines)
    if len(text) > limit_chars:
        text = "…" + text[-limit_chars:]
    return text


class AnthropicAdapter:
    """Claude through the official SDK: streamed manual tool loop, prompt caching, refusal fallbacks."""

    provider = "anthropic"

    def __init__(self, config):
        try:
            import anthropic
        except ImportError as exc:
            raise ProviderError("Install the Anthropic SDK: py -3 -m pip install anthropic") from exc
        self._anthropic = anthropic
        kwargs = {"max_retries": 3}
        if config.api_key:
            kwargs["api_key"] = config.api_key
        if config.base_url:
            kwargs["base_url"] = config.base_url
        self.client = anthropic.Anthropic(**kwargs)
        self.config = config
        self._key = (config.base_url or "", config.model)

    @staticmethod
    def tool_specs(tools):
        return [{"name": t["name"], "description": t["description"], "input_schema": t["schema"]} for t in tools]

    def add_user(self, native, text, context=""):
        if context:
            native.append({"role": "user", "content": [{"type": "text", "text": context}, {"type": "text", "text": text}]})
        else:
            native.append({"role": "user", "content": text})

    def repair(self, native):
        """Append error results for tool calls left without results (stopped or crashed runs)."""
        if not native or native[-1].get("role") != "assistant":
            return False
        content = native[-1].get("content")
        calls = [b for b in content if isinstance(b, dict) and b.get("type") == "tool_use"] if isinstance(content, list) else []
        if not calls:
            return False
        self.add_tool_results(native, [{"id": b["id"], "content": STOPPED_RESULT, "error": True} for b in calls])
        return True

    def _request(self, native, system, tools):
        kw = {
            "model": self.config.model,
            "max_tokens": 32000,
            # The system prompt and tool list never change between turns: cache them,
            # and let the top-level breakpoint cache the growing conversation prefix.
            "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            "messages": native,
        }
        if tools:
            kw["tools"] = self.tool_specs(tools)
        # Newer request fields go in extra_body so an older installed SDK still sends them.
        off = _DEGRADED.get(self._key, set())
        extra = {}
        betas = []
        if "effort" not in off:
            extra["output_config"] = {"effort": self.config.effort}
        if "cache" not in off:
            extra["cache_control"] = {"type": "ephemeral"}
        if tools and "context" not in off:
            # Old tool results are cleared server-side once the context grows large;
            # the stored history stays complete and append-only.
            betas.append("context-management-2025-06-27")
            extra["context_management"] = {"edits": [{"type": "clear_tool_uses_20250919"}]}
        if "fallback" not in off and not self.config.base_url and self.config.model in _FALLBACK_MODELS:
            betas.append("server-side-fallback-2026-07-01")
            extra["fallbacks"] = "default"
        if betas:
            kw["betas"] = betas
        kw["extra_body"] = extra
        return kw

    def complete(self, native, system, tools, on_text=None, should_stop=None):
        anthropic = self._anthropic
        for attempt in range(1, 6):
            kw = self._request(native, system, tools)
            try:
                with self.client.beta.messages.stream(**kw) as stream:
                    for event in stream:
                        if should_stop and should_stop():
                            return Turn(text="", stop="cancelled", model=self.config.model)
                        if on_text and event.type == "content_block_delta" and getattr(event.delta, "type", "") == "text_delta":
                            on_text(event.delta.text)
                    response = stream.get_final_message()
                break
            except anthropic.BadRequestError as exc:
                # A proxy or account without one of the optional features: retry without the
                # feature the error names. Any other 400 is a real error and is reported.
                text = str(exc.message or "").lower()
                off = _DEGRADED.setdefault(self._key, set())
                named = {f for f, words in _FEATURE_WORDS.items() if f not in off and any(w in text for w in words)}
                if not named and "beta" in text:
                    named = {f for f in ("context", "fallback") if f not in off}
                if named:
                    off.update(named)
                    continue
                raise ProviderError(f"The model rejected the request: {exc.message}") from exc
            except anthropic.AuthenticationError as exc:
                raise ProviderError("The API key was not accepted. Check it in Settings.") from exc
            except anthropic.PermissionDeniedError as exc:
                raise ProviderError(f"This key cannot use {self.config.model}: {exc.message}") from exc
            except anthropic.NotFoundError as exc:
                raise ProviderError(f"Model '{self.config.model}' was not found. Check the model id in Settings.") from exc
            except anthropic.RateLimitError as exc:
                raise ProviderError("The model is rate limited. Try again in a moment.", retryable=True) from exc
            except anthropic.APIStatusError as exc:
                raise ProviderError(f"Model request failed ({exc.status_code}): {exc.message}", retryable=exc.status_code >= 500) from exc
            except anthropic.APIConnectionError as exc:
                raise ProviderError("Cannot reach the model API. Check the connection.", retryable=True) from exc
            except (TypeError, ValueError) as exc:  # an SDK too old for a request field, or a bad local value
                raise ProviderError(f"The request could not be sent ({type(exc).__name__}: {str(exc)[:200]}). Update the anthropic package.") from exc

        content = [block.model_dump(exclude_none=True) for block in response.content]
        # Append the whole content (thinking and fallback blocks included) unchanged; history is append-only.
        native.append({"role": "assistant", "content": content})
        raw = response.usage
        usage = {
            "input": getattr(raw, "input_tokens", 0) or 0,
            "output": getattr(raw, "output_tokens", 0) or 0,
            "cache_read": getattr(raw, "cache_read_input_tokens", 0) or 0,
            "cache_write": getattr(raw, "cache_creation_input_tokens", 0) or 0,
        }
        text = "\n".join(b.get("text", "") for b in content if b.get("type") == "text").strip()
        calls = [ToolCall(b["id"], b["name"], b.get("input") or {}) for b in content if b.get("type") == "tool_use"]
        if response.stop_reason == "refusal":
            category = getattr(response.stop_details, "category", None) if getattr(response, "stop_details", None) else None
            return Turn(text=text, calls=calls, stop="refusal", detail=category or "", model=response.model, usage=usage)
        if response.stop_reason == "max_tokens":
            return Turn(text=text, calls=calls, stop="max_tokens", model=response.model, usage=usage)
        return Turn(text=text, calls=calls, stop="tools" if calls else "end", model=response.model, usage=usage)

    def add_tool_results(self, native, results):
        # All results for one assistant turn go back in a single user message.
        native.append({
            "role": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": r["id"], "content": r["content"], **({"is_error": True} if r["error"] else {})}
                for r in results
            ],
        })


class OpenAIAdapter:
    """OpenAI Chat Completions; also any OpenAI-compatible local server via base_url."""

    provider = "openai"

    def __init__(self, config):
        try:
            import openai
        except ImportError as exc:
            raise ProviderError("Install the OpenAI SDK: py -3 -m pip install openai") from exc
        self._openai = openai
        kwargs = {"max_retries": 3}
        if config.api_key:
            kwargs["api_key"] = config.api_key
        elif config.provider == "openai_compatible":
            kwargs["api_key"] = "local"  # local servers ignore it, the SDK requires one
        if config.base_url:
            kwargs["base_url"] = config.base_url
        self.client = openai.OpenAI(**kwargs)
        self.config = config
        # Local models usually have small context windows; keep the history within budget.
        self.budget_chars = 60_000 if config.provider == "openai_compatible" else 400_000

    @staticmethod
    def tool_specs(tools):
        return [{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["schema"]}} for t in tools]

    def add_user(self, native, text, context=""):
        native.append({"role": "user", "content": f"{context}\n\n{text}" if context else text})

    def repair(self, native):
        if not native or native[-1].get("role") != "assistant" or not native[-1].get("tool_calls"):
            return False
        self.add_tool_results(native, [{"id": c["id"], "content": STOPPED_RESULT, "error": True} for c in native[-1]["tool_calls"]])
        return True

    def _fit(self, native):
        """Chat Completions has no thinking blocks, so old tool results can be shortened in place."""
        total = sum(len(str(m.get("content") or "")) for m in native)
        if total <= self.budget_chars:
            return
        # Results the model has not seen yet (after its last turn) are always kept.
        last_assistant = max((i for i, m in enumerate(native) if m.get("role") == "assistant"), default=-1)
        older = [m for m in native[:max(0, len(native) - 6)]] + [m for m in native[max(0, len(native) - 6):last_assistant]]
        for message in older:
            if message.get("role") == "tool" and len(message.get("content") or "") > 300:
                total -= len(message["content"]) - 120
                message["content"] = "[Earlier tool result removed to keep the conversation within the model's context. Call the tool again if needed.]"
                if total <= self.budget_chars:
                    return

    def complete(self, native, system, tools, on_text=None, should_stop=None):
        if should_stop and should_stop():
            return Turn(text="", stop="cancelled", model=self.config.model)
        self._fit(native)
        try:
            response = self.client.chat.completions.create(
                model=self.config.model,
                messages=[{"role": "system", "content": system}, *native],
                **({"tools": self.tool_specs(tools), "tool_choice": "auto"} if tools else {}),
            )
        except self._openai.AuthenticationError as exc:
            raise ProviderError("The API key was not accepted. Check it in Settings.") from exc
        except self._openai.NotFoundError as exc:
            raise ProviderError(f"Model '{self.config.model}' was not found on this server.") from exc
        except self._openai.RateLimitError as exc:
            raise ProviderError("The model is rate limited. Try again in a moment.", retryable=True) from exc
        except self._openai.APIStatusError as exc:
            raise ProviderError(f"Model request failed ({exc.status_code}): {exc.message}", retryable=exc.status_code >= 500) from exc
        except self._openai.APIConnectionError as exc:
            raise ProviderError("Cannot reach the model server. Check that it is running.", retryable=True) from exc
        if should_stop and should_stop():
            return Turn(text="", stop="cancelled", model=self.config.model)
        choice = response.choices[0]
        message = choice.message
        calls = []
        stored_calls = []
        for call in message.tool_calls or []:
            try:
                args = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {"_invalid_json": call.function.arguments}
            calls.append(ToolCall(call.id, call.function.name, args))
            stored_calls.append({"id": call.id, "type": "function", "function": {"name": call.function.name, "arguments": call.function.arguments or "{}"}})
        entry = {"role": "assistant", "content": message.content or ""}
        if stored_calls:
            entry["tool_calls"] = stored_calls
        native.append(entry)
        raw = getattr(response, "usage", None)
        cached = getattr(getattr(raw, "prompt_tokens_details", None), "cached_tokens", 0) or 0
        usage = {
            "input": max(0, (getattr(raw, "prompt_tokens", 0) or 0) - cached),
            "output": getattr(raw, "completion_tokens", 0) or 0,
            "cache_read": cached,
            "cache_write": 0,
        }
        text = (message.content or "").strip()
        if text and on_text:
            on_text(text)
        if choice.finish_reason == "length":
            return Turn(text=text, calls=calls, stop="max_tokens", model=response.model, usage=usage)
        if choice.finish_reason == "content_filter":
            return Turn(text=text, calls=calls, stop="refusal", model=response.model, usage=usage)
        return Turn(text=text, calls=calls, stop="tools" if calls else "end", model=response.model, usage=usage)

    def add_tool_results(self, native, results):
        for r in results:
            native.append({"role": "tool", "tool_call_id": r["id"], "content": r["content"]})


def make_adapter(config):
    if config.provider == "anthropic":
        return AnthropicAdapter(config)
    if config.provider in ("openai", "openai_compatible"):
        return OpenAIAdapter(config)
    raise ProviderError(f"Unknown provider '{config.provider}'")
