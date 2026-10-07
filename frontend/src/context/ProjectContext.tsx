import { createContext, useContext, type ReactNode } from "react";
import type { Project } from "../types";
import type { OpenPhase } from "../hooks/useProjectOpenFlow";

export type ProjectOutletContext = {
  project: Project;
  phase: OpenPhase;
  statusLabel: string;
  progress: number | null;
  visibleShapeIds: Set<string> | null;
};

const Ctx = createContext<ProjectOutletContext | null>(null);

export function ProjectContextProvider({ value, children }: { value: ProjectOutletContext; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProjectContext() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Project context missing");
  return ctx;
}
