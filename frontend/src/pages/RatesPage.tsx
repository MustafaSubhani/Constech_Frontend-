import { FormEvent, useEffect, useMemo, useState } from "react";
import { useProjectContext } from "../context/ProjectContext";
import { api } from "../api/client";
import { fmt } from "../lib/format";
import { getAppSettings } from "../lib/settings";
import { ZapIcon, DownloadIcon, PrinterIcon, CheckIcon, CoinsIcon } from "../components/Icons";

type RateEntry = {
  key: string;
  label: string;
  unit: string;
  quantity: number | null;
  rate: string;
  elementType: string;
};

function buildRateKeys(project: {
  comparison: { id: string; label: string; unit: string; ours: number | null; section: string }[];
}) {
  return project.comparison
    .filter((row) => row.ours != null)
    .map((row) => ({
      key: row.id,
      label: row.label,
      unit: row.unit,
      quantity: row.ours,
      rate: "",
      elementType: row.section || "General",
    }));
}

export function RatesPage() {
  const { project } = useProjectContext();
  const globalSettings = useMemo(() => getAppSettings(), []);
  const initialRates = useMemo(() => buildRateKeys(project), [project]);
  const [rates, setRates] = useState<RateEntry[]>(initialRates);
  const [currency, setCurrency] = useState(globalSettings.currency || "AED");
  const [markupPct, setMarkupPct] = useState<number>(globalSettings.defaultMarkupPercent ?? 15);
  const [searchQuery, setSearchQuery] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await api.getRates(project.id);
        if (!active) return;
        if (res?.currency) setCurrency(res.currency);
        if (res?.rates) {
          setRates((prev) =>
            prev.map((r) => (res.rates![r.key] !== undefined ? { ...r, rate: res.rates![r.key] } : r)),
          );
          return;
        }
      } catch {
        // fallback to localStorage
      }
      try {
        const local = localStorage.getItem(`constech_rates_${project.id}`);
        if (local) {
          const parsed = JSON.parse(local) as Record<string, string>;
          setRates((prev) =>
            prev.map((r) => (parsed[r.key] !== undefined ? { ...r, rate: parsed[r.key] } : r)),
          );
        }
        const curr = localStorage.getItem(`constech_currency_${project.id}`);
        if (curr) setCurrency(curr);
        const mk = localStorage.getItem(`constech_markup_${project.id}`);
        if (mk) setMarkupPct(Number(mk));
      } catch {
        // ignore
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [project.id]);

  const directTotalCost = useMemo(() => {
    return rates.reduce((sum, r) => {
      const qty = r.quantity ?? 0;
      const rate = parseFloat(r.rate) || 0;
      return sum + qty * rate;
    }, 0);
  }, [rates]);

  const markupAmount = useMemo(() => {
    return directTotalCost * (markupPct / 100);
  }, [directTotalCost, markupPct]);

  const grandTotalCost = useMemo(() => {
    return directTotalCost + markupAmount;
  }, [directTotalCost, markupAmount]);

  const itemsWithRates = rates.filter((r) => parseFloat(r.rate) > 0);

  function updateRate(key: string, value: string) {
    setRates((prev) => prev.map((r) => (r.key === key ? { ...r, rate: value } : r)));
  }

  function applyTypicalRates() {
    setRates((prev) =>
      prev.map((r) => {
        let defaultRate = "";
        const k = r.key.toLowerCase();
        const u = r.unit.toLowerCase();
        if (k.includes("blinding")) {
          defaultRate = "210";
        } else if (u.includes("m³") || u.includes("m3") || k.includes("m3") || k.includes("concrete")) {
          defaultRate = "270";
        } else if (u.includes("m²") || u.includes("m2") || k.includes("m2") || k.includes("formwork")) {
          defaultRate = "48";
        } else if (u.includes("kg") || k.includes("kg") || k.includes("rebar") || k.includes("steel")) {
          defaultRate = "3.85";
        } else if (u.includes("t") || k.includes("tonne")) {
          defaultRate = "3850";
        } else {
          defaultRate = "150";
        }
        return { ...r, rate: defaultRate };
      }),
    );
  }

  function clearAllRates() {
    if (window.confirm("Clear all entered unit rates?")) {
      setRates((prev) => prev.map((r) => ({ ...r, rate: "" })));
    }
  }

  function exportCsv() {
    const lines = ["Item,Section,Quantity,Unit,Rate,Direct Amount,Currency"];
    for (const r of rates) {
      const q = r.quantity ?? 0;
      const rate = parseFloat(r.rate) || 0;
      const amt = q * rate;
      lines.push(
        `"${r.label.replace(/"/g, '""')}","${r.elementType}",${q},"${r.unit}",${rate},${amt},${currency}`,
      );
    }
    lines.push(`"DIRECT WORKS SUBTOTAL",,,,,${directTotalCost},${currency}`);
    lines.push(`"CONTRACTOR MARKUP (${markupPct}%)",,,,,${markupAmount},${currency}`);
    lines.push(`"GRAND TOTAL ESTIMATE",,,,,${grandTotalCost},${currency}`);

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.toLowerCase().replace(/\s+/g, "-")}-estimation-bill.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    const rateMap: Record<string, string> = {};
    for (const r of rates) {
      if (r.rate) rateMap[r.key] = r.rate;
    }
    try {
      localStorage.setItem(`constech_rates_${project.id}`, JSON.stringify(rateMap));
      localStorage.setItem(`constech_currency_${project.id}`, currency);
      localStorage.setItem(`constech_markup_${project.id}`, String(markupPct));
    } catch {
      // ignore
    }
    try {
      await api.saveRates(project.id, { currency, rates: rateMap });
    } catch {
      // ignore
    }
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 2000);
  }

  const hasQuantities = rates.length > 0;

  // Filter by query and group by section
  const grouped = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const map: Record<string, { items: RateEntry[]; subtotal: number }> = {};
    for (const r of rates) {
      if (q && !r.label.toLowerCase().includes(q) && !r.elementType.toLowerCase().includes(q)) {
        continue;
      }
      const sec = r.elementType || "General";
      if (!map[sec]) map[sec] = { items: [], subtotal: 0 };
      map[sec].items.push(r);
      const qty = r.quantity ?? 0;
      const rate = parseFloat(r.rate) || 0;
      map[sec].subtotal += qty * rate;
    }
    return map;
  }, [rates, searchQuery]);

  return (
    <main className="shell-main tab-in">
      <section className="rates-workbench">
        {/* Unified Top Control Bar */}
        <div className="workbench-bar">
          <div className="workbench-bar-top">
            <div className="workbench-title-group">
              <h2>Rates &amp; Commercial Estimation</h2>
              <span className="workbench-subtext">
                {project.name} · {rates.length} detected items
              </span>
            </div>

            <div className="workbench-actions">
              <input
                type="search"
                className="search search-workbench"
                placeholder="Search items or sections…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <select
                className="currency-select"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="AED">AED</option>
                <option value="USD">USD</option>
                <option value="SAR">SAR</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="PKR">PKR</option>
              </select>

              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={applyTypicalRates}
                title="Auto-fill typical UAE market rates"
              >
                <ZapIcon size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
                Auto-fill
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={clearAllRates}
                title="Clear all entered rates"
              >
                Clear
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={exportCsv}
                title="Export estimation bill as CSV"
              >
                <DownloadIcon size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
                CSV
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => window.print()}
                title="Print bill or save as PDF"
              >
                <PrinterIcon size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
                Print
              </button>
            </div>
          </div>
        </div>

        {!hasQuantities ? (
          <div className="empty">
            <h2>No quantities detected yet</h2>
            <p>
              Run <strong>Discover</strong>, then <strong>Foundations</strong> and{" "}
              <strong>Structure</strong> from the pipeline above to detect quantities from your drawings.
            </p>
          </div>
        ) : (
          <div className="rates-layout">
            {/* Left: Sectional Rate Tables */}
            <form className="rates-form" onSubmit={handleSave}>
              {Object.entries(grouped).map(([section, data]) => (
                <div key={section} className="rates-section">
                  <div className="rates-section-header">
                    <span className="rates-section-title">{section}</span>
                    <span className="rates-section-line" />
                    <span className="rates-section-count">
                      {data.items.length} item{data.items.length !== 1 ? "s" : ""}
                    </span>
                    {data.subtotal > 0 && (
                      <span className="section-subtotal-badge">
                        Subtotal: {currency} {data.subtotal.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </span>
                    )}
                  </div>

                  <table className="rates-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th className="num">Quantity</th>
                        <th className="num">Rate ({currency})</th>
                        <th className="num">Amount ({currency})</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((row) => {
                        const qty = row.quantity ?? 0;
                        const rate = parseFloat(row.rate) || 0;
                        const amount = qty * rate;
                        return (
                          <tr key={row.key} className={rate > 0 ? "has-rate" : ""}>
                            <td className="rate-label">{row.label}</td>
                            <td className="num">
                              <span className="qty-with-unit">
                                <span className="qty-val">{fmt(row.quantity, 3)}</span>
                                <span className="qty-unit">{row.unit}</span>
                              </span>
                            </td>
                            <td className="num">
                              <input
                                className="rate-input"
                                type="number"
                                step="any"
                                min="0"
                                placeholder="0.00"
                                value={row.rate}
                                onChange={(e) => updateRate(row.key, e.target.value)}
                              />
                            </td>
                            <td className="num amount-cell">
                              {rate > 0 ? (
                                <span className="amount">
                                  {currency}{" "}
                                  {amount.toLocaleString("en-US", {
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: 0,
                                  })}
                                </span>
                              ) : (
                                <span className="muted">0</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </form>

            {/* Right: Commercial Summary & Markup Sidebar */}
            <aside className="rates-summary">
              <div className="rates-summary-head">
                <h3>Commercial Summary</h3>
              </div>

              {/* Progress */}
              <div className="summary-completion">
                <div className="summary-completion-label">
                  <span>Rated items</span>
                  <span>{itemsWithRates.length} / {rates.length}</span>
                </div>
                <div className="summary-completion-bar">
                  <div
                    className="summary-completion-fill"
                    style={{
                      width:
                        rates.length > 0
                          ? `${Math.round((itemsWithRates.length / rates.length) * 100)}%`
                          : "0%",
                    }}
                  />
                </div>
              </div>

              {/* Direct Works Subtotal */}
              <div className="summary-stat-box">
                <span className="summary-stat-label">Direct Works Subtotal</span>
                <span className="summary-stat-val">
                  {currency} {directTotalCost.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </span>
              </div>

              {/* Integrated Contractor Markup Slider */}
              <div className="summary-markup-box">
                <div className="markup-header-row">
                  <span className="markup-label">Overheads &amp; Profit</span>
                  <span className="markup-pct-badge">+{markupPct}%</span>
                </div>
                <div className="markup-slider-row">
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>0%</span>
                  <input
                    type="range"
                    min="0"
                    max="35"
                    step="1"
                    value={markupPct}
                    onChange={(e) => setMarkupPct(Number(e.target.value))}
                    className="markup-slider"
                  />
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>35%</span>
                </div>
                <div className="markup-amount-sub">
                  <span>Markup amount:</span>
                  <strong>
                    {currency} {markupAmount.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </strong>
                </div>
              </div>

              {/* Grand Tender Total Box */}
              <div className="summary-tender-total">
                <span className="tender-total-label">Total Tender Estimate</span>
                <span className="tender-total-val">
                  {currency} {grandTotalCost.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </span>
              </div>

              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSave}
                disabled={submitted}
                style={{ width: "100%", justifyContent: "center", marginTop: 14 }}
              >
                {submitted ? (
                  <>
                    <CheckIcon size={14} style={{ marginRight: 6 }} /> Saved
                  </>
                ) : (
                  "Save rates"
                )}
              </button>

              {/* Breakdown by item */}
              {itemsWithRates.length > 0 && (
                <div className="summary-breakdown-section">
                  <div className="breakdown-title">Top Cost Drivers</div>
                  <ul className="rates-breakdown">
                    {itemsWithRates
                      .slice()
                      .sort((a, b) => {
                        const aCost = (a.quantity ?? 0) * (parseFloat(a.rate) || 0);
                        const bCost = (b.quantity ?? 0) * (parseFloat(b.rate) || 0);
                        return bCost - aCost;
                      })
                      .slice(0, 8)
                      .map((r) => {
                        const qty = r.quantity ?? 0;
                        const amount = qty * (parseFloat(r.rate) || 0);
                        const pct = directTotalCost > 0 ? (amount / directTotalCost) * 100 : 0;
                        return (
                          <li key={r.key} className="breakdown-row">
                            <div className="breakdown-label">{r.label}</div>
                            <div className="breakdown-bar-wrap">
                              <div className="breakdown-bar" style={{ width: `${Math.max(2, pct)}%` }} />
                            </div>
                            <div className="breakdown-amount">
                              {currency}{" "}
                              {amount.toLocaleString("en-US", {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 0,
                              })}
                              <span className="muted"> ({pct.toFixed(0)}%)</span>
                            </div>
                          </li>
                        );
                      })}
                  </ul>
                </div>
              )}
            </aside>
          </div>
        )}
      </section>
    </main>
  );
}
