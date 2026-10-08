import { ClipboardList, Coins, FileSpreadsheet, Layers, Workflow } from "lucide-react";

export const PROJECT_TABS = [
  { path: "", label: "Drawings", icon: Layers },
  { path: "bill", label: "Bill comparison", icon: FileSpreadsheet },
  { path: "rates", label: "Rates and estimate", icon: Coins },
  { path: "inputs", label: "Schedules and inputs", icon: ClipboardList },
  { path: "pipeline", label: "Pipeline", icon: Workflow },
] as const;

/** Project pages where the assistant can read and change things (the pipeline page only runs the engine). */
export const ASSISTANT_TABS = new Set<string>(["", "bill", "rates", "inputs"]);
