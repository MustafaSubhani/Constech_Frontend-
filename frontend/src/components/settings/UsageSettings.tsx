import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Trash2 } from "lucide-react";
import { api } from "../../api/client";
import type { TokenUsage } from "../../types";
import { useConfirm } from "../ui/Confirm";
import { useToast } from "../ui/Toast";
import { SectionHead } from "./parts";

function total(u: TokenUsage) {
  return u.input + u.output + u.cache_read + u.cache_write;
}

function tokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function dollars(u: TokenUsage) {
  if (!u.calls) return "$0.00";
  const text = u.cost < 0.01 && u.cost > 0 ? `$${u.cost.toFixed(4)}` : `$${u.cost.toFixed(2)}`;
  return u.priced ? text : `${text}+`;
}

/** Tokens the assistant has used on this server: totals, a 30-day chart, and splits by project and model. */
export function UsageSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [days, setDays] = useState(30);
  const usage = useQuery({ queryKey: ["assistant-usage", days], queryFn: () => api.assistantUsage(days), refetchInterval: 30_000 });
  const data = usage.data;
  const peak = useMemo(() => Math.max(1, ...(data?.byDay ?? []).map(total)), [data]);
  const [hover, setHover] = useState<number | null>(null);

  async function clear() {
    const result = await confirm({
      title: "Clear token usage?",
      message: "The usage history on this server is deleted. Conversations are kept.",
      confirmLabel: "Clear",
      tone: "danger",
    });
    if (!result.ok) return;
    try {
      const cleared = await api.clearAssistantUsage();
      qc.setQueryData(["assistant-usage", days], cleared);
      toast.success("Usage history cleared");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const hovered = hover != null ? data?.byDay[hover] : null;

  return (
    <section className="card settings-card" id="usage">
      <SectionHead
        title="Token usage"
        hint="Every assistant request on this server, as reported by the provider. Costs are estimates at list price; local models have no cost."
        action={
          <div className="row" style={{ gap: 4 }}>
            <div className="segmented">
              {[7, 30, 90].map((d) => (
                <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>
                  {d} days
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Refresh" onClick={() => usage.refetch()}>
              <RefreshCw size={14} className={usage.isFetching ? "spin" : undefined} />
            </button>
          </div>
        }
      />
      {usage.error ? <div className="banner banner-bad">{(usage.error as Error).message}</div> : null}
      {data ? (
        <>
          <div className="usage-stats">
            {(
              [
                ["Today", data.totals.today],
                [`Last ${days} days`, data.totals.period],
                ["All time", data.totals.all],
              ] as [string, TokenUsage][]
            ).map(([label, u]) => (
              <div key={label} className="usage-stat">
                <span className="stat-label">{label}</span>
                <span className="stat-value">{tokens(total(u))}</span>
                <span className="stat-sub">
                  {dollars(u)} · {u.calls} request{u.calls === 1 ? "" : "s"}
                </span>
              </div>
            ))}
          </div>
          <div className="usage-chart" onMouseLeave={() => setHover(null)}>
            <div className="usage-bars" role="img" aria-label={`Tokens per day over the last ${days} days`}>
              {data.byDay.map((d, i) => {
                const t = total(d);
                const fresh = d.input + d.output + d.cache_write;
                return (
                  <div key={d.day} className={`usage-bar${hover === i ? " on" : ""}`} onMouseEnter={() => setHover(i)}>
                    <span className="cached" style={{ height: `${((t - fresh) / peak) * 100}%` }} />
                    <span className="fresh" style={{ height: `${(fresh / peak) * 100}%` }} />
                  </div>
                );
              })}
            </div>
            <div className="usage-axis">
              <span>{new Date(data.byDay[0]!.day).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
              <span className="usage-legend">
                <i className="fresh" /> Input and output <i className="cached" /> Read from cache
              </span>
              <span>Today</span>
            </div>
            <div className="usage-tip">
              {hovered ? (
                <>
                  <strong>{new Date(hovered.day).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</strong>
                  {` · ${tokens(total(hovered))} tokens (${tokens(hovered.input)} in, ${tokens(hovered.output)} out, ${tokens(hovered.cache_read)} cached) · ${dollars(hovered)}`}
                </>
              ) : (
                <span className="faint">Point at a day for its breakdown.</span>
              )}
            </div>
          </div>
          {data.byProject.length || data.byModel.length ? (
            <div className="usage-split">
              <UsageTable title="By project" rows={data.byProject.map((r) => ({ key: r.project, usage: r }))} />
              <UsageTable title="By model" rows={data.byModel.map((r) => ({ key: r.model, usage: r }))} />
            </div>
          ) : (
            <p className="muted small usage-empty">No assistant requests in this period.</p>
          )}
          <div className="settings-actions">
            <span className="muted small truncate">Kept in {data.ledger}</span>
            <div className="grow" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={clear} disabled={!data.totals.all.calls}>
              <Trash2 size={14} /> Clear history
            </button>
          </div>
        </>
      ) : (
        <p className="muted small usage-empty">{usage.isLoading ? "Loading" : ""}</p>
      )}
    </section>
  );
}

function UsageTable({ title, rows }: { title: string; rows: { key: string; usage: TokenUsage }[] }) {
  const max = Math.max(1, ...rows.map((r) => total(r.usage)));
  return (
    <div className="usage-table">
      <h3>{title}</h3>
      {rows.slice(0, 6).map((r) => (
        <div key={r.key} className="usage-row">
          <span className="truncate">{r.key}</span>
          <span className="tnum muted">{tokens(total(r.usage))}</span>
          <span className="tnum">{dollars(r.usage)}</span>
          <span className="usage-meter">
            <span style={{ width: `${(total(r.usage) / max) * 100}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}
