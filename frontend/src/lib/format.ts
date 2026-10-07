export function fmt(value: number | null | undefined, digits: number): string {
  if (value == null || Number.isNaN(value)) return "";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function signed(value: number | null | undefined, digits: number): string {
  if (value == null || Number.isNaN(value)) return "";
  const text = fmt(Math.abs(value), digits);
  if (value > 0) return `+${text}`;
  if (value < 0) return `-${text}`;
  return text;
}

export type Band = "close" | "near" | "far" | "open";

export function bandOf(row: { bill: number | null; ours: number | null }): Band {
  if (row.bill == null || row.ours == null || !row.bill) return "open";
  const pct = Math.abs(((row.ours - row.bill) / row.bill) * 100);
  if (pct <= 5) return "close";
  if (pct <= 15) return "near";
  return "far";
}

export function pctOf(row: { bill: number | null; ours: number | null }): number | null {
  if (row.bill == null || row.ours == null || !row.bill) return null;
  return ((row.ours - row.bill) / row.bill) * 100;
}
