import type { Capability } from "../types";

const LABELS: Record<string, string> = {
  footings_isolated: "Isolated footings",
  footings_pile_caps: "Pile caps",
  storey_heights_ssl: "Storey levels",
  storey_heights: "Storey levels",
  slabs_villa_style: "Slabs",
  slabs_outlined: "Slabs",
  slabs: "Slabs",
  beams_sized_labels: "Beams",
  beams: "Beams",
  walls: "Walls",
  blinding: "Blinding",
  pdf_searchable_text: "PDF text",
};

export function capabilityLabel(id: string): string {
  return LABELS[id] ?? id.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function capabilityTally(caps: Capability[]) {
  const tally = { ready: 0, partial: 0, blocked: 0 };
  for (const cap of caps) {
    if (cap.status === "ready") tally.ready += 1;
    else if (cap.status === "blocked") tally.blocked += 1;
    else tally.partial += 1;
  }
  return tally;
}
