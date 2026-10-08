import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, FilePlus2, Play } from "lucide-react";
import { api } from "../../api/client";
import type { PipelineStage, StageKey } from "../../types";
import { duration, formatBytes, relativeTime } from "../../lib/format";
import { updateSettings, useSettings } from "../../lib/settings";
import { useProject } from "./ProjectContext";
import { STAGE_ORDER, StageList } from "../../components/pipeline/PipelineView";
import { UploadDialog } from "../../components/UploadDialog";

const ENGINE: { key: StageKey; label: string }[] = [
  { key: "discover", label: "Discover" },
  { key: "foundations", label: "Foundations" },
  { key: "structure", label: "Structure" },
];

export function PipelinePage() {
  const { projectId, pipeline, job, running, startRun } = useProject();
  const settings = useSettings();
  const runs = pipeline?.runs;
  const [chosen, setChosen] = useState<Set<StageKey>>(() => new Set(ENGINE.filter((e) => !runs?.[e.key as keyof typeof runs]).map((e) => e.key)));
  const [uploadOpen, setUploadOpen] = useState(false);
  const files = useQuery({ queryKey: ["files", projectId], queryFn: () => api.listFiles(projectId) });
  const assistant = useQuery({ queryKey: ["assistant-status"], queryFn: api.assistantStatus });
  const assistantReady = Boolean(assistant.data?.enabled && !assistant.data.problems.length);

  const history: PipelineStage[] = useMemo(() => {
    if (job) return job.stages;
    return STAGE_ORDER.map((m) => {
      const last = pipeline?.lastRun?.[m.key];
      const done = m.key in (runs ?? {}) ? runs?.[m.key as keyof typeof runs] : undefined;
      return {
        key: m.key,
        label: m.label,
        status: (last?.status as PipelineStage["status"]) ?? (done ? "done" : "pending"),
        detail: last?.detail ?? "",
        progress: null,
        startedAt: null,
        endedAt: last?.endedAt ?? null,
        durationMs: last?.durationMs ?? null,
        lines: [],
      };
    });
  }, [job, pipeline, runs]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (files.data ?? []).forEach((f) => (c[f.kind] = (c[f.kind] ?? 0) + 1));
    return c;
  }, [files.data]);
  const fileSummary =
    [
      counts.drawing ? `${counts.drawing} DWG` : "",
      counts.sheet ? `${counts.sheet} PDF` : "",
      counts.bill ? `${counts.bill} bill${counts.bill === 1 ? "" : "s"}` : "",
      counts.notes ? `${counts.notes} notes` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "No files yet";

  const toggle = (key: StageKey) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="page-scroll">
      <div className="page-wrap page pipeline-page">
        <header className="page-head">
          <div className="titles">
            <h1>Pipeline</h1>
            <p>
              {running
                ? "Running now. You can keep working; results refresh when it finishes."
                : job
                  ? `Last run ${relativeTime(job.startedAt)}, took ${duration(job.elapsedMs)}.`
                  : "Each stage reads the output of the one before it."}
            </p>
          </div>
          <div className="run-bar" role="group" aria-label="Run the pipeline">
            <div className="stage-toggles" role="group" aria-label="Stages to run">
              {ENGINE.map((e) => {
                const has = Boolean(runs?.[e.key as keyof typeof runs]);
                const on = chosen.has(e.key);
                return (
                  <button
                    key={e.key}
                    type="button"
                    className={`stage-toggle${on ? " on" : ""}`}
                    aria-pressed={on}
                    onClick={() => toggle(e.key)}
                    disabled={running}
                    title={has ? `${e.label} has results; select to run it again` : `${e.label} has not run yet`}
                  >
                    <span className="stage-box">{on ? <Check size={11} strokeWidth={3} /> : null}</span>
                    {e.label}
                    <span className={`stage-state${has ? " ok" : ""}`} aria-label={has ? "has results" : "not run"} />
                  </button>
                );
              })}
            </div>
            <div className="segmented" aria-label="Discovery method">
              <button type="button" aria-pressed={settings.discovery === "rules"} onClick={() => updateSettings({ discovery: "rules" })}>
                Rules
              </button>
              <button
                type="button"
                aria-pressed={settings.discovery === "agentic"}
                disabled={!assistantReady}
                title={assistantReady ? "Rule-based pass, then an assistant review" : "Enable the assistant in Settings"}
                onClick={() => updateSettings({ discovery: "agentic" })}
              >
                With assistant
              </button>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={running || !chosen.size}
              title={chosen.size ? undefined : "Pick at least one stage"}
              onClick={() => startRun(ENGINE.filter((e) => chosen.has(e.key)).map((e) => e.key))}
            >
              {running ? <span className="spinner" /> : <Play size={15} />}
              {running ? "Running" : chosen.size ? `Run ${chosen.size} stage${chosen.size === 1 ? "" : "s"}` : "Run"}
            </button>
          </div>
        </header>

        <div className="pipeline-grid">
          <section className="card pipeline-card">
            <header className="card-head">
              <div className="grow">
                <h2>Stages</h2>
                <p>Later stages always rebuild the sheet views and the comparison.</p>
              </div>
            </header>
            <StageList stages={history} />
          </section>

          <section className="card pipeline-card files-card">
            <header className="card-head">
              <div className="grow">
                <h2>Project files</h2>
                <p>{fileSummary}</p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setUploadOpen(true)}>
                <FilePlus2 size={14} /> Add files
              </button>
            </header>
            {files.isLoading ? (
              <div className="stack" style={{ gap: 10, paddingTop: 4 }}>
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="sk sk-line" style={{ ["--delay" as string]: `${i * 100}ms` }} />
                ))}
              </div>
            ) : files.data?.length ? (
              <ul className="file-mini">
                {files.data.map((f) => (
                  <li key={f.path}>
                    <span className={`file-ext x-${f.ext}`}>{f.ext.toUpperCase()}</span>
                    <span className="truncate grow" title={f.path}>
                      {f.name}
                    </span>
                    <span className="faint small tnum">{formatBytes(f.sizeBytes)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-state" style={{ padding: "28px 12px" }}>
                <p>Add DWG or PDF sheets, a bill and any notes to start.</p>
              </div>
            )}
          </section>
        </div>
      </div>
      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} projectId={projectId} />
    </div>
  );
}
