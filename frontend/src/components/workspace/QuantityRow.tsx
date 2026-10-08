import { useState } from "react";
import { Pencil, RotateCcw } from "lucide-react";
import type { ExpressionSpec } from "../../types";
import { deriveExpression, evaluate } from "../../lib/formula";
import { fmt } from "../../lib/format";
import { FormulaEditor, MathView } from "../formula/FormulaEditor";

type Props = {
  field: { key: string; label: string; unit: string; digits: number };
  value: number | null;
  engineValue: number | null;
  stored?: ExpressionSpec;
  inputs: Record<string, unknown>;
  onSave: (spec: ExpressionSpec, reason: string) => Promise<void>;
  canEdit?: boolean;
};

export function QuantityRow({ field, value, engineValue, stored, inputs, onSave, canEdit = true }: Props) {
  const [editing, setEditing] = useState(false);
  const [spec, setSpec] = useState<ExpressionSpec>(() => stored ?? deriveExpression(field.key, engineValue ?? value, inputs));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const changed = engineValue != null && value != null && Math.abs(value - engineValue) > 10 ** -(field.digits + 1);
  const shown = stored ?? deriveExpression(field.key, engineValue ?? value, inputs);
  const result = evaluate(spec.expression, spec.variables);

  async function save() {
    if (!result.ok) return;
    setBusy(true);
    try {
      await onSave(spec, reason.trim());
      setEditing(false);
      setReason("");
    } catch {
      /* the caller already showed the error; keep the editor open */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`qty${editing ? " editing" : ""}`}>
      <div className="qty-head">
        <span className="qty-label">{field.label}</span>
        <span className="qty-value tnum">
          {fmt(value, field.digits)} <span className="unit">{field.unit}</span>
        </span>
        {canEdit && !editing ? (
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            aria-label={`Edit ${field.label}`}
            onClick={() => {
              setSpec(stored ?? deriveExpression(field.key, engineValue ?? value, inputs));
              setEditing(true);
            }}
          >
            <Pencil size={13} />
          </button>
        ) : null}
      </div>
      {!editing ? (
        <div className="qty-formula">
          {shown.expression !== "engine" ? <MathView expression={shown.expression} /> : <span className="muted small">Engine value, no formula recorded</span>}
          {changed ? (
            <span className="qty-engine small">
              <RotateCcw size={11} /> engine {fmt(engineValue, field.digits)}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="qty-edit">
          <FormulaEditor
            label={field.label}
            unit={field.unit}
            digits={field.digits}
            expression={spec.expression}
            variables={spec.variables}
            engineValue={engineValue}
            onChange={(expression, variables) => setSpec({ expression, variables })}
          />
          <input className="input input-sm" placeholder="Reason for the change (kept in the audit trail)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy || !result.ok}>
              {busy ? <span className="spinner" /> : null} Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
