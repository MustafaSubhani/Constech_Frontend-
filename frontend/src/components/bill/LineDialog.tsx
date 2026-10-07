import { useEffect, useMemo, useState } from "react";
import type { CompareRow, FloorInfo } from "../../types";
import { evaluate } from "../../lib/formula";
import { Dialog } from "../ui/Dialog";
import { FormulaEditor } from "../formula/FormulaEditor";

type Body = { label: string; section: string; unit: string; floor: string; bill: number | null; expression: string; variables: Record<string, number> };

type Props = {
  open: boolean;
  sections: string[];
  /** Storeys found in the project; a hand-added line can belong to one of them. */
  floors?: FloorInfo[];
  line?: CompareRow | null;
  onClose: () => void;
  onSave: (body: Body) => Promise<void>;
};

const UNITS = ["m³", "m²", "m", "kg", "t", "no."];

/** Add a bill line by hand, or edit one that was added by hand. */
export function LineDialog({ open, sections, floors = [], line, onClose, onSave }: Props) {
  const [label, setLabel] = useState("");
  const [section, setSection] = useState("Custom");
  const [unit, setUnit] = useState("m³");
  const [floor, setFloor] = useState("");
  const [bill, setBill] = useState("");
  const [expression, setExpression] = useState("qty");
  const [variables, setVariables] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLabel(line?.label ?? "");
    setSection(line?.section ?? "Custom");
    setUnit(line?.unit ?? "m³");
    setFloor(line?.floor ?? "");
    setBill(line?.bill != null ? String(line.bill) : "");
    setExpression(line?.expression || (line?.ours != null ? "qty" : "qty"));
    setVariables(line?.variables && Object.keys(line.variables).length ? line.variables : line?.ours != null ? { qty: line.ours } : {});
    setError("");
  }, [open, line]);

  const result = useMemo(() => evaluate(expression, variables), [expression, variables]);
  const sectionOptions = useMemo(() => [...new Set([...sections, "Custom"])], [sections]);

  async function save() {
    if (!label.trim() || !result.ok) return;
    setBusy(true);
    setError("");
    try {
      await onSave({ label: label.trim(), section, unit, floor, bill: bill.trim() === "" ? null : Number(bill), expression, variables });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title={line ? "Edit line" : "Add a bill line"}
      description="Lines added by hand are kept with the project and included in rates and exports."
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !label.trim() || !result.ok}>
            {busy ? <span className="spinner" /> : null} {line ? "Save line" : "Add line"}
          </button>
        </>
      }
    >
      {error ? <div className="banner banner-bad">{error}</div> : null}
      <label className="field">
        <span className="field-label">Description</span>
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Waterproofing to raft" data-autofocus />
      </label>
      <div className="form-grid three">
        <label className="field">
          <span className="field-label">Section</span>
          <select className="select" value={section} onChange={(e) => setSection(e.target.value)}>
            {sectionOptions.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Unit</span>
          <select className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {[...new Set([unit, ...UNITS])].map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Bill quantity</span>
          <input className="input input-num" inputMode="decimal" value={bill} onChange={(e) => setBill(e.target.value)} placeholder="Optional" />
        </label>
      </div>
      {floors.some((f) => f.key !== "unsplit") ? (
        <label className="field">
          <span className="field-label">Floor</span>
          <select className="select" value={floor} onChange={(e) => setFloor(e.target.value)}>
            <option value="">Whole project, not split by floor</option>
            {floors
              .filter((f) => f.key !== "unsplit")
              .map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      <FormulaEditor
        label="Measured"
        unit={unit}
        expression={expression}
        variables={variables}
        onChange={(e, v) => {
          setExpression(e);
          setVariables(v);
        }}
      />
    </Dialog>
  );
}
