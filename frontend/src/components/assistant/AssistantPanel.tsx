import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ChevronDown, ChevronRight, History, Plus, Settings2, Sparkles, X } from "lucide-react";
import { api } from "../../api/client";
import type { AssistantThread, Proposal, TranscriptItem } from "../../types";
import { SUGGESTED_PROMPTS } from "../../assistant/types";
import { Menu } from "../ui/Menu";
import { ProposalCard } from "./ProposalCard";

const THREAD_KEY = (id: string) => `constech.assistant.thread.${id}`;

/** Light formatting for model text: paragraphs, bullet lists and **bold**. No HTML is rendered. */
function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const inline = (line: string, key: number) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong> : <Fragment key={`${key}-${i}`}>{part}</Fragment>,
    );
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={`l${blocks.length}`}>
          {list.map((item, i) => (
            <li key={i}>{inline(item, i)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  text.split("\n").forEach((raw) => {
    const line = raw.trimEnd();
    if (/^\s*[-*•]\s+/.test(line)) list.push(line.replace(/^\s*[-*•]\s+/, ""));
    else {
      flush();
      if (line.trim()) blocks.push(<p key={`p${blocks.length}`}>{inline(line, blocks.length)}</p>);
    }
  });
  flush();
  return <div className="rich">{blocks}</div>;
}

function Steps({ items }: { items: TranscriptItem[] }) {
  const [open, setOpen] = useState(false);
  const failed = items.filter((i) => i.error).length;
  return (
    <div className="steps">
      <button type="button" className="steps-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Worked through {items.length} step{items.length === 1 ? "" : "s"}
        {failed ? <span className="muted"> · {failed} failed</span> : null}
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

export function AssistantPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const status = useQuery({ queryKey: ["assistant-status"], queryFn: api.assistantStatus, staleTime: 60_000 });
  const enabled = Boolean(status.data?.enabled && !status.data.problems.length);
  const [threadId, setThreadId] = useState<string | null>(() => localStorage.getItem(THREAD_KEY(projectId)));
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const thread = useQuery({
    queryKey: ["assistant-thread", projectId, threadId],
    queryFn: () => api.assistantThread(projectId, threadId!),
    enabled: enabled && Boolean(threadId),
    retry: false,
  });
  const threads = useQuery({ queryKey: ["assistant-threads", projectId], queryFn: () => api.assistantThreads(projectId), enabled });
  const proposals = useQuery({ queryKey: ["proposals", projectId], queryFn: () => api.proposals(projectId), enabled });
  const byId = useMemo(() => new Map<string, Proposal>((proposals.data ?? []).map((p) => [p.id, p])), [proposals.data]);

  useEffect(() => {
    if (threadId) localStorage.setItem(THREAD_KEY(projectId), threadId);
    else localStorage.removeItem(THREAD_KEY(projectId));
  }, [threadId, projectId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [thread.data?.transcript.length, sending]);

  const context = useMemo(() => {
    const page = location.pathname.split("/")[3] || "drawings";
    const ctx: Record<string, string> = { page };
    if (params.get("sheet")) ctx.sheet = params.get("sheet")!;
    if (params.get("line")) ctx.bill_line = params.get("line")!;
    if (params.get("shape")) ctx.outline = params.get("shape")!;
    return ctx;
  }, [location.pathname, params]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setError("");
    setDraft("");
    try {
      const result = await api.assistantChat(projectId, { message, threadId: threadId ?? undefined, context });
      qc.setQueryData<AssistantThread>(["assistant-thread", projectId, result.thread.id], result.thread);
      setThreadId(result.thread.id);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["proposals", projectId] }),
        qc.invalidateQueries({ queryKey: ["assistant-threads", projectId] }),
      ]);
    } catch (err) {
      setError((err as Error).message);
      setDraft(message);
    } finally {
      setSending(false);
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

  return (
    <aside className="assistant" aria-label="Assistant">
      <div className="assistant-head">
        <span className="assistant-mark">
          <Sparkles size={14} />
        </span>
        <div className="grow">
          <h3>Assistant</h3>
          <span className="muted small">{enabled ? `${status.data?.model}${status.data?.local ? " (local)" : ""}` : "Off"}</span>
        </div>
        {enabled ? (
          <>
            <Menu
              width={280}
              trigger={({ toggle }) => (
                <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={toggle} aria-label="Earlier conversations" title="Earlier conversations">
                  <History size={15} />
                </button>
              )}
            >
              {(close) => (
                <>
                  <div className="menu-label">Earlier conversations</div>
                  {(threads.data ?? []).map((t) => (
                    <button key={t.id} type="button" className="menu-item" aria-checked={t.id === threadId} onClick={() => (close(), setThreadId(t.id))}>
                      <span className="truncate">{t.title || "Untitled"}</span>
                    </button>
                  ))}
                  {!threads.data?.length ? <div className="menu-item muted">None yet</div> : null}
                </>
              )}
            </Menu>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setThreadId(null)} aria-label="New conversation" title="New conversation">
              <Plus size={15} />
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
              It reads this project through the same data you see: sheets, schedules, element records and bill lines. It proposes changes
              with the exact drawing text behind them, and nothing changes until you accept. Every accepted change can be undone.
            </p>
            {status.data?.problems.length ? (
              <div className="banner banner-warn">{status.data.problems.join(" ")}</div>
            ) : null}
            <div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate("/settings#assistant")}>
                <Settings2 size={14} /> Connect in Settings
              </button>
            </div>
            <p className="muted small">
              Claude, OpenAI or a local model server. The key stays on the Constech server and is never sent to the browser.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="assistant-body" ref={scrollRef}>
            {!thread.data?.transcript.length && !sending ? (
              <div className="assistant-empty">
                <p className="muted">Ask about a quantity, a schedule or a bill line. Changes come back as proposals for you to review.</p>
                <div className="assistant-suggestions">
                  {SUGGESTED_PROMPTS.map((s) => (
                    <button key={s.text} type="button" onClick={() => send(s.text)}>
                      {s.text}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {groups.map((group, gi) => {
              if (group.kind === "steps") return <Steps key={gi} items={group.items} />;
              const item = group.items[0]!;
              if (item.role === "user") return <div key={gi} className="msg user">{item.text}</div>;
              if (item.role === "assistant") return <div key={gi} className="msg bot"><RichText text={item.text ?? ""} /></div>;
              if (item.role === "notice") return <div key={gi} className={`msg notice ${item.tone ?? ""}`}>{item.text}</div>;
              const proposal = item.proposalId ? byId.get(item.proposalId) : undefined;
              return proposal ? <ProposalCard key={gi} proposal={proposal} projectId={projectId} /> : null;
            })}
            {sending ? (
              <div className="msg bot working">
                <span className="spinner" /> Reading the project
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
            <div className="context-chips">
              {Object.entries(context).map(([k, v]) => (
                <span key={k} className="chip chip-outline" title={`${k}: ${v}`}>
                  {v.length > 26 ? `${v.slice(0, 24)}…` : v}
                </span>
              ))}
            </div>
            <div className="compose-row">
              <textarea
                className="textarea"
                rows={2}
                value={draft}
                placeholder="Ask about this project"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(draft);
                  }
                }}
              />
              <button type="submit" className="btn btn-primary btn-icon" disabled={!draft.trim() || sending} aria-label="Send">
                <ArrowUp size={16} />
              </button>
            </div>
          </form>
        </>
      )}
    </aside>
  );
}
