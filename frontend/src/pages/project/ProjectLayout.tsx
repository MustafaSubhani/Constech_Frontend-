import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { PipelineJob, PipelineStatus, StageKey } from "../../types";
import { getSettings } from "../../lib/settings";
import { useToast } from "../../components/ui/Toast";
import { useShell } from "../../components/shell/ShellContext";
import { AssistantPanel } from "../../components/assistant/AssistantPanel";
import { PipelineView } from "../../components/pipeline/PipelineView";
import { ProjectContext } from "./ProjectContext";

type Phase = "opening" | "review" | "ready";

const ENGINE: StageKey[] = ["discover", "foundations", "structure"];

export function ProjectLayout() {
  const { projectId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { assistantOpen, setAssistantOpen } = useShell();
  const [phase, setPhase] = useState<Phase>("opening");
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [openError, setOpenError] = useState("");
  const [revealKey, setRevealKey] = useState(0);
  const startedFor = useRef("");
  const lastStatus = useRef<string | null>(null);
  const awaiting = useRef<string | null>(null);

  const summary = useQuery({
    queryKey: ["project", projectId, "summary"],
    queryFn: () => api.getProjectSummary(projectId),
    enabled: Boolean(projectId),
  });

  const pipeline = useQuery<PipelineStatus>({
    queryKey: ["pipeline", projectId],
    queryFn: () => api.pipelineStatus(projectId),
    enabled: Boolean(projectId),
    // Keep polling while a job runs, and while a job we just started has not shown up yet.
    refetchInterval: (q) => {
      const current = q.state.data?.job;
      if (current?.status === "running") return 650;
      return awaiting.current && current?.id !== awaiting.current ? 650 : false;
    },
    staleTime: 0,
  });
  const job = pipeline.data?.job ?? null;
  const running = job?.status === "running";

  const full = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId),
    enabled: Boolean(projectId) && phase !== "opening" && !running,
    staleTime: 10_000,
  });

  const begin = useCallback(
    async (body: Parameters<typeof api.startPipeline>[1], onStarted?: (job: PipelineJob) => void) => {
      const started = await api.startPipeline(projectId, body);
      // A status request sent before the start must not overwrite the new job when it lands.
      await qc.cancelQueries({ queryKey: ["pipeline", projectId] });
      awaiting.current = started.id;
      onStarted?.(started);
      qc.setQueryData<PipelineStatus>(["pipeline", projectId], (old) => ({
        runs: old?.runs ?? { discover: false, foundations: false, structure: false },
        lastRun: old?.lastRun ?? {},
        job: started,
      }));
      return started;
    },
    [projectId, qc],
  );

  useEffect(() => {
    if (!projectId || startedFor.current === projectId) return;
    startedFor.current = projectId;
    setPhase("opening");
    setOpenError("");
    setOpenJobId(null);
    const settings = getSettings();
    begin({ mode: "open", autorun: settings.autorunNewProjects, discovery: settings.discovery }, (started) => setOpenJobId(started.id))
      .catch((err: Error) => setOpenError(err.message));
  }, [projectId, begin]);

  const afterJob = useCallback(
    async (finished: PipelineJob) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["project", projectId] }),
        qc.invalidateQueries({ queryKey: ["inputs", projectId] }),
        qc.invalidateQueries({ queryKey: ["bills", projectId] }),
        qc.invalidateQueries({ queryKey: ["projects"] }),
        qc.invalidateQueries({ queryKey: ["files", projectId] }),
      ]);
      if (finished.id === openJobId) {
        const ranEngine = finished.stages.some((s) => ENGINE.includes(s.key) && (s.status === "done" || s.status === "error"));
        const failed = finished.stages.some((s) => s.status === "error");
        setPhase(ranEngine || failed ? "review" : "ready");
        setRevealKey((k) => k + 1);
      } else {
        const failed = finished.stages.find((s) => s.status === "error");
        if (failed) toast.error(`${failed.label} failed: ${failed.detail}`);
        else toast.success("Pipeline finished. Results are up to date.");
        setRevealKey((k) => k + 1);
      }
    },
    [openJobId, projectId, qc, toast],
  );

  useEffect(() => {
    if (!job) return;
    const key = `${job.id}:${job.status}`;
    if (lastStatus.current === key) return;
    const wasRunning = lastStatus.current?.startsWith(`${job.id}:running`);
    lastStatus.current = key;
    if (job.status !== "running" && (wasRunning || job.id === openJobId)) void afterJob(job);
  }, [job, openJobId, afterJob]);

  const startRun = useCallback(
    async (stages: StageKey[]) => {
      try {
        await begin({ mode: "run", stages, discovery: getSettings().discovery });
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [begin, toast],
  );

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["project", projectId] });
    await qc.invalidateQueries({ queryKey: ["projects"] });
  }, [projectId, qc]);

  const project = full.data;
  const ctx = useMemo(
    () =>
      project
        ? { projectId, project, pipeline: pipeline.data, job, running, revealKey, startRun, refresh }
        : null,
    [projectId, project, pipeline.data, job, running, revealKey, startRun, refresh],
  );

  if (summary.error && (summary.error as { status?: number }).status === 404) {
    return (
      <div className="page-scroll">
        <div className="empty-state" style={{ paddingTop: 96 }}>
          <h3>This project is not available</h3>
          <p>It may have been renamed or removed from the work folder.</p>
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => navigate("/projects")}>
              All projects
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase !== "ready" || !ctx) {
    const fresh = Boolean((location.state as { fresh?: boolean } | null)?.fresh);
    return (
      <div className="page-scroll">
        <PipelineView
          variant="open"
          title={summary.data?.name ?? projectId}
          job={openJobId && job?.id === openJobId ? job : null}
          error={openError}
          fresh={fresh}
          finished={phase === "review" || (phase === "ready" && !ctx)}
          loadingWorkspace={phase !== "opening" && !ctx}
          projectId={projectId}
          onContinue={() => setPhase("ready")}
          onRetry={() => {
            setPhase("opening");
            setOpenJobId(null);
            begin({ mode: "run", stages: ENGINE, discovery: getSettings().discovery }, (started) => setOpenJobId(started.id))
              .catch((err: Error) => setOpenError(err.message));
          }}
        />
      </div>
    );
  }

  return (
    <ProjectContext.Provider value={ctx}>
      <div className="project-main" key={projectId}>
        <Outlet />
      </div>
      {assistantOpen ? <AssistantPanel key={projectId} projectId={projectId} onClose={() => setAssistantOpen(false)} /> : null}
    </ProjectContext.Provider>
  );
}
