import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import type { CompareRow, RatesImport } from "../../types";
import { toUploads } from "../../lib/files";
import { fmt } from "../../lib/format";
import { Dialog } from "../ui/Dialog";
import { Dropzone } from "../ui/Dropzone";

type Props = {
  open: boolean;
  projectId: string;
  lines: CompareRow[];
  currency: string;
  onClose: () => void;
  onApply: (rates: Record<string, number>, source: string) => void;
};

type Choice = { include: boolean; rowIndex: number | null };

export function RatesImportDialog({ open, projectId, lines, currency, onClose, onApply }: Props) {
  const [data, setData] = useState<RatesImport | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setData(null);
      setChoices({});
      setError("");
    }
  }, [open]);

  async function upload(files: File[]) {
    setBusy(true);
    setError("");
    try {
      const [file] = await toUploads(files);
      const result = await api.importRates(projectId, file!);
      setData(result);
      const next: Record<string, Choice> = {};
      result.suggestions.forEach((s) => (next[s.key] = { include: s.rowIndex != null && s.score >= 0.5, rowIndex: s.rowIndex }));
      setChoices(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const byKey = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);
  const included = Object.entries(choices).filter(([, c]) => c.include && c.rowIndex != null);

  function apply() {
    if (!data) return;
    const rates: Record<string, number> = {};
    included.forEach(([key, c]) => (rates[key] = data.rows[c.rowIndex!]!.rate));
    onApply(rates, data.file.split("/").pop() ?? data.file);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title="Import rates"
      description="Rates are matched to bill lines by description and unit. Check each match before applying; nothing changes until you do."
      size="xl"
      footer={
        data ? (
          <>
            <span className="grow">
              {included.length} of {lines.length} lines will get a rate · {data.unmatched.length} sheet rows unused
            </span>
            <button type="button" className="btn btn-secondary" onClick={() => setData(null)}>
              Choose another file
            </button>
            <button type="button" className="btn btn-primary" onClick={apply} disabled={!included.length}>
              Apply {included.length} rates
            </button>
          </>
        ) : undefined
      }
    >
      {error ? <div className="banner banner-bad">{error}</div> : null}
      {!data ? (
        <>
          <Dropzone
            accept=".xlsx,.csv"
            multiple={false}
            title={busy ? "Reading the sheet" : "Drop a rates sheet"}
            hint="XLSX or CSV with Description, Unit and Rate columns. An Item column with line keys matches exactly."
            onFiles={upload}
            onReject={() => setError("Use an .xlsx or .csv file.")}
          />
          {busy ? <div className="progress indeterminate"><span /></div> : null}
        </>
      ) : (
        <div className="import-table-wrap">
          <table className="data-table import-table">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Bill line</th>
                <th>Matched rate row</th>
                <th className="num">Rate ({currency})</th>
                <th className="num">Match</th>
              </tr>
            </thead>
            <tbody>
              {data.suggestions.map((s) => {
                const line = byKey.get(s.key);
                const choice = choices[s.key] ?? { include: false, rowIndex: null };
                const row = choice.rowIndex != null ? data.rows[choice.rowIndex] : null;
                const exact = s.score >= 1;
                return (
                  <tr key={s.key} className={choice.include ? "" : "dim"}>
                    <td>
                      <input
                        type="checkbox"
                        className="check-box"
                        checked={choice.include}
                        disabled={choice.rowIndex == null}
                        onChange={(e) => setChoices((c) => ({ ...c, [s.key]: { ...choice, include: e.target.checked } }))}
                        aria-label={`Apply rate to ${line?.label}`}
                      />
                    </td>
                    <td>
                      <div className="truncate" style={{ maxWidth: 260 }}>{line?.label ?? s.key}</div>
                      <div className="muted small">
                        {fmt(line?.ours, line?.digits ?? 2)} {line?.unit}
                      </div>
                    </td>
                    <td>
                      <select
                        className="select input-sm"
                        value={choice.rowIndex ?? ""}
                        onChange={(e) =>
                          setChoices((c) => ({
                            ...c,
                            [s.key]: { include: e.target.value !== "", rowIndex: e.target.value === "" ? null : Number(e.target.value) },
                          }))
                        }
                      >
                        <option value="">No rate</option>
                        {data.rows.map((r, i) => (
                          <option key={i} value={i}>
                            {(r.description || r.key).slice(0, 70)} {r.unit ? `(${r.unit})` : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num">{row ? fmt(row.rate, 2) : ""}</td>
                    <td className="num">
                      {choice.rowIndex === s.rowIndex && s.rowIndex != null ? (
                        <span className={`chip ${exact || s.score >= 0.6 ? "chip-ok" : s.score >= 0.35 ? "chip-warn" : "chip-bad"}`}>
                          {exact ? "Exact" : `${Math.round(s.score * 100)}%`}
                        </span>
                      ) : row ? (
                        <span className="chip chip-info">Chosen</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}
