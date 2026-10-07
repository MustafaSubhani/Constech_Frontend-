import { createContext, useContext } from "react";
import type { PipelineJob, PipelineStatus, Project, StageKey } from "../../types";

export type ProjectCtx = {
  projectId: string;
  project: Project;
  pipeline: PipelineStatus | undefined;
  job: PipelineJob | null;
  running: boolean;
  revealKey: number;
  startRun: (stages: StageKey[]) => Promise<void>;
  refresh: () => Promise<void>;
};

export const ProjectContext = createContext<ProjectCtx | null>(null);

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("Project context missing");
  return ctx;
}
