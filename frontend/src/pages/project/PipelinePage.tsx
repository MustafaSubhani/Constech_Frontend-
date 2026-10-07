import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { api } from "../../api/client";
import type { PipelineStage, StageKey } from "../../types";
import { duration, formatBytes, relativeTime } from "../../lib/format";
import { updateSettings, useSettings } from "../../lib/settings";
import { useProject } from "./ProjectContext";
import { STAGE_ORDER, StageList } from "../../components/pipeline/PipelineView";

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
                  ? `Last run ${relativeTime(job.startedAt)} took ${duration(job.elapsedMs)}.`
                  : "Each stage reads the output of the one before it."}
            </p>
          </div>
        </header>

        <div className="pipeline-grid">
          <section className="card pipeline-card">
            <StageList stages={history} />
          </section>

          <aside className="stack" style={{ gap: 16 }}>
            <section className="card side-card">
              <h3>Run stages</h3>
              <p className="muted small">Pick what to run again. Later stages always rebuild the sheets and the comparison.</p>
              <div className="stack" style={{ gap: 8, margin: "12px 0" }}>
                {ENGINE.map((e) => (
                  <label key={e.key} className="check">
                    <input
                      type="checkbox"
                      checked={chosen.has(e.key)}
                      onChange={(ev) =>
                        setChosen((prev) => {
                          const next = new Set(prev);
                          if (ev.target.checked) next.add(e.key);
                          else next.delete(e.key);
                          return next;
                        })
                      }
                    />
                    {e.label}
                    <span className="faint small">{runs?.[e.key as keyof typeof runs] ? "has results" : "not run"}</span>
                  </label>
                ))}
              </div>
              <div className="field" style={{ marginBottom: 12 }}>
                <span className="field-label">Discovery method</span>
                <div className="segmented">
                  <button type="button" aria-pressed={settings.discovery === "rules"} onClick={() => updateSettings({ discovery: "rules" })}>
                    Rule based
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
              </div>
              <button
                type="button"
                className="btn btn-primary btn-block"
                disabled={running || !chosen.size}
                onClick={() => startRun(ENGINE.filter((e) => chosen.has(e.key)).map((e) => e.key))}
              >
                {running ? <span className="spinner" /> : <Play size={15} />}
                {running ? "Running" : `Run ${chosen.size} stage${chosen.size === 1 ? "" : "s"}`}
              </button>
            </section>

            <section className="card side-card">
              <h3>Project files</h3>
              <p className="muted small">
                {[
                  counts.drawing ? `${counts.drawing} DWG` : "",
                  counts.sheet ? `${counts.sheet} PDF` : "",
                  counts.bill ? `${counts.bill} bill` : "",
                  counts.notes ? `${counts.notes} notes` : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || "No files"}
              </p>
              <ul className="file-mini">
                {(files.data ?? []).slice(0, 40).map((f) => (
                  <li key={f.path}>
                    <span className={`file-ext x-${f.ext}`}>{f.ext.toUpperCase()}</span>
                    <span className="truncate grow" title={f.path}>
                      {f.name}
                    </span>
                    <span className="faint small">{formatBytes(f.sizeBytes)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
