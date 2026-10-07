export const KIND_META: Record<string, { name: string; color: string }> = {
  footing: { name: "Footings", color: "#2B0266" },
  raft: { name: "Rafts", color: "#6D28A8" },
  missed: { name: "Not in schedule", color: "#9B2C2C" },
  column: { name: "Columns", color: "#1F6B82" },
  wall: { name: "Walls", color: "#2E8F79" },
  slab: { name: "Slabs", color: "#A6844A" },
  beam: { name: "Beams", color: "#3C3A66" },
};

export const KIND_ORDER = ["footing", "raft", "missed", "column", "wall", "slab", "beam"];
