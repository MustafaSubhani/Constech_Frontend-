"""Model adapters with one shape for the harness.

Each adapter keeps the conversation in its provider's native format (so nothing is lost or
re-encoded between turns, which Claude's thinking blocks require) and returns a Turn:
text, tool calls, and a stop reason in a small common vocabulary.
SDKs are imported only when their provider is selected.
"""
import json
from dataclasses import dataclass, field


@dataclass
class ToolCall:
    id: str
    name: str
    input: dict


@dataclass
class Turn:
    text: str
    calls: list = field(default_factory=list)
    stop: str = "end"  # end | tools | max_tokens | refusal | error
    detail: str = ""
    model: str = ""


class ProviderError(RuntimeError):
    pass


class AnthropicAdapter:
    """Claude through the official SDK: manual tool loop, adaptive thinking, refusal fallbacks."""

    def __init__(self, config):
        try:
            import anthropic
        except ImportError as exc:
            raise ProviderError("Install the Anthropic SDK: py -3 -m pip install anthropic") from exc
        self._anthropic = anthropic
        kwargs = {}
        if config.api_key:
            kwargs["api_key"] = config.api_key
        if config.base_url:
            kwargs["base_url"] = config.base_url
        self.client = anthropic.Anthropic(**kwargs)
        self.config = config

    @staticmethod
    def tool_specs(tools):
        return [{"name": t["name"], "description": t["description"], "input_schema": t["schema"]} for t in tools]

    def add_user(self, native, text):
        native.append({"role": "user", "content": text})

    def complete(self, native, system, tools):
        try:
            response = self.client.beta.messages.create(
                model=self.config.model,
                max_tokens=16000,
                system=system,
                **({"tools": self.tool_specs(tools)} if tools else {}),
                messages=native,
                output_config={"effort": self.config.effort},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except self._anthropic.RateLimitError as exc:
            raise ProviderError("The model is rate limited. Try again in a moment.") from exc
        except self._anthropic.APIStatusError as exc:
            raise ProviderError(f"Model request failed ({exc.status_code}): {exc.message}") from exc
        except self._anthropic.APIConnectionError as exc:
            raise ProviderError("Cannot reach the model API.") from exc
        content = [block.model_dump(exclude_none=True) for block in response.content]
        # Append the whole content (thinking blocks included) unchanged; history is append-only.
        native.append({"role": "assistant", "content": content})
        text = "\n".join(b.get("text", "") for b in content if b.get("type") == "text").strip()
        if response.stop_reason == "refusal":
            category = getattr(response.stop_details, "category", None) if response.stop_details else None
            return Turn(text=text, stop="refusal", detail=category or "", model=response.model)
        calls = [ToolCall(b["id"], b["name"], b.get("input") or {}) for b in content if b.get("type") == "tool_use"]
        if response.stop_reason == "max_tokens" and not calls:
            return Turn(text=text, stop="max_tokens", model=response.model)
        return Turn(text=text, calls=calls, stop="tools" if calls else "end", model=response.model)

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

    def __init__(self, config):
        try:
            import openai
        except ImportError as exc:
            raise ProviderError("Install the OpenAI SDK: py -3 -m pip install openai") from exc
        self._openai = openai
        kwargs = {}
        if config.api_key:
            kwargs["api_key"] = config.api_key
        elif config.provider == "openai_compatible":
            kwargs["api_key"] = "local"  # local servers ignore it, the SDK requires one
        if config.base_url:
            kwargs["base_url"] = config.base_url
        self.client = openai.OpenAI(**kwargs)
        self.config = config

    @staticmethod
    def tool_specs(tools):
        return [{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["schema"]}} for t in tools]

    def add_user(self, native, text):
        native.append({"role": "user", "content": text})

    def complete(self, native, system, tools):
        try:
            response = self.client.chat.completions.create(
                model=self.config.model,
                messages=[{"role": "system", "content": system}, *native],
                **({"tools": self.tool_specs(tools), "tool_choice": "auto"} if tools else {}),
            )
        except self._openai.APIStatusError as exc:
            raise ProviderError(f"Model request failed ({exc.status_code}): {exc.message}") from exc
        except self._openai.APIConnectionError as exc:
            raise ProviderError("Cannot reach the model server.") from exc
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
        if choice.finish_reason == "length" and not calls:
            return Turn(text=message.content or "", stop="max_tokens", model=response.model)
        if choice.finish_reason == "content_filter":
            return Turn(text=message.content or "", stop="refusal", model=response.model)
        return Turn(text=(message.content or "").strip(), calls=calls, stop="tools" if calls else "end", model=response.model)

    def add_tool_results(self, native, results):
        for r in results:
            native.append({"role": "tool", "tool_call_id": r["id"], "content": r["content"]})


def make_adapter(config):
    if config.provider == "anthropic":
        return AnthropicAdapter(config)
    if config.provider in ("openai", "openai_compatible"):
        return OpenAIAdapter(config)
    raise ProviderError(f"Unknown provider '{config.provider}'")
