import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, Coins, Eraser, FileUp } from "lucide-react";
import { api } from "../../api/client";
import type { CompareRow, RatesDoc } from "../../types";
import { fmt, money } from "../../lib/format";
import { CURRENCIES, getSettings } from "../../lib/settings";
import { useProject } from "./ProjectContext";
import { useToast } from "../../components/ui/Toast";
import { useConfirm } from "../../components/ui/Confirm";
import { ExportMenu } from "../../components/ExportMenu";
import { RatesImportDialog } from "../../components/rates/RatesImportDialog";
import { ScopeSelect } from "../../components/ScopeSelect";
import { floorQty, projectFloors, scopeLabel, UNSPLIT, UNSPLIT_HINT, useScope } from "../../lib/floors";

type SaveState = "idle" | "saving" | "saved" | "error";
type SortKey = "default" | "label" | "qty" | "rate" | "amount" | `floor:${string}`;

export function RatesPage() {
  const { project, projectId } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const doc = useQuery({ queryKey: ["rates", projectId], queryFn: () => api.getRates(projectId) });

  const [rates, setRates] = useState<Record<string, string>>({});
  const [currency, setCurrency] = useState(getSettings().currency);
  const [markup, setMarkup] = useState(String(getSettings().defaultMarkupPercent));
  const [source, setSource] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [importOpen, setImportOpen] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "default", dir: 1 });
  const floors = projectFloors(project);
  const [scope, setScopeState] = useScope(projectId, floors);
  const mode: "project" | "floors" | "floor" = scope === "project" ? "project" : scope === "floors" ? "floors" : "floor";
  const setScope = (next: string) => {
    setScopeState(next);
    setSort({ key: "default", dir: 1 });
  };
  const loaded = useRef(false);
  const dirty = useRef(false);
  const timer = useRef(0);

  useEffect(() => {
    if (!doc.data || loaded.current) return;
    loaded.current = true;
    const d = doc.data;
    setRates(Object.fromEntries(Object.entries(d.rates).map(([k, v]) => [k, String(v)])));
    if (d.currency) {
      setCurrency(d.currency);
      setMarkup(String(d.markupPercent));
    }
    setSource(d.source ?? "");
  }, [doc.data]);

  const payload = useCallback((): Partial<RatesDoc> => {
    const clean: Record<string, number> = {};
    Object.entries(rates).forEach(([k, v]) => {
      const n = Number(v);
      if (v.trim() !== "" && Number.isFinite(n) && n >= 0) clean[k] = n;
    });
    return { currency, markupPercent: Math.min(100, Math.max(0, Number(markup) || 0)), rates: clean, source };
  }, [rates, currency, markup, source]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    setSaveState("saving");
    try {
      const saved = await api.saveRates(projectId, payload());
      qc.setQueryData(["rates", projectId], saved);
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      toast.error((err as Error).message);
    }
  }, [payload, projectId, qc, toast]);

  useEffect(() => {
    if (!loaded.current || !dirty.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 700);
    return () => window.clearTimeout(timer.current);
  }, [rates, currency, markup, source, flush]);

  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => void flushRef.current(), []);

  const touch = () => {
    dirty.current = true;
    setSaveState("idle");
  };

  const allLines = useMemo(() => project.comparison.filter((r) => !r.hidden && r.ours != null), [project.comparison]);
  const rateOf = useCallback(
    (id: string): number | null => {
      const raw = rates[id];
      if (!raw?.trim()) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    },
    [rates],
  );
  // The quantity priced in this scope: the line total, or what was measured on the chosen floor.
  const qtyOf = useCallback((l: CompareRow) => (mode === "floor" ? floorQty(l, scope) : l.ours), [mode, scope]);
  const amountOf = useCallback(
    (l: CompareRow): number | null => {
      const r = rateOf(l.id);
      const q = qtyOf(l);
      return r == null || q == null ? null : q * r;
    },
    [rateOf, qtyOf],
  );
  const floorAmount = (l: CompareRow, floor: string): number | null => {
    const r = rateOf(l.id);
    const q = floorQty(l, floor);
    return r == null || q == null ? null : q * r;
  };

  const lines = useMemo(() => {
    const list = mode === "floor" ? allLines.filter((l) => floorQty(l, scope) != null) : allLines;
    if (sort.key === "default") return list;
    const key = sort.key;
    const val = (l: CompareRow): number | string | null => {
      if (key === "label") return l.label.toLowerCase();
      if (key === "qty") return qtyOf(l);
      if (key === "rate") return rateOf(l.id);
      if (key === "amount") return amountOf(l);
      return floorAmount(l, key.slice(6));
    };
    return [...list].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null || vb == null) return va == null ? (vb == null ? 0 : 1) : -1;
      return va < vb ? -sort.dir : va > vb ? sort.dir : 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLines, mode, scope, sort, rates]);

  const direct = lines.reduce((sum, l) => sum + (amountOf(l) ?? 0), 0);
  const projectDirect = allLines.reduce((sum, l) => sum + (rateOf(l.id) != null && l.ours != null ? l.ours * rateOf(l.id)! : 0), 0);
  const markupPct = Math.min(100, Math.max(0, Number(markup) || 0));
  const markupAmount = (direct * markupPct) / 100;
  const rated = allLines.filter((l) => rateOf(l.id) != null).length;
  const byFloor = useMemo(
    () =>
      floors.map((f) => ({
        ...f,
        amount: allLines.reduce((sum, l) => sum + (floorAmount(l, f.key) ?? 0), 0),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [floors, allLines, rates],
  );
  const sections = useMemo(() => {
    const groups = new Map<string, CompareRow[]>();
    lines.forEach((l) => groups.set(l.section, [...(groups.get(l.section) ?? []), l]));
    return [...groups.entries()];
  }, [lines]);
  const drivers = useMemo(
    () =>
      lines
        .filter((l) => amountOf(l))
        .sort((a, b) => amountOf(b)! - amountOf(a)!)
        .slice(0, 6),
    [lines, amountOf],
  );

  if (!allLines.length) {
    return (
      <div className="page-scroll">
        <div className="empty-state" style={{ paddingTop: 96 }}>
          <span className="empty-icon">
            <Coins size={20} />
          </span>
          <h3>No measured quantities to price</h3>
          <p>Run the pipeline or add bill lines by hand; their quantities appear here for pricing.</p>
        </div>
      </div>
    );
  }

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key !== key ? { key, dir: key === "label" ? 1 : -1 } : s.dir === -1 ? { key, dir: 1 } : { key: "default", dir: 1 }));
  const th = (key: SortKey, label: ReactNode, opts: { width?: number; className?: string; title?: string } = {}) => (
    <th
      key={key}
      className={["num", opts.className ?? ""].join(" ").trim()}
      style={opts.width ? { width: opts.width } : undefined}
      title={opts.title}
      aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
    >
      <button type="button" className="th-sort" onClick={() => toggleSort(key)}>
        {label}
        {sort.key === key ? sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}
      </button>
    </th>
  );
  const floorLabel = floors.find((f) => f.key === scope)?.label ?? "";
  const grouped = sort.key === "default";
  const rateInput = (l: CompareRow) => (
    <input
      className="input input-sm input-num rate-input"
      inputMode="decimal"
      value={rates[l.id] ?? ""}
      placeholder="0.00"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        touch();
        const value = e.target.value.replace(/[^\d.]/g, "");
        setRates((r) => ({ ...r, [l.id]: value }));
      }}
      aria-label={`Rate for ${l.label}`}
    />
  );
  const amountCell = (value: number | null) => (value != null ? money(value, "", 2) : <span className="faint">None</span>);
  const columnCount = mode === "floors" ? floors.length + 3 : 4;
  const sortLabel =
    sort.key === "default"
      ? null
      : sort.key === "label"
        ? "item"
        : sort.key === "qty"
          ? "quantity"
          : sort.key === "rate"
            ? "rate"
            : sort.key === "amount"
              ? "amount"
              : (floors.find((f) => `floor:${f.key}` === sort.key)?.label ?? "floor").toLowerCase();
  const exportLabel = `${scopeLabel(scope, floors)}${sortLabel ? `, sorted by ${sortLabel}` : ", in bill order"}. Saved rates are used.`;

  return (
    <div className="rates-page">
      <div className="rates-main">
        <header className="bill-head">
          <div className="titles">
            <h1>Rates and estimate</h1>
            <span className="save-state">
              {saveState === "saving" ? (
                <>
                  <span className="spinner" style={{ width: 11, height: 11 }} /> Saving
                </>
              ) : saveState === "saved" ? (
                <>
                  <Check size={13} /> Saved
                </>
              ) : saveState === "error" ? (
                "Not saved"
              ) : source ? (
                `Rates from ${source}`
              ) : (
                "Changes save automatically"
              )}
            </span>
          </div>
          <div className="actions">
            {floors.length ? <ScopeSelect value={scope} floors={floors} onChange={setScope} /> : null}
            <select
              className="select input-sm"
              style={{ width: 96 }}
              value={currency}
              onChange={(e) => {
                touch();
                setCurrency(e.target.value);
              }}
              aria-label="Currency"
            >
              {[...new Set([currency, ...CURRENCIES])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setImportOpen(true)}>
              <FileUp size={14} /> Import rates
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!rated}
              onClick={async () => {
                const res = await confirm({ title: "Clear all rates?", message: `${rated} rates will be removed from this project.`, confirmLabel: "Clear", tone: "danger" });
                if (!res.ok) return;
                touch();
                setRates({});
                setSource("");
              }}
            >
              <Eraser size={14} /> Clear
            </button>
            <ExportMenu
              projectId={projectId}
              kinds={["rates"]}
              beforeExport={flush}
              view={{ scope, sort: sort.key === "default" ? undefined : sort.key, dir: sort.dir === 1 ? "asc" : "desc" }}
              viewLabel={exportLabel}
            />
          </div>
        </header>
        {mode === "floor" ? (
          <p className="scope-note">
            Pricing what was measured on the {floorLabel.toLowerCase()}: {lines.length} line{lines.length === 1 ? "" : "s"}. Rates are shared with the
            whole project.
          </p>
        ) : mode === "floors" && floors.some((f) => f.key === UNSPLIT) ? (
          <p className="scope-note">{UNSPLIT_HINT}</p>
        ) : null}

        <div className="rates-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <button type="button" className="th-sort" onClick={() => toggleSort("label")}>
                    Item
                    {sort.key === "label" ? sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}
                  </button>
                </th>
                {mode === "floors" ? (
                  <>
                    {th("rate", `Rate (${currency})`, { width: 140 })}
                    {floors.map((f) =>
                      th(`floor:${f.key}`, f.label, {
                        className: `floor-col${f.key === UNSPLIT ? " unsplit" : ""}`,
                        title: f.key === UNSPLIT ? UNSPLIT_HINT : undefined,
                      }),
                    )}
                    {th("amount", `Amount (${currency})`, { width: 150 })}
                  </>
                ) : (
                  <>
                    {th("qty", mode === "floor" ? floorLabel : "Quantity")}
                    {th("rate", `Rate (${currency})`, { width: 160 })}
                    {th("amount", `Amount (${currency})`, { width: 160 })}
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {(grouped ? sections : [["", lines] as [string, CompareRow[]]]).map(([section, items]) => (
                <Fragment key={section || "all"}>
                  {grouped ? (
                    <tr className="section-row">
                      {mode === "floors" ? (
                        <>
                          <td colSpan={2}>{section}</td>
                          {floors.map((f) => {
                            const sub = items.reduce((sum, l) => sum + (floorAmount(l, f.key) ?? 0), 0);
                            return (
                              <td key={f.key} className="num">
                                {sub ? money(sub, "", 0) : ""}
                              </td>
                            );
                          })}
                          <td className="num">{money(items.reduce((sum, l) => sum + (amountOf(l) ?? 0), 0), currency) || ""}</td>
                        </>
                      ) : (
                        <>
                          <td colSpan={3}>{section}</td>
                          <td className="num">
                            {(() => {
                              const sub = items.reduce((sum, l) => sum + (amountOf(l) ?? 0), 0);
                              return sub ? money(sub, currency) : "";
                            })()}
                          </td>
                        </>
                      )}
                    </tr>
                  ) : null}
                  {items.map((l) => (
                    <tr key={l.id} className={amountOf(l) != null ? "priced" : ""}>
                      <td className="truncate" style={{ maxWidth: 380 }}>
                        {l.label}
                        {!grouped ? <span className="faint small" style={{ marginLeft: 8 }}>{l.section}</span> : null}
                      </td>
                      {mode === "floors" ? (
                        <>
                          <td className="num">{rateInput(l)}</td>
                          {floors.map((f) => {
                            const q = floorQty(l, f.key);
                            const a = floorAmount(l, f.key);
                            return (
                              <td
                                key={f.key}
                                className={`num${f.key === UNSPLIT ? " unsplit" : ""}`}
                                title={q != null ? `${fmt(q, l.digits)} ${l.unit}` : undefined}
                              >
                                {a != null ? money(a, "", 2) : q != null ? <span className="faint">{fmt(q, l.digits)} {l.unit}</span> : ""}
                              </td>
                            );
                          })}
                          <td className="num">{amountCell(amountOf(l))}</td>
                        </>
                      ) : (
                        <>
                          <td className="num">
                            {fmt(qtyOf(l), l.digits)} <span className="unit muted">{l.unit}</span>
                          </td>
                          <td className="num">{rateInput(l)}</td>
                          <td className="num">{amountCell(amountOf(l))}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </Fragment>
              ))}
              {!lines.length ? (
                <tr>
                  <td colSpan={columnCount} className="muted" style={{ textAlign: "center", height: 80 }}>
                    Nothing measured on this floor.
                  </td>
                </tr>
              ) : null}
            </tbody>
            {mode === "floors" ? (
              <tfoot>
                <tr>
                  <td colSpan={2}>Direct works</td>
                  {byFloor.map((f) => (
                    <td key={f.key} className="num">
                      {f.amount ? money(f.amount, "", 0) : ""}
                    </td>
                  ))}
                  <td className="num">{money(direct, currency)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>

      <aside className="rates-summary">
        <section>
          <div className="summary-row">
            <span>Priced lines</span>
            <span className="tnum">
              {rated} of {allLines.length}
            </span>
          </div>
          <div className="progress" style={{ marginTop: 8 }}>
            <span style={{ width: `${(rated / allLines.length) * 100}%` }} />
          </div>
        </section>
        <section className="totals">
          {mode === "floor" ? <h3 className="section-title">{floorLabel}</h3> : null}
          <div className="summary-row">
            <span>Direct works</span>
            <span className="tnum">{money(direct, currency)}</span>
          </div>
          <div className="summary-row">
            <label htmlFor="markup">Overheads and profit</label>
            <div className="input-group" style={{ width: 92 }}>
              <input
                id="markup"
                className="input input-sm input-num"
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={markup}
                onChange={(e) => {
                  touch();
                  setMarkup(e.target.value);
                }}
                style={{ paddingRight: 24 }}
              />
              <span className="input-suffix">%</span>
            </div>
          </div>
          <div className="summary-row muted">
            <span />
            <span className="tnum">{money(markupAmount, currency)}</span>
          </div>
          <div className="summary-total">
            <span>{mode === "floor" ? "Floor estimate" : "Total estimate"}</span>
            <strong className="tnum">{money(direct + markupAmount, currency)}</strong>
          </div>
          {mode === "floor" ? (
            <div className="summary-row muted small" style={{ marginTop: 8 }}>
              <span>Whole project</span>
              <span className="tnum">{money(projectDirect * (1 + markupPct / 100), currency)}</span>
            </div>
          ) : null}
        </section>
        {floors.length > 1 && projectDirect > 0 ? (
          <section>
            <h3 className="section-title">Direct works by floor</h3>
            <ul className="drivers floor-costs">
              {byFloor.map((f) => {
                const share = projectDirect ? (f.amount / projectDirect) * 100 : 0;
                return (
                  <li key={f.key}>
                    <button
                      type="button"
                      className={`floor-cost${scope === f.key ? " active" : ""}`}
                      onClick={() => f.key !== UNSPLIT && setScope(scope === f.key ? "project" : f.key)}
                      disabled={f.key === UNSPLIT}
                      title={f.key === UNSPLIT ? UNSPLIT_HINT : `Show ${f.label.toLowerCase()} only`}
                    >
                      <div className="summary-row">
                        <span className="truncate">{f.label}</span>
                        <span className="tnum muted">{money(f.amount, "", 0)}</span>
                      </div>
                      <div className="driver-bar">
                        <span style={{ width: `${share}%` }} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        {drivers.length ? (
          <section>
            <h3 className="section-title">Largest costs</h3>
            <ul className="drivers">
              {drivers.map((l) => {
                const share = direct ? (amountOf(l)! / direct) * 100 : 0;
                return (
                  <li key={l.id}>
                    <div className="summary-row">
                      <span className="truncate">{l.label}</span>
                      <span className="tnum muted">{share.toFixed(0)}%</span>
                    </div>
                    <div className="driver-bar">
                      <span style={{ width: `${share}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <p className="muted small">Enter rates or import a rates sheet to see the estimate.</p>
        )}
      </aside>

      <RatesImportDialog
        open={importOpen}
        projectId={projectId}
        lines={allLines}
        currency={currency}
        onClose={() => setImportOpen(false)}
        onApply={(imported, file) => {
          touch();
          setRates((r) => ({ ...r, ...Object.fromEntries(Object.entries(imported).map(([k, v]) => [k, String(v)])) }));
          setSource(file);
          toast.success(`${Object.keys(imported).length} rates applied from ${file}`);
        }}
      />
    </div>
  );
}

