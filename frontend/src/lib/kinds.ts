/** Element kinds drawn on sheets. Colours are flat and distinguishable in both themes. */
export const KIND_META: Record<string, { name: string; single: string; color: string }> = {
  footing: { name: "Footings", single: "Footing", color: "#5B3FD1" },
  raft: { name: "Rafts", single: "Raft", color: "#9A4DCC" },
  column: { name: "Columns", single: "Column", color: "#1D7FA8" },
  wall: { name: "Walls", single: "Wall", color: "#178A72" },
  slab: { name: "Slabs", single: "Slab", color: "#B7791F" },
  beam: { name: "Beams", single: "Beam", color: "#C2410C" },
  missed: { name: "Not in schedule", single: "Unmatched outline", color: "#D92D20" },
};

export const KIND_ORDER = ["footing", "raft", "column", "wall", "slab", "beam", "missed"];

export const ELEMENT_TYPES: { value: string; label: string; kind: string }[] = [
  { value: "footing", label: "Footing", kind: "footing" },
  { value: "raft", label: "Raft", kind: "raft" },
  { value: "column_storey", label: "Column", kind: "column" },
  { value: "column_neck", label: "Column neck", kind: "column" },
  { value: "wall_storey", label: "Wall", kind: "wall" },
  { value: "suspended_slab", label: "Suspended slab", kind: "slab" },
  { value: "slab_on_grade", label: "Slab on grade", kind: "slab" },
  { value: "grade_beam", label: "Grade beam", kind: "beam" },
  { value: "beam", label: "Beam", kind: "beam" },
  { value: "other", label: "Other", kind: "missed" },
];

export function elementLabel(type: string): string {
  const hit = ELEMENT_TYPES.find((e) => e.value === type);
  if (hit) return hit.label;
  return type.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export const STATUS_META: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "info" | "neutral" }> = {
  auto: { label: "Measured", tone: "ok" },
  review: { label: "Needs review", tone: "warn" },
  blocked: { label: "Blocked", tone: "bad" },
  excluded: { label: "Removed", tone: "neutral" },
  adjusted: { label: "Adjusted", tone: "info" },
  manual: { label: "Added by hand", tone: "info" },
};
