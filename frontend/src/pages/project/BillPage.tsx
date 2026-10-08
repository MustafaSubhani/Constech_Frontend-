import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, FileSpreadsheet, Plus, Search } from "lucide-react";
import { api } from "../../api/client";
import type { CompareRow, Proposal } from "../../types";
import { BAND_LABEL, bandOf, fmt, pctOf, signed, type Band } from "../../lib/format";
import { useProject } from "./ProjectContext";
import { useToast } from "../../components/ui/Toast";
import { useConfirm } from "../../components/ui/Confirm";
import { ExportMenu } from "../../components/ExportMenu";
import { CompareSource } from "../../components/bill/CompareSource";
import { BillInspector } from "../../components/bill/BillInspector";
import { LineDialog } from "../../components/bill/LineDialog";
import { ScopeSelect } from "../../components/ScopeSelect";
import { floorQty, projectFloors, scopeLabel, UNSPLIT, UNSPLIT_HINT, useScope } from "../../lib/floors";

type Filter = "all" | Band | "changed" | "hidden";
type SortKey = "default" | "label" | "bill" | "ours" | "diff" | "pct" | "share" | `floor:${string}`;

type Column = { key: SortKey | null; label: ReactNode; text: string; num?: boolean; className?: string; title?: string; cell: (row: CompareRow) => ReactNode };

function VarianceBar({ pct, band }: { pct: number | null; band: Band }) {
  if (pct == null) return <span className="var-bar" />;
  const w = Math.min(Math.abs(pct), 25) * 2;
  return (
    <span className="var-bar">
      <span className={`bg-${band}`} style={pct >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
    </span>
  );
}

export function BillPage() {
  const { project, projectId, refresh } = useProject();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "default", dir: 1 });
  const floors = projectFloors(project);
  const [scope, setScopeState] = useScope(projectId, floors);
  const mode: "project" | "floors" | "floor" = scope === "project" ? "project" : scope === "floors" ? "floors" : "floor";
  const setScope = (next: string) => {
    setScopeState(next);
    setSort({ key: "default", dir: 1 });
  };
  const [lineDialog, setLineDialog] = useState<{ open: boolean; line: CompareRow | null }>({ open: false, line: null });
  const tableRef = useRef<HTMLDivElement>(null);
  const selectedId = params.get("line");

  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("line", id);
    else next.delete("line");
    setParams(next, { replace: true });
  };

  const proposals = useQuery({ queryKey: ["proposals", projectId], queryFn: () => api.proposals(projectId), staleTime: 15_000 });
  const suggestions = useMemo(() => {
    const map = new Map<string, { proposals: Proposal[]; after: number | null }>();
    for (const p of proposals.data ?? []) {
      if (p.status !== "pending") continue;
      for (const impact of p.impacts) {
        const entry = map.get(impact.lineId) ?? { proposals: [], after: impact.before };
        entry.proposals.push(p);
        if (impact.after != null && entry.after != null && impact.before != null) entry.after += impact.after - impact.before;
        map.set(impact.lineId, entry);
      }
    }
    return map;
  }, [proposals.data]);

  const all = project.comparison;
  const visible = all.filter((r) => !r.hidden);
  const scoped = mode === "floor" ? visible.filter((r) => floorQty(r, scope) != null) : visible;
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: scoped.length, close: 0, near: 0, far: 0, open: 0, changed: 0, hidden: all.length - visible.length };
    scoped.forEach((r) => {
      c[bandOf(r)] += 1;
      if (r.adjusted || r.lineOverride || r.custom) c.changed += 1;
    });
    return c;
  }, [all, visible, scoped]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = filter === "hidden" ? all.filter((r) => r.hidden) : visible;
    const list = base.filter((r) => {
      if (mode === "floor" && floorQty(r, scope) == null) return false;
      if (filter === "changed" && !(r.adjusted || r.lineOverride || r.custom)) return false;
      if (["close", "near", "far", "open"].includes(filter) && bandOf(r) !== filter) return false;
      return !q || `${r.label} ${r.section} ${r.note ?? ""}`.toLowerCase().includes(q);
    });
    if (sort.key === "default") return list;
    const key = sort.key;
    const val = (r: CompareRow): number | string | null => {
      if (key === "label") return r.label.toLowerCase();
      if (key === "bill") return r.bill;
      if (key === "ours") return r.ours;
      if (key === "diff") return r.bill != null && r.ours != null ? r.ours - r.bill : null;
      if (key === "share") {
        const q = floorQty(r, scope);
        return q != null && r.ours ? q / r.ours : null;
      }
      if (key.startsWith("floor:")) return floorQty(r, key.slice(6));
      const pct = pctOf(r);
      return pct == null ? null : Math.abs(pct);
    };
    // Empty values stay at the bottom whichever way the column is sorted.
    return [...list].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null || vb == null) return va == null ? (vb == null ? 0 : 1) : -1;
      return va < vb ? -sort.dir : va > vb ? sort.dir : 0;
    });
  }, [all, visible, filter, query, sort, mode, scope]);

  const selected = all.find((r) => r.id === selectedId) ?? null;
  const sections = useMemo(() => [...new Set(all.map((r) => r.section))], [all]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && e.target.matches("input, textarea, select")) return;
      if (document.querySelector(".dialog-backdrop, .palette-backdrop, .menu")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape" && selectedId) select(null);
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && rows.length) {
        e.preventDefault();
        const i = rows.findIndex((r) => r.id === selectedId);
        const next = e.key === "ArrowDown" ? rows[Math.min(i + 1, rows.length - 1)] : rows[Math.max(i - 1, 0)];
        if (next) select(next.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!selectedId) return;
    tableRef.current?.querySelector(`[data-row="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : { key: "default", dir: 1 }));

  const th = (col: Column, i: number) => {
    const cls = [col.num ? "num" : "", col.className ?? ""].filter(Boolean).join(" ") || undefined;
    if (!col.key) return <th key={i} className={cls} title={col.title}>{col.label}</th>;
    const k = col.key;
    return (
      <th key={i} className={cls} title={col.title} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button type="button" className="th-sort" onClick={() => toggleSort(k)}>
          {col.label}
          {sort.key === k ? sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}
        </button>
      </th>
    );
  };

  const labelCell = (row: CompareRow) => (
    <div className="line-label">
      <span className="truncate">{row.label}</span>
      {row.lineOverride ? <span className="mini-tag info">Override</span> : null}
      {row.measureDelta ? <span className="mini-tag info">Edited</span> : null}
      {row.custom ? <span className="mini-tag brand">Manual</span> : null}
      {suggestions.has(row.id) ? <span className="mini-tag suggest">Suggested</span> : null}
      {sort.key !== "default" ? <span className="faint small">{row.section}</span> : null}
    </div>
  );
  const measuredCell = (row: CompareRow) => (
    <>
      {fmt(row.ours, row.digits)}
      {suggestions.get(row.id)?.after != null ? (
        <span className="suggested-value" title="If the suggested changes are accepted">
          {fmt(suggestions.get(row.id)!.after, row.digits)}
        </span>
      ) : null}
    </>
  );
  const billCell = (row: CompareRow) => (row.bill != null ? fmt(row.bill, row.digits) : <span className="faint">None</span>);
  const varianceText = (row: CompareRow) => {
    const pct = pctOf(row);
    return <span className={`band-${bandOf(row)}`}>{pct != null ? `${signed(pct, 1)}%` : ""}</span>;
  };

  const floorLabel = floors.find((f) => f.key === scope)?.label ?? "";
  const columns: Column[] =
    mode === "project"
      ? [
          { key: "label", label: "Item", text: "Item", cell: labelCell },
          { key: null, label: "Unit", text: "Unit", className: "muted", cell: (r) => r.unit },
          { key: "bill", label: "Bill", text: "Bill", num: true, cell: billCell },
          { key: "ours", label: "Measured", text: "Measured", num: true, cell: measuredCell },
          {
            key: "diff", label: "Difference", text: "Difference", num: true,
            cell: (r) => <span className={`band-${bandOf(r)}`}>{signed(r.bill != null && r.ours != null ? r.ours - r.bill : null, r.digits)}</span>,
          },
          {
            key: "pct", label: "Variance", text: "Variance", num: true,
            cell: (r) => (
              <span className="var-cell">
                {varianceText(r)}
                <VarianceBar pct={pctOf(r)} band={bandOf(r)} />
              </span>
            ),
          },
        ]
      : mode === "floors"
        ? [
            { key: "label", label: "Item", text: "Item", cell: labelCell },
            { key: null, label: "Unit", text: "Unit", className: "muted", cell: (r) => r.unit },
            ...floors.map<Column>((f) => ({
              key: `floor:${f.key}`,
              label: f.label,
              text: f.label,
              num: true,
              className: `floor-col${f.key === UNSPLIT ? " unsplit" : ""}`,
              title: f.key === UNSPLIT ? UNSPLIT_HINT : undefined,
              cell: (r) => fmt(floorQty(r, f.key), r.digits),
            })),
            { key: "ours", label: "Measured", text: "Measured", num: true, cell: measuredCell },
            { key: "bill", label: "Bill", text: "Bill", num: true, cell: billCell },
            { key: "pct", label: "Variance", text: "Variance", num: true, cell: varianceText },
          ]
        : [
            { key: "label", label: "Item", text: "Item", cell: labelCell },
            { key: null, label: "Unit", text: "Unit", className: "muted", cell: (r) => r.unit },
            { key: `floor:${scope}`, label: floorLabel, text: floorLabel, num: true, cell: (r) => fmt(floorQty(r, scope), r.digits) },
            {
              key: "share", label: "Share of line", text: "Share of line", num: true,
              cell: (r) => {
                const q = floorQty(r, scope);
                const share = q != null && r.ours ? (q / r.ours) * 100 : null;
                return share == null ? null : (
                  <span className="share-cell">
                    {share.toFixed(share >= 99.95 ? 0 : 1)}%
                    <span className="share-bar">
                      <span style={{ width: `${Math.min(100, Math.max(0, share))}%` }} />
                    </span>
                  </span>
                );
              },
            },
            { key: "ours", label: "Project measured", text: "Project measured", num: true, cell: measuredCell },
            { key: "bill", label: "Project bill", text: "Project bill", num: true, cell: billCell },
          ];
  const sortedBy = sort.key === "default" ? null : columns.find((c) => c.key === sort.key)?.text;
  const exportView = {
    scope,
    sort: sort.key === "default" ? undefined : sort.key,
    dir: sort.dir === 1 ? ("asc" as const) : ("desc" as const),
  };
  const exportLabel = `${scopeLabel(scope, floors)}${sortedBy ? `, sorted by ${sortedBy.toLowerCase()}` : ", in bill order"}. Hidden lines are left out.`;

  async function run(action: () => Promise<unknown>, message: string): Promise<boolean> {
    try {
      await action();
      await refresh();
      toast.success(message);
      return true;
    } catch (err) {
      toast.error((err as Error).message);
      return false;
    }
  }

  const total = scoped.length || 1;
  let lastSection = "";

  return (
    <div className="bill-page">
      <div className="bill-main">
        <header className="bill-head">
          <div className="titles">
            <h1>Bill comparison</h1>
            <CompareSource projectId={projectId} source={project.billSource} />
          </div>
          <div className="actions">
            <div className="input-group">
              <Search size={15} />
              <input className="input input-sm" placeholder="Search lines" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLineDialog({ open: true, line: null })}>
              <Plus size={14} /> Add line
            </button>
            {floors.length ? <ScopeSelect value={scope} floors={floors} onChange={setScope} /> : null}
            <ExportMenu projectId={projectId} kinds={["bill"]} disabled={!visible.length} view={exportView} viewLabel={exportLabel} />
          </div>
        </header>

        {visible.length ? (
          <div className="band-summary">
            <div className="band-bar" role="img" aria-label="Distribution of lines by variance">
              {(["close", "near", "far", "open"] as Band[]).map((b) =>
                counts[b] ? <span key={b} className={`bg-${b}`} style={{ width: `${(counts[b] / total) * 100}%` }} /> : null,
              )}
            </div>
            <div className="segmented" role="group" aria-label="Filter lines">
              {(
                [
                  ["all", "All"],
                  ["close", BAND_LABEL.close],
                  ["near", BAND_LABEL.near],
                  ["far", BAND_LABEL.far],
                  ["open", "No bill value"],
                  ["changed", "Changed"],
                  ["hidden", "Hidden"],
                ] as [Filter, string][]
              )
                .filter(([k]) => k === "all" || counts[k] > 0 || filter === k)
                .map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                    {["close", "near", "far", "open"].includes(k) ? <i className={`band-dot bg-${k}`} /> : null}
                    {label} <span className="count">{counts[k]}</span>
                  </button>
                ))}
            </div>
          </div>
        ) : null}
        {mode === "floor" ? (
          <p className="scope-note">
            {rows.length} line{rows.length === 1 ? "" : "s"} measured on the {floorLabel.toLowerCase()}. The bill gives project totals, so the
            comparison stays at line level.
          </p>
        ) : mode === "floors" && floors.some((f) => f.key === UNSPLIT) ? (
          <p className="scope-note">{UNSPLIT_HINT}</p>
        ) : null}

        <div className="bill-table" ref={tableRef}>
          {!all.length ? (
            <div className="empty-state" style={{ paddingTop: 80 }}>
              <span className="empty-icon">
                <FileSpreadsheet size={20} />
              </span>
              <h3>No comparison yet</h3>
              <p>Run the pipeline to measure the drawings, then choose a bill to compare against. You can also add lines by hand.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>{columns.map(th)}</tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const header = sort.key === "default" && row.section !== lastSection ? row.section : null;
                  lastSection = row.section;
                  return (
                    <Fragment key={row.id}>
                      {header ? (
                        <tr className="section-row">
                          <td colSpan={columns.length}>
                            {header} <span className="faint">{rows.filter((r) => r.section === header).length}</span>
                          </td>
                        </tr>
                      ) : null}
                      <tr
                        data-row={row.id}
                        className={`clickable${selectedId === row.id ? " selected" : ""}${row.hidden ? " is-hidden" : ""}`}
                        onClick={() => select(selectedId === row.id ? null : row.id)}
                      >
                        {columns.map((col, i) => (
                          <td key={i} className={[col.num ? "num" : "", col.className ?? ""].filter(Boolean).join(" ") || undefined}>
                            {col.cell(row)}
                          </td>
                        ))}
                      </tr>
                    </Fragment>
                  );
                })}
                {!rows.length ? (
                  <tr>
                    <td colSpan={columns.length} className="muted" style={{ textAlign: "center", height: 80 }}>
                      No lines match.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selected ? (
        <BillInspector
          key={selected.id}
          project={project}
          row={selected}
          suggestions={suggestions.get(selected.id)?.proposals ?? []}
          onClose={() => select(null)}
          onSaveOverride={(expression, variables, reason) =>
            run(() => api.adjustBillLine(projectId, selected.id, { expression, variables, adjustment_reason: reason || "Override in bill comparison" }), "Override saved")
          }
          onResetOverride={() => run(() => api.resetBillLine(projectId, selected.id), "Override removed")}
          onToggleHidden={() =>
            run(() => api.hideBillLine(projectId, selected.id, !selected.hidden), selected.hidden ? "Line shown again" : "Line hidden from rates and exports")
          }
          onEditCustom={() => setLineDialog({ open: true, line: selected })}
          onDeleteCustom={async () => {
            const res = await confirm({ title: "Delete this line?", message: selected.label, confirmLabel: "Delete", tone: "danger" });
            if (!res.ok) return;
            if (await run(() => api.deleteCustomLine(projectId, selected.id), "Line deleted")) select(null);
          }}
        />
      ) : null}

      <LineDialog
        open={lineDialog.open}
        line={lineDialog.line}
        sections={sections}
        floors={floors}
        onClose={() => setLineDialog({ open: false, line: null })}
        onSave={async (body) => {
          if (lineDialog.line) await api.updateCustomLine(projectId, lineDialog.line.id, body);
          else await api.addCustomLine(projectId, body);
          await refresh();
          toast.success(lineDialog.line ? "Line updated" : "Line added");
        }}
      />
    </div>
  );
}
