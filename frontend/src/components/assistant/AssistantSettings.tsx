import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, PlugZap, XCircle } from "lucide-react";
import { api } from "../../api/client";
import type { AssistantProvider, AssistantStatus } from "../../types";
import { useToast } from "../ui/Toast";
import { SectionHead } from "../settings/parts";

const PROVIDERS: { value: AssistantProvider; label: string; hint: string }[] = [
  { value: "anthropic", label: "Claude", hint: "Anthropic API" },
  { value: "openai", label: "OpenAI", hint: "OpenAI API" },
  { value: "openai_compatible", label: "Local model", hint: "Ollama, LM Studio, vLLM" },
];

const MODEL_HINTS: Record<AssistantProvider, string> = {
  anthropic: "claude-opus-5-5",
  openai: "Model id from your OpenAI account",
  openai_compatible: "e.g. qwen2.5:32b, llama3.3:70b",
};

/** Settings card for connecting the assistant. The key is sent once and never shown again. */
export function AssistantSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({ queryKey: ["assistant-status"], queryFn: api.assistantStatus });
  const [form, setForm] = useState<AssistantStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (status.data && !form) setForm(status.data);
  }, [status.data, form]);

  if (!form) {
    return (
      <section className="card settings-card" id="assistant">
        <SectionHead title="Assistant" />
        <p className="muted small" style={{ padding: "0 0 16px" }}>
          {status.error ? (status.error as Error).message : "Loading"}
        </p>
      </section>
    );
  }

  const locked = (field: string) => form.fromEnvironment.includes(field);
  const set = (patch: Partial<AssistantStatus>) => setForm((f) => (f ? { ...f, ...patch } : f));

  async function save(extra: Record<string, unknown> = {}) {
    if (!form) return;
    setBusy(true);
    setTest(null);
    try {
      const saved = await api.saveAssistantSettings({
        enabled: form.enabled,
        provider: form.provider,
        model: form.model,
        baseUrl: form.baseUrl,
        effort: form.effort,
        maxSteps: form.maxSteps,
        ...(apiKey ? { apiKey } : {}),
        ...extra,
      });
      setForm(saved);
      setApiKey("");
      qc.setQueryData(["assistant-status"], saved);
      toast.success("Assistant settings saved");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    if (!form) return;
    setBusy(true);
    setTest(null);
    try {
      const saved = await api.saveAssistantSettings({
        enabled: form.enabled, provider: form.provider, model: form.model, baseUrl: form.baseUrl,
        effort: form.effort, maxSteps: form.maxSteps, ...(apiKey ? { apiKey } : {}),
      });
      setForm(saved);
      setApiKey("");
      qc.setQueryData(["assistant-status"], saved);
      const result = await api.testAssistant();
      setTest(result.ok ? { ok: true, text: `Connected to ${result.model} in ${result.ms} ms` } : { ok: false, text: result.error ?? "Failed" });
    } catch (err) {
      setTest({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card settings-card" id="assistant">
      <SectionHead title="Assistant" hint="Reads your projects with tools and makes changes you can review or undo. Off until you switch it on." />
      <div className="settings-row">
        <div className="grow">
          <h3>Enable the assistant</h3>
          <p>Available on Drawings, Bill comparison, Rates and Schedules and inputs.</p>
        </div>
        <label className="switch">
          <input type="checkbox" checked={form.enabled} disabled={locked("enabled")} onChange={(e) => set({ enabled: e.target.checked })} />
          <span />
        </label>
      </div>

      <div className="settings-row">
        <div className="grow">
          <h3>Provider</h3>
          <p>{PROVIDERS.find((p) => p.value === form.provider)?.hint}</p>
        </div>
        <div className="segmented">
          {PROVIDERS.map((p) => (
            <button
              key={p.value}
              type="button"
              aria-pressed={form.provider === p.value}
              disabled={locked("provider")}
              onClick={() => set({ provider: p.value, model: p.value === "anthropic" && !form.model ? "claude-opus-5-5" : form.provider === p.value ? form.model : "" })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-row">
        <div className="grow">
          <h3>Model</h3>
          <p>The model id the provider expects.</p>
        </div>
        <input
          className="input field-lg"
          value={form.model}
          placeholder={MODEL_HINTS[form.provider]}
          disabled={locked("model")}
          onChange={(e) => set({ model: e.target.value })}
        />
      </div>

      {form.provider !== "anthropic" ? (
        <div className="settings-row">
          <div className="grow">
            <h3>Server address</h3>
            <p>{form.provider === "openai_compatible" ? "The OpenAI-compatible endpoint of your local server." : "Leave empty for the standard OpenAI endpoint."}</p>
          </div>
          <input
            className="input field-lg"
            value={form.baseUrl}
            placeholder={form.provider === "openai_compatible" ? "http://localhost:11434/v1" : "https://api.openai.com/v1"}
            disabled={locked("base_url")}
            onChange={(e) => set({ baseUrl: e.target.value })}
          />
        </div>
      ) : null}

      <div className="settings-row">
        <div className="grow">
          <h3>API key</h3>
          <p>
            Stored on this server only and never shown again.
            {!form.keySaved && form.keyAvailable && form.provider !== "openai_compatible" ? " A key from the server environment is in use." : ""}
            {form.provider === "openai_compatible" ? " Most local servers do not need one." : ""}
          </p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <div className="input-group field-lg">
            <KeyRound size={15} />
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={apiKey}
              placeholder={form.keySaved ? "Saved; enter a new key to replace" : "Paste a key"}
              disabled={locked("api_key")}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          {form.keySaved ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => save({ clearKey: true })} disabled={busy}>
              Remove
            </button>
          ) : null}
        </div>
      </div>

      {form.provider === "anthropic" ? (
        <div className="settings-row">
          <div className="grow">
            <h3>Reasoning effort</h3>
            <p>Higher effort reads more carefully and costs more per question.</p>
          </div>
          <div className="segmented">
            {(["low", "medium", "high", "xhigh"] as const).map((e) => (
              <button key={e} type="button" aria-pressed={form.effort === e} disabled={locked("effort")} onClick={() => set({ effort: e })}>
                {e === "xhigh" ? "Extra high" : e[0]!.toUpperCase() + e.slice(1)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="settings-row">
        <div className="grow">
          <h3>Tool rounds per question</h3>
          <p>How many times it may read or search before it has to answer.</p>
        </div>
        <input
          className="input input-num"
          style={{ width: 96 }}
          type="number"
          min={2}
          max={40}
          value={form.maxSteps}
          disabled={locked("max_steps")}
          onChange={(e) => set({ maxSteps: Number(e.target.value) || 12 })}
        />
      </div>

      {form.fromEnvironment.length ? (
        <p className="muted small" style={{ paddingBottom: 8 }}>
          Set by the server environment and locked here: {form.fromEnvironment.join(", ").replace(/_/g, " ")}.
        </p>
      ) : null}
      {form.enabled && form.problems.length ? <div className="banner banner-warn" style={{ marginBottom: 12 }}>{form.problems.join(" ")}</div> : null}

      <div className="settings-actions">
        {test ? (
          <span className={`test-result ${test.ok ? "ok" : "bad"}`}>
            {test.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />} {test.text}
          </span>
        ) : (
          <span className="muted small">Saved to {form.configFile}</span>
        )}
        <div className="grow" />
        <button type="button" className="btn btn-secondary" onClick={runTest} disabled={busy}>
          <PlugZap size={15} /> Test connection
        </button>
        <button type="button" className="btn btn-primary" onClick={() => save()} disabled={busy}>
          {busy ? <span className="spinner" /> : null} Save
        </button>
      </div>
    </section>
  );
}
