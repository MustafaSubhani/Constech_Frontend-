import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useToast } from "../components/Toast";
import { ConstechLoader } from "../components/ConstechLoader";
import { DISCOVERY_LOADER_LABELS } from "../components/flowLabels";
import { useProjectOpenFlow } from "../hooks/useProjectOpenFlow";
import { ProjectContextProvider } from "../context/ProjectContext";
import { BlueprintIcon, FileTextIcon, CoinsIcon, CheckIcon } from "../components/Icons";

const STEP_META: Record<string, { label: string; desc: string; num: number }> = {
  discover:    { label: "Discover",    desc: "Read drawing set, identify sheets and element types", num: 1 },
  foundations: { label: "Foundations", desc: "Measure footings, rafts, columns, piles, and substructure", num: 2 },
  structure:   { label: "Structure",   desc: "Measure slabs, beams, walls, tanks, and superstructure", num: 3 },
};

export function ProjectLayout() {
  const { projectId = "" } = useParams();
  const qc = useQueryClient();
  const { show } = useToast();
  const [loaderOut, setLoaderOut] = useState(false);
  const [loaderDone, setLoaderDone] = useState(false);
  const loaderStarted = useRef(0);

  const summary = useQuery({
    queryKey: ["project", projectId, "summary"],
    queryFn: () => api.getProject(projectId, false),
    enabled: Boolean(projectId),
  });

  const summaryReady = Boolean(summary.data && !summary.isLoading);
  const workspaceOpen = summaryReady && loaderDone;

  const catalog = useQuery({
    queryKey: ["project", projectId, "catalog"],
    queryFn: () => api.getProject(projectId, true),
    enabled: Boolean(projectId) && workspaceOpen,
    staleTime: 0,
  });

  const project = catalog.data ?? summary.data;
  const catalogBusy = workspaceOpen && (catalog.isLoading || catalog.isFetching);

  const flow = useProjectOpenFlow(projectId, workspaceOpen, catalog.data, catalogBusy);

  useEffect(() => {
    setLoaderDone(false);
    setLoaderOut(false);
    loaderStarted.current = performance.now();
  }, [projectId]);

  useEffect(() => {
    if (!summaryReady) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const minMs = reduced ? 180 : 900;
    const wait = Math.max(0, minMs - (performance.now() - loaderStarted.current));
    const fade = window.setTimeout(() => setLoaderOut(true), wait);
    const done = window.setTimeout(() => setLoaderDone(true), wait + (reduced ? 0 : 280));
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [summaryReady]);

  const run = useMutation({
    mutationFn: (kind: "discover" | "foundations" | "structure") => api.runProject(projectId, kind),
    onSuccess: async (result) => {
      show(result.message);
      await qc.invalidateQueries({ queryKey: ["project", projectId] });
      await qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (err: Error) => show(err.message),
  });

  if (!summaryReady || !loaderDone || !summary.data) {
    return (
      <ConstechLoader
        active={!loaderOut || !summaryReady}
        exiting={loaderOut && summaryReady}
        statusLabels={DISCOVERY_LOADER_LABELS}
      />
    );
  }

  const runs = project?.runs || {};
  const busy = run.isPending ? run.variables : null;
  const base = `/p/${encodeURIComponent(projectId)}`;
  const showProgress = flow.phase !== "ready" && flow.progress != null;

  const outletContext = {
    project: project!,
    phase: flow.phase,
    statusLabel: flow.statusLabel,
    progress: flow.progress,
    visibleShapeIds: flow.visibleShapeIds,
  };

  return (
    <ProjectContextProvider value={outletContext}>
      <div className="subbar">
        {/* Workspace navigation tabs */}
        <nav className="tabs">
          <NavLink to={base} end className={({ isActive }) => (isActive ? "active" : undefined)}>
            <BlueprintIcon size={14} style={{ verticalAlign: -1, marginRight: 6 }} />
            Drawings
          </NavLink>
          <NavLink to={`${base}/bill`} className={({ isActive }) => (isActive ? "active" : undefined)}>
            <FileTextIcon size={14} style={{ verticalAlign: -1, marginRight: 6 }} />
            Bill Comparison
          </NavLink>
          <NavLink to={`${base}/rates`} className={({ isActive }) => (isActive ? "active" : undefined)}>
            <CoinsIcon size={14} style={{ verticalAlign: -1, marginRight: 6 }} />
            Rates &amp; Estimation
          </NavLink>
        </nav>

        {/* Pipeline steps cluster */}
        <div className="subbar-right">
          {flow.statusLabel ? (
            <span className="open-status">
              <span className="open-status-text">{flow.statusLabel}</span>
            </span>
          ) : null}

          <div className="pipeline-steps">
            {(["discover", "foundations", "structure"] as const).map((kind) => {
              const meta = STEP_META[kind];
              const isDone = Boolean(runs[kind]);
              const isRunning = busy === kind;
              const isNext = !isDone && !busy && (kind === "discover" || runs["discover"]);
              return (
                <button
                  key={kind}
                  type="button"
                  className={[
                    "pipeline-step",
                    isDone ? "done" : "",
                    isRunning ? "running" : "",
                    isNext && !isDone ? "primary" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  disabled={Boolean(busy) || flow.phase !== "ready"}
                  onClick={() => run.mutate(kind)}
                  title={meta.desc}
                >
                  {isRunning ? (
                    <span className="step-spinner" aria-hidden="true" />
                  ) : isDone ? (
                    <CheckIcon size={12} />
                  ) : (
                    <span className="step-num" aria-hidden="true">{meta.num}</span>
                  )}
                  {isRunning ? "Running" : meta.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {showProgress ? (
        <div className="open-progress" aria-hidden="true">
          <span style={{ width: `${Math.round((flow.progress ?? 0) * 100)}%` }} />
        </div>
      ) : null}

      <div className="project-stage">
        <Outlet />
      </div>
    </ProjectContextProvider>
  );
}
