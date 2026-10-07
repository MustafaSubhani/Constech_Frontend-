/** Arithmetic formulas with named variables. Same grammar as backend/structural_boq/formula.py. */

export type Node =
  | { type: "num"; value: number; raw: string }
  | { type: "var"; name: string }
  | { type: "neg"; arg: Node }
  | { type: "bin"; op: "+" | "-" | "*" | "/" | "^"; left: Node; right: Node }
  | { type: "call"; name: string; args: Node[] }
  | { type: "group"; inner: Node };

const FUNCS: Record<string, (...a: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  round: (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d,
  sqrt: Math.sqrt,
  ceil: Math.ceil,
  floor: Math.floor,
};

export class FormulaError extends Error {
  position: number;
  constructor(message: string, position = -1) {
    super(message);
    this.position = position;
  }
}

type Token = { kind: "num" | "id" | "op" | "lp" | "rp" | "comma"; text: string; pos: number };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) {
      out.push({ kind: "num", text: num[0], pos: i });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) {
      out.push({ kind: "id", text: id[0], pos: i });
      i += id[0].length;
      continue;
    }
    if (src.startsWith("**", i)) {
      out.push({ kind: "op", text: "^", pos: i });
      i += 2;
      continue;
    }
    const map: Record<string, string> = { "×": "*", "÷": "/", "−": "-" };
    const op = map[ch] ?? ch;
    if ("+-*/^".includes(op)) out.push({ kind: "op", text: op, pos: i });
    else if (ch === "(") out.push({ kind: "lp", text: ch, pos: i });
    else if (ch === ")") out.push({ kind: "rp", text: ch, pos: i });
    else if (ch === ",") out.push({ kind: "comma", text: ch, pos: i });
    else throw new FormulaError(`Unexpected '${ch}'`, i);
    i += 1;
  }
  return out;
}

export function parse(src: string): Node {
  const text = src.trim().replace(/^=/, "");
  if (!text) throw new FormulaError("Formula is empty", 0);
  const tokens = tokenize(text);
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];

  function primary(): Node {
    const t = take();
    if (!t) throw new FormulaError("Formula ends too early", text.length);
    if (t.kind === "num") return { type: "num", value: Number(t.text), raw: t.text };
    if (t.kind === "id") {
      if (peek()?.kind === "lp") {
        take();
        const args: Node[] = [];
        if (peek()?.kind !== "rp") {
          args.push(expr());
          while (peek()?.kind === "comma") {
            take();
            args.push(expr());
          }
        }
        if (take()?.kind !== "rp") throw new FormulaError("Missing ')'", t.pos);
        if (!FUNCS[t.text]) throw new FormulaError(`Unknown function '${t.text}'`, t.pos);
        return { type: "call", name: t.text, args };
      }
      return { type: "var", name: t.text };
    }
    if (t.kind === "lp") {
      const inner = expr();
      if (take()?.kind !== "rp") throw new FormulaError("Missing ')'", t.pos);
      return { type: "group", inner };
    }
    if (t.kind === "op" && (t.text === "-" || t.text === "+")) {
      const arg = power();
      return t.text === "-" ? { type: "neg", arg } : arg;
    }
    throw new FormulaError(`Unexpected '${t.text}'`, t.pos);
  }
  function power(): Node {
    const base = primary();
    if (peek()?.kind === "op" && peek()!.text === "^") {
      take();
      return { type: "bin", op: "^", left: base, right: unary() };
    }
    return base;
  }
  function unary(): Node {
    const t = peek();
    if (t?.kind === "op" && (t.text === "-" || t.text === "+")) {
      take();
      const arg = unary();
      return t.text === "-" ? { type: "neg", arg } : arg;
    }
    return power();
  }
  function term(): Node {
    let left = unary();
    while (peek()?.kind === "op" && (peek()!.text === "*" || peek()!.text === "/")) {
      const op = take()!.text as "*" | "/";
      left = { type: "bin", op, left, right: unary() };
    }
    return left;
  }
  function expr(): Node {
    let left = term();
    while (peek()?.kind === "op" && (peek()!.text === "+" || peek()!.text === "-")) {
      const op = take()!.text as "+" | "-";
      left = { type: "bin", op, left, right: term() };
    }
    return left;
  }
  const tree = expr();
  if (i < tokens.length) throw new FormulaError(`Unexpected '${tokens[i]!.text}'`, tokens[i]!.pos);
  return tree;
}

export function evaluateNode(node: Node, vars: Record<string, number | undefined>): number {
  switch (node.type) {
    case "num":
      return node.value;
    case "var": {
      if (node.name === "pi") return Math.PI;
      const v = vars[node.name];
      if (v === undefined || Number.isNaN(v)) throw new FormulaError(`Set a value for '${node.name}'`);
      return v;
    }
    case "neg":
      return -evaluateNode(node.arg, vars);
    case "group":
      return evaluateNode(node.inner, vars);
    case "call":
      return FUNCS[node.name]!(...node.args.map((a) => evaluateNode(a, vars)));
    case "bin": {
      const l = evaluateNode(node.left, vars);
      const r = evaluateNode(node.right, vars);
      if (node.op === "+") return l + r;
      if (node.op === "-") return l - r;
      if (node.op === "*") return l * r;
      if (node.op === "^") return l ** r;
      if (r === 0) throw new FormulaError("Division by zero");
      return l / r;
    }
  }
}

export function variablesOf(node: Node, into = new Set<string>()): Set<string> {
  if (node.type === "var" && node.name !== "pi") into.add(node.name);
  if (node.type === "neg") variablesOf(node.arg, into);
  if (node.type === "group") variablesOf(node.inner, into);
  if (node.type === "bin") {
    variablesOf(node.left, into);
    variablesOf(node.right, into);
  }
  if (node.type === "call") node.args.forEach((a) => variablesOf(a, into));
  return into;
}

export type Evaluation =
  | { ok: true; value: number; tree: Node; variables: string[] }
  | { ok: false; error: string; position: number; tree?: Node; variables: string[] };

export function evaluate(expression: string, vars: Record<string, number | undefined>): Evaluation {
  let tree: Node;
  try {
    tree = parse(expression);
  } catch (err) {
    const e = err as FormulaError;
    return { ok: false, error: e.message, position: e.position ?? -1, variables: [] };
  }
  const variables = [...variablesOf(tree)];
  try {
    const value = evaluateNode(tree, vars);
    if (!Number.isFinite(value)) return { ok: false, error: "Result is not a finite number", position: -1, tree, variables };
    return { ok: true, value, tree, variables };
  } catch (err) {
    return { ok: false, error: (err as Error).message, position: -1, tree, variables };
  }
}

export const VARIABLE_LABELS: Record<string, { label: string; unit: string }> = {
  width_mm: { label: "Width", unit: "mm" },
  height_mm: { label: "Length", unit: "mm" },
  depth_mm: { label: "Depth", unit: "mm" },
  thickness_mm: { label: "Thickness", unit: "mm" },
  area_m2: { label: "Plan area", unit: "m²" },
  length_m: { label: "Length", unit: "m" },
  perimeter_m: { label: "Perimeter", unit: "m" },
  count: { label: "Count", unit: "no." },
  engine: { label: "Engine value", unit: "" },
  measured: { label: "Measured", unit: "" },
};

type Template = { field: string; expression: string };

const TEMPLATES: Template[] = [
  { field: "concrete_m3", expression: "area_m2 * depth_mm / 1000" },
  { field: "concrete_m3", expression: "width_mm * height_mm * depth_mm / 1e9" },
  { field: "concrete_m3", expression: "area_m2 * thickness_mm / 1000" },
  { field: "concrete_m3", expression: "width_mm * depth_mm * length_m / 1e6" },
  { field: "formwork_m2", expression: "2 * (width_mm + height_mm) * depth_mm / 1e6" },
  { field: "formwork_m2", expression: "perimeter_m * depth_mm / 1000" },
  { field: "area_m2", expression: "area_m2" },
  { field: "area_m2", expression: "width_mm * height_mm / 1e6" },
];

/**
 * A starting formula for a recorded quantity. A template is offered only when it reproduces
 * the engine's number from the record's own inputs; otherwise the engine value is the variable.
 */
export function deriveExpression(
  field: string,
  value: number | null,
  inputs: Record<string, unknown>,
): { expression: string; variables: Record<string, number> } {
  const numeric: Record<string, number> = {};
  for (const [k, v] of Object.entries(inputs || {})) {
    if (typeof v === "number" && Number.isFinite(v)) numeric[k] = v;
  }
  if (value != null) {
    for (const t of TEMPLATES.filter((t) => t.field === field)) {
      const result = evaluate(t.expression, numeric);
      if (!result.ok) continue;
      const tolerance = Math.max(Math.abs(value) * 0.001, 0.0005);
      if (Math.abs(result.value - value) <= tolerance) {
        const used: Record<string, number> = {};
        result.variables.forEach((name) => (used[name] = numeric[name]!));
        return { expression: t.expression, variables: used };
      }
    }
  }
  return { expression: "engine", variables: { engine: value ?? 0 } };
}
