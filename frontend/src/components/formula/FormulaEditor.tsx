import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { evaluate, VARIABLE_LABELS, type Node } from "../../lib/formula";
import { fmt, signed } from "../../lib/format";

const UNIT_SUB: Record<string, string> = { m2: "m²", m3: "m³", mm: "mm", m: "m", kg: "kg" };

function VarName({ name }: { name: string }) {
  const meta = VARIABLE_LABELS[name];
  const parts = name.split("_");
  const unit = parts.length > 1 ? UNIT_SUB[parts[parts.length - 1]!] : undefined;
  const base = unit ? parts.slice(0, -1).join(" ") : parts.join(" ");
  return (
    <span className="mv-var" title={meta ? `${meta.label}${meta.unit ? ` (${meta.unit})` : ""}` : name}>
      {base}
      {unit ? <sub>{unit}</sub> : null}
    </span>
  );
}

function Num({ raw, value }: { raw: string; value: number }) {
  const sci = /^1e\+?(\d+)$/i.exec(raw);
  if (sci) {
    return (
      <span className="mv-num">
        10<sup>{sci[1]}</sup>
      </span>
    );
  }
  return <span className="mv-num">{Number.isInteger(value) ? value.toLocaleString("en-US") : raw}</span>;
}

function render(node: Node): ReactNode {
  switch (node.type) {
    case "num":
      return <Num raw={node.raw} value={node.value} />;
    case "var":
      return <VarName name={node.name} />;
    case "neg":
      return (
        <>
          <span className="mv-op">−</span>
          {render(node.arg)}
        </>
      );
    case "group":
      return (
        <span className="mv-group">
          <span className="mv-paren">(</span>
          {render(node.inner)}
          <span className="mv-paren">)</span>
        </span>
      );
    case "call":
      return (
        <span className="mv-call">
          <span className="mv-fn">{node.name}</span>
          <span className="mv-paren">(</span>
          {node.args.map((a, i) => (
            <Fragment key={i}>
              {i > 0 ? <span className="mv-comma">, </span> : null}
              {render(a)}
            </Fragment>
          ))}
          <span className="mv-paren">)</span>
        </span>
      );
    case "bin":
      if (node.op === "/") {
        return (
          <span className="mv-frac">
            <span className="mv-frac-top">{render(node.left)}</span>
            <span className="mv-frac-bot">{render(node.right)}</span>
          </span>
        );
      }
      if (node.op === "^") {
        return (
          <span className="mv-pow">
            {render(node.left)}
            <sup>{render(node.right)}</sup>
          </span>
        );
      }
      return (
        <>
          {render(node.left)}
          <span className="mv-op">{node.op === "*" ? "×" : node.op === "-" ? "−" : "+"}</span>
          {render(node.right)}
        </>
      );
  }
}

export function MathView({ expression, className = "" }: { expression: string; className?: string }) {
  const result = useMemo(() => evaluate(expression, {}), [expression]);
  if (!result.tree) return <code className={`mv-raw ${className}`}>{expression}</code>;
  return <span className={`mv ${className}`}>{render(result.tree)}</span>;
}

type Props = {
  label: string;
  unit: string;
  digits?: number;
  expression: string;
  variables: Record<string, number>;
  onChange: (expression: string, variables: Record<string, number>) => void;
  engineValue?: number | null;
  units?: Record<string, string>;
};

export function FormulaEditor({ label, unit, digits = 3, expression, variables, onChange, engineValue, units = {} }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newVar, setNewVar] = useState("");
  const result = useMemo(() => evaluate(expression, variables), [expression, variables]);
  const used = result.variables;
  const names = useMemo(() => {
    const all = [...used];
    Object.keys(variables).forEach((k) => !all.includes(k) && all.push(k));
    return all;
  }, [used, variables]);

  const setValue = (name: string, raw: string) => {
    setDrafts((d) => ({ ...d, [name]: raw }));
    const n = Number(raw);
    const next = { ...variables };
    if (raw.trim() === "" || !Number.isFinite(n)) delete next[name];
    else next[name] = n;
    onChange(expression, next);
  };

  const removeVar = (name: string) => {
    const next = { ...variables };
    delete next[name];
    onChange(expression, next);
  };

  const addVar = () => {
    const name = newVar.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name in variables) return;
    onChange(expression, { ...variables, [name]: 0 });
    setDrafts((d) => ({ ...d, [name]: "0" }));
    setNewVar("");
  };

  const delta = result.ok && engineValue != null ? result.value - engineValue : null;

  return (
    <div className="fx">
      <div className="fx-display" aria-label="Formula">
        <span className="fx-lhs">{label}</span>
        <span className="mv-op">=</span>
        {result.tree ? <span className="mv">{render(result.tree)}</span> : <code className="mv-raw">{expression || "?"}</code>}
      </div>

      <label className="fx-input">
        <span className="sr-only">Formula</span>
        <input
          className={`input input-sm mono${!result.tree && expression ? " invalid" : ""}`}
          value={expression}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value, variables)}
          placeholder="e.g. L * W * D / 1e9"
        />
      </label>

      <table className="fx-vars">
        <tbody>
          {names.map((name) => {
            const meta = VARIABLE_LABELS[name];
            const unused = !used.includes(name);
            const value = drafts[name] ?? (variables[name] !== undefined ? String(variables[name]) : "");
            return (
              <tr key={name} className={unused ? "unused" : variables[name] === undefined ? "missing" : ""}>
                <td>
                  <VarName name={name} />
                  {meta ? <span className="fx-var-label">{meta.label}</span> : null}
                </td>
                <td className="fx-val">
                  <input
                    className="input input-sm input-num"
                    inputMode="decimal"
                    value={value}
                    placeholder="value"
                    onChange={(e) => setValue(name, e.target.value)}
                    aria-label={`Value of ${name}`}
                  />
                </td>
                <td className="fx-unit">{units[name] ?? meta?.unit ?? ""}</td>
                <td className="fx-del">
                  {unused ? (
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => removeVar(name)} aria-label={`Remove ${name}`}>
                      <X size={13} />
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
          <tr className="fx-add">
            <td colSpan={4}>
              <div className="row">
                <input
                  className="input input-sm mono"
                  placeholder="new variable"
                  value={newVar}
                  onChange={(e) => setNewVar(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addVar())}
                  aria-label="New variable name"
                />
                <button type="button" className="btn btn-ghost btn-sm" onClick={addVar} disabled={!newVar.trim()}>
                  <Plus size={13} /> Add
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div className={`fx-result${result.ok ? "" : " error"}`}>
        {result.ok ? (
          <>
            <span className="fx-value tnum">
              {fmt(result.value, digits)} <span className="unit">{unit}</span>
            </span>
            {engineValue != null ? (
              <span className="fx-engine">
                engine {fmt(engineValue, digits)}
                {delta != null && Math.abs(delta) > 10 ** -digits ? <strong> · {signed(delta, digits)}</strong> : null}
              </span>
            ) : null}
          </>
        ) : (
          <span>{result.error}</span>
        )}
      </div>
    </div>
  );
}
