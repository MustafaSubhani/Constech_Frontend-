import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, Circle, CircleSlash, RotateCcw, X } from "lucide-react";
import { api } from "../../api/client";
import type { PipelineJob, PipelineStage, StageStatus } from "../../types";
import { duration } from "../../lib/format";

export const STAGE_ORDER: { key: PipelineStage["key"]; label: string; about: string }[] = [
  { key: "files", label: "Load project files", about: "Index the drawings, sheets, bills and notes in the project folder" },
  { key: "discover", label: "Discover drawing set", about: "Classify every sheet and find schedules, notes and levels" },
  { key: "foundations", label: "Measure foundations", about: "Footings, rafts and blinding from the schedule and plan outlines" },
  { key: "structure", label: "Measure structure", about: "Columns, slabs, beams and walls on the floor plans" },
  { key: "sheets", label: "Build sheet views", about: "Render each sheet and place the measured outlines on it" },
  { key: "compare", label: "Compare with bill", about: "Match measured totals to the bill lines" },
];

const STATUS_TEXT: Record<StageStatus, string> = {
  pending: "Waiting",
  running: "Running",
  done: "Done",
  cached: "Up to date",
  skipped: "Not run",
  error: "Failed",
  blocked: "Stopped",
};

function StageIcon({ status }: { status: StageStatus }) {
  if (status === "running") return <span className="spinner" />;
  if (status === "done" || status === "cached") return <Check size={13} strokeWidth={3} />;
  if (status === "error") return <X size={13} strokeWidth={3} />;
  if (status === "skipped" || status === "blocked") return <CircleSlash size={13} strokeWidth={2.5} />;
  return <Circle size={13} />;
}

export function StageList({ stages, showLog = true }: { stages: PipelineStage[]; showLog?: boolean }) {
  return (
    <ol className="stages">
      {stages.map((s, i) => {
        const meta = STAGE_ORDER.find((m) => m.key === s.key);
        return (
          <li key={s.key} className={`stage st-${s.status}`} style={{ ["--delay" as string]: `${i * 40}ms` }}>
            <span className="stage-icon">
              <StageIcon status={s.status} />
            </span>
            <div className="stage-body">
              <div className="stage-row">
                <strong>{s.label || meta?.label}</strong>
                <span className="stage-status">{STATUS_TEXT[s.status]}</span>
                {s.durationMs != null && s.status !== "running" ? <span className="stage-time">{duration(s.durationMs)}</span> : null}
              </div>
              <p className="stage-detail">{s.detail || (s.status === "pending" || s.status === "running" ? meta?.about : "")}</p>
              {s.status === "running" ? (
                <div className={`progress${s.progress == null ? " indeterminate" : ""}`}>
                  <span style={s.progress != null ? { width: `${Math.max(4, s.progress * 100)}%` } : undefined} />
                </div>
              ) : null}
              {showLog && s.lines.length && (s.status === "running" || s.status === "error") ? (
                <pre className="stage-log">{s.lines.slice(-5).join("\n")}</pre>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function placeholderStages(): PipelineStage[] {
  return STAGE_ORDER.map((m) => ({
    key: m.key,
    label: m.label,
    status: "pending",
    detail: "",
    progress: null,
    startedAt: null,
    endedAt: null,
    durationMs: null,
    lines: [],
  }));
}

type Props = {
  variant: "open";
  title: string;
  job: PipelineJob | null;
  error?: string;
  fresh?: boolean;
  finished?: boolean;
  loadingWorkspace?: boolean;
  projectId: string;
  onContinue: () => void;
  onRetry: () => void;
};

export function PipelineView({ title, job, error, fresh, finished, loadingWorkspace, projectId, onContinue, onRetry }: Props) {
  const navigate = useNavigate();
  const stages = job?.stages ?? placeholderStages();
  const settled = stages.filter((s) => s.status !== "pending" && s.status !== "running").length;
  const failed = stages.filter((s) => s.status === "error");
  const ranEngine = stages.some((s) => ["discover", "foundations", "structure"].includes(s.key) && s.status === "done");
  const inputs = useQuery({
    queryKey: ["inputs", projectId],
    queryFn: () => api.getInputs(projectId),
    enabled: Boolean(finished && ranEngine),
  });
  const missing = (inputs.data?.entries ?? []).filter((e) => e.status === "missing");
  const found = (inputs.data?.entries ?? []).filter((e) => e.status === "found" || e.status === "manual");
  const runningStage = stages.find((s) => s.status === "running");

  return (
    <div className="pipeline-open page">
      <header className="pipeline-head">
        <span className="eyebrow">{fresh ? "New project" : "Opening project"}</span>
        <h1>{title}</h1>
        <p className="muted">
          {error
            ? "The pipeline could not start."
            : finished
              ? failed.length
                ? "Finished with problems. Review the failed stage below."
                : ranEngine
                  ? "Measured. Check what was found before you start reviewing."
                  : "Everything is up to date."
              : runningStage
                ? `${runningStage.label}${job ? ` · ${duration(job.elapsedMs)}` : ""}`
                : "Starting"}
        </p>
        <div className="progress" aria-hidden="true">
          <span style={{ width: `${(settled / stages.length) * 100}%` }} />
        </div>
      </header>

      {error ? (
        <div className="banner banner-bad">
          <AlertTriangle size={16} />
          <div className="banner-body">{error}</div>
          <div className="banner-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      ) : null}

      <StageList stages={stages} />

      {finished ? (
        <section className="pipeline-result enter">
          {failed.length ? (
            <div className="banner banner-bad">
              <AlertTriangle size={16} />
              <div className="banner-body">
                <strong>{failed[0]!.label} failed.</strong> {failed[0]!.detail}
              </div>
            </div>
          ) : null}
          {ranEngine && inputs.data ? (
            <div className="result-columns">
              <div>
                <h3>Found</h3>
                <ul className="result-list ok">
                  {found.slice(0, 6).map((e) => (
                    <li key={e.key}>
                      <Check size={13} strokeWidth={3} /> {e.label}
                    </li>
                  ))}
                  {!found.length ? <li className="muted">Nothing recognised yet</li> : null}
                </ul>
              </div>
              <div>
                <h3>Missing</h3>
                <ul className="result-list warn">
                  {missing.slice(0, 6).map((e) => (
                    <li key={e.key}>
                      <Circle size={9} strokeWidth={3} /> {e.label}
                    </li>
                  ))}
                  {!missing.length ? <li className="muted">Nothing missing</li> : null}
                </ul>
              </div>
            </div>
          ) : null}
          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            {failed.length ? (
              <button type="button" className="btn btn-secondary" onClick={onRetry}>
                <RotateCcw size={15} /> Run again
              </button>
            ) : null}
            {missing.length ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  onContinue();
                  navigate(`/p/${encodeURIComponent(projectId)}/inputs`);
                }}
              >
                Add missing inputs
              </button>
            ) : null}
            <button type="button" className="btn btn-primary" onClick={onContinue} disabled={loadingWorkspace}>
              {loadingWorkspace ? <span className="spinner" /> : null}
              Open workspace <ArrowRight size={16} />
            </button>
          </div>
        </section>
      ) : loadingWorkspace ? (
        <p className="row muted" style={{ justifyContent: "center" }}>
          <span className="spinner" /> Opening the workspace
        </p>
      ) : null}
    </div>
  );
}
