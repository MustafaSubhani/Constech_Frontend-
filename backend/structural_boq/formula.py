"""Safe arithmetic for user-edited quantity formulas.

Only numbers, named variables, + - * / ** ^, parentheses and a few functions are allowed.
The frontend evaluates the same grammar for live previews; the server result is authoritative.
"""
import ast
import math
import re

_FUNCS = {
    "min": min,
    "max": max,
    "abs": abs,
    "round": round,
    "sqrt": math.sqrt,
    "ceil": math.ceil,
    "floor": math.floor,
    "pi": None,
}
_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class FormulaError(ValueError):
    pass


def _eval(node, variables):
    if isinstance(node, ast.Expression):
        return _eval(node.body, variables)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return float(node.value)
    if isinstance(node, ast.Name):
        if node.id == "pi":
            return math.pi
        if node.id not in variables:
            raise FormulaError(f"Unknown variable '{node.id}'")
        value = variables[node.id]
        try:
            return float(value)
        except (TypeError, ValueError) as exc:
            raise FormulaError(f"Variable '{node.id}' is not a number") from exc
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
        value = _eval(node.operand, variables)
        return value if isinstance(node.op, ast.UAdd) else -value
    if isinstance(node, ast.BinOp):
        left = _eval(node.left, variables)
        right = _eval(node.right, variables)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            if right == 0:
                raise FormulaError("Division by zero")
            return left / right
        if isinstance(node.op, (ast.Pow, ast.BitXor)):
            if abs(right) > 12:
                raise FormulaError("Exponent too large")
            return left ** right
        raise FormulaError("Unsupported operator")
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        fn = _FUNCS.get(node.func.id)
        if fn is None or node.keywords:
            raise FormulaError(f"Unknown function '{node.func.id}'")
        args = [_eval(arg, variables) for arg in node.args]
        if not args:
            raise FormulaError(f"'{node.func.id}' needs a value")
        return float(fn(*args))
    raise FormulaError("Only numbers, variables and + - * / ^ ( ) are allowed")


def evaluate(expression, variables=None):
    """Evaluate an expression like 'L * W * D / 1e9' against named numeric variables."""
    text = (expression or "").strip().lstrip("=").replace("×", "*").replace("÷", "/")
    if not text:
        raise FormulaError("Formula is empty")
    if len(text) > 400:
        raise FormulaError("Formula is too long")
    clean = {}
    for name, value in (variables or {}).items():
        if not _NAME.match(str(name)):
            raise FormulaError(f"Invalid variable name '{name}'")
        clean[str(name)] = value
    try:
        tree = ast.parse(text.replace("^", "**"), mode="eval")
    except SyntaxError as exc:
        raise FormulaError("Formula could not be read") from exc
    result = _eval(tree, clean)
    if not math.isfinite(result):
        raise FormulaError("Formula does not give a finite number")
    return result
