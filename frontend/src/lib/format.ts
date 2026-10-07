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

export function money(value: number, currency: string, digits = 0): string {
  const text = value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return currency ? `${currency} ${text}` : text;
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

export const BAND_LABEL: Record<Band, string> = {
  close: "Within 5%",
  near: "Within 15%",
  far: "Over 15%",
  open: "No bill value",
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function relativeTime(iso: string | number | null | undefined): string {
  if (!iso) return "";
  const date = typeof iso === "number" ? new Date(iso * 1000) : new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function duration(ms: number | null | undefined): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
}

export const QUANTITY_FIELDS: { key: string; label: string; unit: string; digits: number }[] = [
  { key: "concrete_m3", label: "Concrete", unit: "m³", digits: 3 },
  { key: "formwork_m2", label: "Formwork", unit: "m²", digits: 2 },
  { key: "rebar_kg", label: "Reinforcement", unit: "kg", digits: 1 },
  { key: "area_m2", label: "Area", unit: "m²", digits: 2 },
  { key: "blinding_m3", label: "Blinding", unit: "m³", digits: 3 },
];

export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
