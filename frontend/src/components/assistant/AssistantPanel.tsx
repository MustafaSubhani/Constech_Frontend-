import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Check, ChevronDown, ChevronRight, History, Plus, Settings2, Sparkles, Square, Trash2, X, Zap } from "lucide-react";
import { api, ApiError } from "../../api/client";
import type { AssistantThread, Proposal, TranscriptItem, WorkspaceAction } from "../../types";
import { relativeTime } from "../../lib/format";
import { Menu } from "../ui/Menu";
import { ProposalCard } from "./ProposalCard";

const THREAD_KEY = (id: string) => `constech.assistant.thread.${id}`;
const MODE_KEY = "constech.assistant.autoApply";

const SUGGESTIONS: Record<string, string[]> = {
  drawings: [
    "Check the selected element against its schedule",
    "Which outlines on this sheet need review, and why?",
    "Are any footings on this sheet missing from the schedule?",
  ],
  bill: [
    "Why is the selected line off from the bill?",
    "List the lines more than 15% from the bill and the likely cause",
    "Which elements make up the selected line?",
  ],
  rates: [
    "Which measured lines still have no rate?",
    "What drives most of the estimate?",
    "Set overheads and profit to 12%",
  ],
  inputs: [
    "Read the general notes and set blinding and cover",
    "Which schedules are missing from this drawing set?",
    "Where are the storey levels given?",
  ],
};

function readMode() {
  try {
    return localStorage.getItem(MODE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Light formatting for model text: headings, paragraphs, bullet and numbered lists, **bold** and `code`. No HTML is rendered. */
function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const inline = (line: string, key: string) =>
    line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={`${key}-${i}`}>{part.slice(1, -1)}</code>;
      return <Fragment key={`${key}-${i}`}>{part}</Fragment>;
    });
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    const k = `l${blocks.length}`;
    blocks.push(
      <Tag key={k}>
        {list.items.map((item, i) => (
          <li key={i}>{inline(item, `${k}-${i}`)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  text.split("\n").forEach((raw) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
      return;
    }
    flush();
    if (heading) blocks.push(<h4 key={`h${blocks.length}`}>{inline(heading[1]!, `h${blocks.length}`)}</h4>);
    else if (line.trim()) blocks.push(<p key={`p${blocks.length}`}>{inline(line, `p${blocks.length}`)}</p>);
  });
  flush();
  return <div className="rich">{blocks}</div>;
}

function Steps({ items, live }: { items: TranscriptItem[]; live?: string }) {
  const [open, setOpen] = useState(false);
  const failed = items.filter((i) => i.error).length;
  const last = items[items.length - 1];
  return (
    <div className={`steps${live ? " live" : ""}`}>
      <button type="button" className="steps-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {live ? (
          <span className="truncate">{last?.summary || live}</span>
        ) : (
          <>
            Worked through {items.length} step{items.length === 1 ? "" : "s"}
            {failed ? <span className="muted"> · {failed} retried</span> : null}
          </>
        )}
      </button>
      {open ? (
        <ol className="steps-list">
          {items.map((item, i) => (
            <li key={i} className={item.error ? "err" : ""}>
              {item.summary}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function compact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function AssistantPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const status = useQuery({ queryKey: ["assistant-status"], queryFn: api.assistantStatus, staleTime: 60_000 });
  const enabled = Boolean(status.data?.enabled && !status.data.problems.length);
  const [threadId, setThreadId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(THREAD_KEY(projectId));
    } catch {
      return null;
    }
  });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [autoApply, setAutoApply] = useState(readMode);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);
  const seen = useRef<{ thread: string | null; count: number }>({ thread: null, count: -1 });

  const thread = useQuery({
    queryKey: ["assistant-thread", projectId, threadId],
    queryFn: () => api.assistantThread(projectId, threadId!),
    enabled: enabled && Boolean(threadId),
    retry: false,
    staleTime: 0,
    refetchInterval: (q) => (q.state.data?.running ? 500 : false),
  });
  const running = Boolean(thread.data?.running);
  const threads = useQuery({ queryKey: ["assistant-threads", projectId], queryFn: () => api.assistantThreads(projectId), enabled });
  const proposals = useQuery({
    queryKey: ["proposals", projectId],
    queryFn: () => api.proposals(projectId),
    enabled,
    refetchInterval: running ? 1500 : false,
  });
  const byId = useMemo(() => new Map<string, Proposal>((proposals.data ?? []).map((p) => [p.id, p])), [proposals.data]);

  useEffect(() => {
    try {
      if (threadId) localStorage.setItem(THREAD_KEY(projectId), threadId);
      else localStorage.removeItem(THREAD_KEY(projectId));
    } catch {
      /* storage unavailable */
    }
  }, [threadId, projectId]);

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, autoApply ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }, [autoApply]);

  // A conversation that no longer exists (deleted, or another work folder) starts fresh.
  useEffect(() => {
    if (thread.error && (thread.error as ApiError).status === 400) setThreadId(null);
  }, [thread.error]);

  // Keep the view pinned to the newest message unless the QS scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [thread.data?.transcript.length, thread.data?.run?.partial, sending]);

  const runAction = useCallback(
    (action: WorkspaceAction) => {
      const base = `/p/${encodeURIComponent(projectId)}`;
      if (action.type === "element") navigate(`${base}?sheet=${encodeURIComponent(action.sheet)}&shape=${encodeURIComponent(action.shape)}`);
      else if (action.type === "sheet") navigate(`${base}?sheet=${encodeURIComponent(action.sheet)}`);
      else if (action.type === "bill_line") navigate(`${base}/bill?line=${encodeURIComponent(action.line)}`);
      else navigate(`${base}/rates${action.line ? `?line=${encodeURIComponent(action.line)}` : ""}`);
    },
    [navigate, projectId],
  );

  // Carry out workspace moves that arrive while the QS watches; history is never replayed.
  useEffect(() => {
    const data = thread.data;
    // Cached data from before this panel opened is history, whatever arrived since.
    if (!data || !thread.isFetchedAfterMount) return;
    const items = data.transcript;
    if (seen.current.thread !== data.id || seen.current.count < 0) {
      seen.current = { thread: data.id, count: items.length };
      return;
    }
    const fresh = items.slice(seen.current.count);
    seen.current.count = items.length;
    const action = [...fresh].reverse().find((i) => i.action)?.action;
    if (action) runAction(action);
  }, [thread.data, thread.isFetchedAfterMount, runAction]);

  // When an answer has finished, refresh whatever it changed, once per run, even if the panel was
  // closed while it ran.
  const run = thread.data?.run;
  useEffect(() => {
    if (!run || run.status === "running" || !threadId) return;
    const key = `constech.assistant.synced.${threadId}`;
    let last: string | null = null;
    try {
      last = localStorage.getItem(key);
    } catch {
      /* storage unavailable */
    }
    if (last === run.id) return;
    try {
      localStorage.setItem(key, run.id);
    } catch {
      /* storage unavailable */
    }
    void qc.invalidateQueries({ queryKey: ["proposals", projectId] });
    void qc.invalidateQueries({ queryKey: ["assistant-threads", projectId] });
    if (run.changed) {
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
      void qc.invalidateQueries({ queryKey: ["inputs", projectId] });
      void qc.invalidateQueries({ queryKey: ["rates", projectId] });
    }
  }, [run?.id, run?.status, run?.changed, threadId, projectId, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  const context = useMemo(() => {
    const page = location.pathname.split("/")[3] || "drawings";
    const ctx: Record<string, string> = { page };
    const pick = (key: string, as: string) => {
      const value = params.get(key);
      if (value) ctx[as] = value;
    };
    pick("sheet", "sheet");
    pick("shape", "shape");
    pick("line", "bill_line");
    pick("scope", "scope");
    return ctx;
  }, [location.pathname, params]);

  const chips = useMemo(() => {
    const out: { key: string; label: string }[] = [];
    const pageLabel: Record<string, string> = { drawings: "Drawings", bill: "Bill", rates: "Rates", inputs: "Inputs" };
    out.push({ key: "page", label: pageLabel[context.page!] ?? context.page! });
    if (context.sheet) out.push({ key: "sheet", label: context.sheet.replace(/^\d+-/, "") });
    if (context.shape) out.push({ key: "shape", label: "Selected element" });
    if (context.bill_line) out.push({ key: "line", label: "Selected line" });
    return out;
  }, [context]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending || running) return;
    setSending(true);
    setError("");
    setDraft("");
    pinned.current = true;
    try {
      const result = await api.assistantChat(projectId, { message, threadId: threadId ?? undefined, context, autoApply });
      if (result.thread.id !== threadId) seen.current = { thread: result.thread.id, count: result.thread.transcript.length };
      // A refetch already on its way would land with the old, finished state and stop the polling.
      await qc.cancelQueries({ queryKey: ["assistant-thread", projectId, result.thread.id] });
      qc.setQueryData<AssistantThread>(["assistant-thread", projectId, result.thread.id], result.thread);
      setThreadId(result.thread.id);
      void qc.invalidateQueries({ queryKey: ["assistant-threads", projectId] });
    } catch (err) {
      setError((err as Error).message);
      setDraft(message);
    } finally {
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  async function stop() {
    if (!threadId) return;
    try {
      await api.assistantStop(projectId, threadId);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeThread(id: string) {
    try {
      await api.assistantDeleteThread(projectId, id);
      if (id === threadId) setThreadId(null);
      await qc.invalidateQueries({ queryKey: ["assistant-threads", projectId] });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const groups = useMemo(() => {
    const out: { kind: "item" | "steps"; items: TranscriptItem[] }[] = [];
    for (const item of thread.data?.transcript ?? []) {
      const last = out[out.length - 1];
      if (item.role === "tool" && !item.proposalId) {
        if (last?.kind === "steps") last.items.push(item);
        else out.push({ kind: "steps", items: [item] });
      } else out.push({ kind: "item", items: [item] });
    }
    return out;
  }, [thread.data?.transcript]);

  const usage = thread.data?.usage;
  const partial = thread.data?.run?.partial ?? "";
  const step = thread.data?.run?.step ?? "Reading the project";
  const suggestions = SUGGESTIONS[context.page!] ?? SUGGESTIONS.drawings!;
  const busy = sending || running;

  return (
    <aside className="assistant" aria-label="Assistant">
      <div className="assistant-head">
        <span className="assistant-mark">
          <Sparkles size={15} />
        </span>
        <div className="grow">
          <h3>Assistant</h3>
          <span className="muted small truncate">
            {enabled ? `${status.data?.model}${status.data?.local ? " · local" : ""}` : status.isLoading ? "Checking" : "Off"}
          </span>
        </div>
        {enabled ? (
          <>
            <Menu
              width={300}
              trigger={({ toggle }) => (
                <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={toggle} aria-label="Earlier conversations" data-tip="History" data-tip-pos="bottom">
                  <History size={16} />
                </button>
              )}
            >
              {(close) => (
                <>
                  <div className="menu-label">Conversations in this project</div>
                  <div className="thread-list">
                    {(threads.data ?? []).map((t) => (
                      <div key={t.id} className={`thread-row${t.id === threadId ? " current" : ""}`}>
                        <button type="button" className="menu-item" onClick={() => (close(), setThreadId(t.id))}>
                          <span className="grow">
                            <span className="truncate thread-title">{t.title || "Untitled"}</span>
                            <span className="thread-meta">
                              {relativeTime(t.updated)}
                              {t.messages ? ` · ${t.messages} message${t.messages === 1 ? "" : "s"}` : ""}
                            </span>
                          </span>
                          {t.id === threadId ? <Check size={14} /> : null}
                        </button>
                        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Delete conversation" onClick={() => removeThread(t.id)}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                  {!threads.data?.length ? <div className="menu-note">No conversations yet.</div> : null}
                </>
              )}
            </Menu>
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              onClick={() => {
                setThreadId(null);
                setError("");
                inputRef.current?.focus();
              }}
              disabled={running}
              aria-label="New conversation"
              data-tip="New conversation"
              data-tip-pos="bottom"
            >
              <Plus size={16} />
            </button>
          </>
        ) : null}
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close assistant">
          <X size={16} />
        </button>
      </div>

      {!enabled ? (
        <div className="assistant-body">
          <div className="assistant-off">
            <h4>The assistant is switched off</h4>
            <p>
              It reads this project through the same data you see: sheets, schedules, element records, bill lines and rates. It explains numbers with
              the drawing text behind them and can make changes for you, each of which can be undone.
            </p>
            {status.data?.problems.length ? <div className="banner banner-warn">{status.data.problems.join(" ")}</div> : null}
            <div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate("/settings#assistant")}>
                <Settings2 size={14} /> Connect in Settings
              </button>
            </div>
            <p className="muted small">Claude, OpenAI or a local model server. The key stays on the Constech server and is never sent to the browser.</p>
          </div>
        </div>
      ) : (
        <>
          <div
            className="assistant-body"
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
          >
            {!thread.data?.transcript.length && !busy ? (
              <div className="assistant-empty">
                <p className="muted">Ask about a quantity, a schedule, a bill line or the estimate. It reads what you have open.</p>
                <div className="assistant-suggestions">
                  {suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {groups.map((group, gi) => {
              const lastGroup = gi === groups.length - 1;
              if (group.kind === "steps") return <Steps key={gi} items={group.items} live={running && lastGroup ? step : undefined} />;
              const item = group.items[0]!;
              if (item.role === "user") return <div key={gi} className="msg user">{item.text}</div>;
              if (item.role === "assistant")
                return (
                  <div key={gi} className="msg bot">
                    <RichText text={item.text ?? ""} />
                  </div>
                );
              if (item.role === "notice") return <div key={gi} className={`msg notice ${item.tone ?? ""}`}>{item.text}</div>;
              const proposal = item.proposalId ? byId.get(item.proposalId) : undefined;
              return proposal ? <ProposalCard key={gi} proposal={proposal} projectId={projectId} /> : null;
            })}
            {running && partial ? (
              <div className="msg bot streaming">
                <RichText text={partial} />
              </div>
            ) : null}
            {busy && !partial ? (
              <div className="msg bot working">
                <span className="dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                {sending ? "Sending" : step}
              </div>
            ) : null}
            {error ? <div className="msg notice error">{error}</div> : null}
          </div>
          <form
            className="assistant-compose"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <div className="compose-meta">
              <div className="context-chips" title="What the assistant sees with your message">
                {chips.map((c) => (
                  <span key={c.key} className="chip chip-outline">
                    {c.label.length > 24 ? `${c.label.slice(0, 22)}…` : c.label}
                  </span>
                ))}
              </div>
              <button
                type="button"
                className={`mode-toggle${autoApply ? " on" : ""}`}
                aria-pressed={autoApply}
                onClick={() => setAutoApply((v) => !v)}
                title={autoApply ? "Changes are applied straight away; undo any from its card" : "Each change waits for you to accept it"}
              >
                <Zap size={12} /> {autoApply ? "Apply directly" : "Review changes"}
              </button>
            </div>
            <div className="compose-box">
              <textarea
                ref={inputRef}
                className="compose-input"
                rows={1}
                value={draft}
                placeholder={running ? "Answering…" : "Ask or tell it what to change"}
                onChange={(e) => {
                  setDraft(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send(draft);
                  } else if (e.key === "Escape" && running) {
                    e.preventDefault();
                    void stop();
                  }
                }}
              />
              {running ? (
                <button type="button" className="btn btn-secondary btn-icon btn-sm stop-btn" onClick={stop} aria-label="Stop" data-tip="Stop  Esc">
                  <Square size={12} fill="currentColor" />
                </button>
              ) : (
                <button type="submit" className="btn btn-primary btn-icon btn-sm" disabled={!draft.trim() || sending} aria-label="Send">
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
            <div className="compose-foot">
              <span>Enter to send · Shift Enter for a new line</span>
              {usage && usage.calls ? (
                <span title={`${usage.input.toLocaleString()} input, ${usage.cache_read.toLocaleString()} cached, ${usage.output.toLocaleString()} output tokens`}>
                  {compact(usage.input + usage.cache_read + usage.cache_write + usage.output)} tokens
                  {usage.priced && usage.cost ? ` · $${usage.cost < 0.01 ? usage.cost.toFixed(4) : usage.cost.toFixed(2)}` : ""}
                </span>
              ) : null}
            </div>
          </form>
        </>
      )}
    </aside>
  );
}
