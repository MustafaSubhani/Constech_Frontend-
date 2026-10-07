import { useEffect, useMemo, useState } from "react";
import type { ExpressionSpec } from "../../types";
import { ELEMENT_TYPES } from "../../lib/kinds";
import { evaluate } from "../../lib/formula";
import { QUANTITY_FIELDS } from "../../lib/format";
import { Dialog } from "../ui/Dialog";
import { FormulaEditor } from "../formula/FormulaEditor";

const STARTERS: Record<string, ExpressionSpec> = {
  concrete_m3: { expression: "L * W * D / 1e9", variables: {} },
  formwork_m2: { expression: "2 * (L + W) * D / 1e6", variables: {} },
  rebar_kg: { expression: "kg", variables: {} },
  area_m2: { expression: "L * W / 1e6", variables: {} },
  blinding_m3: { expression: "L * W * t / 1e9", variables: {} },
};
const UNITS: Record<string, string> = { L: "mm", W: "mm", D: "mm", t: "mm", kg: "kg" };

type Props = {
  open: boolean;
  sheetCode: string;
  onClose: () => void;
  onSave: (body: { tag: string; elementType: string; reason: string; expressions: Record<string, ExpressionSpec> }) => Promise<void>;
};

export function AddElementDialog({ open, sheetCode, onClose, onSave }: Props) {
  const [elementType, setElementType] = useState("footing");
  const [tag, setTag] = useState("");
  const [reason, setReason] = useState("");
  const [fields, setFields] = useState<Record<string, ExpressionSpec>>({ concrete_m3: STARTERS.concrete_m3! });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setElementType("footing");
      setTag("");
      setReason("");
      setFields({ concrete_m3: STARTERS.concrete_m3! });
      setError("");
    }
  }, [open]);

  const results = useMemo(
    () => Object.fromEntries(Object.entries(fields).map(([k, s]) => [k, evaluate(s.expression, s.variables)])),
    [fields],
  );
  const valid = tag.trim() && Object.keys(fields).length > 0 && Object.values(results).every((r) => r.ok);

  async function save() {
    if (!valid) return;
    setBusy(true);
    setError("");
    try {
      await onSave({ tag: tag.trim(), elementType, reason: reason.trim(), expressions: fields });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the element.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title="Add an element"
      description={`Drawn on ${sheetCode}. Enter the dimensions from the drawing; the quantity is calculated from your formula.`}
      size="lg"
      footer={
        <>
          <span className="grow">{!tag.trim() ? "A tag is required" : ""}</span>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !valid}>
            {busy ? <span className="spinner" /> : null} Add to takeoff
          </button>
        </>
      }
    >
      {error ? <div className="banner banner-bad">{error}</div> : null}
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Element</span>
          <select className="select" value={elementType} onChange={(e) => setElementType(e.target.value)}>
            {ELEMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Tag</span>
          <input className="input" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="F12" data-autofocus />
        </label>
      </div>

      <div className="field">
        <span className="field-label">Quantities</span>
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {QUANTITY_FIELDS.map((f) => (
            <button
              key={f.key}
              type="button"
              className="chip chip-toggle"
              aria-pressed={f.key in fields}
              onClick={() =>
                setFields((prev) => {
                  const next = { ...prev };
                  if (f.key in next) delete next[f.key];
                  else next[f.key] = STARTERS[f.key]!;
                  return next;
                })
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {QUANTITY_FIELDS.filter((f) => f.key in fields).map((f) => (
        <FormulaEditor
          key={f.key}
          label={f.label}
          unit={f.unit}
          digits={f.digits}
          expression={fields[f.key]!.expression}
          variables={fields[f.key]!.variables}
          units={UNITS}
          onChange={(expression, variables) => setFields((prev) => ({ ...prev, [f.key]: { expression, variables } }))}
        />
      ))}

      <label className="field">
        <span className="field-label">Note</span>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why it was added, e.g. missed by the engine on grid C-4" />
      </label>
    </Dialog>
  );
}
