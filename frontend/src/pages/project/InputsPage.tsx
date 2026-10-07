import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Circle, PenLine, Play, Upload } from "lucide-react";
import { api } from "../../api/client";
import type { InputEntry } from "../../types";
import { useProject } from "./ProjectContext";
import { useToast } from "../../components/ui/Toast";
import { UploadDialog } from "../../components/UploadDialog";

const STATUS: Record<InputEntry["status"], { label: string; tone: string }> = {
  found: { label: "Found", tone: "chip-ok" },
  partial: { label: "Partly found", tone: "chip-warn" },
  missing: { label: "Missing", tone: "chip-bad" },
  manual: { label: "Set by hand", tone: "chip-info" },
};

export function InputsPage() {
  const { projectId, startRun, running } = useProject();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const inputs = useQuery({ queryKey: ["inputs", projectId], queryFn: () => api.getInputs(projectId) });
  const [upload, setUpload] = useState<InputEntry | null>(null);
  const [generalUpload, setGeneralUpload] = useState(false);
  const [changed, setChanged] = useState(false);

  const entries = inputs.data?.entries ?? [];
  const groups = useMemo(() => {
    const map = new Map<string, InputEntry[]>();
    entries.forEach((e) => map.set(e.group, [...(map.get(e.group) ?? []), e]));
    return [...map.entries()];
  }, [entries]);
  const tally = useMemo(() => {
    const t = { found: 0, partial: 0, missing: 0, manual: 0 };
    entries.forEach((e) => (t[e.status] += 1));
    return t;
  }, [entries]);

  async function saveValue(key: string, value: number | null) {
    try {
      await api.saveInputs(projectId, { [key]: value });
      await qc.invalidateQueries({ queryKey: ["inputs", projectId] });
      setChanged(true);
      toast.success(value == null ? "Value cleared" : "Value saved");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="page-scroll">
      <div className="page-wrap page">
        <header className="page-head">
          <div className="titles">
            <h1>Schedules and inputs</h1>
            <p>What the engine needs, what it found in the drawings, and what you have set by hand.</p>
          </div>
          <div className="actions">
            <button type="button" className="btn btn-secondary" onClick={() => setGeneralUpload(true)}>
              <Upload size={15} /> Add files
            </button>
            <button type="button" className="btn btn-primary" onClick={() => (setChanged(false), void startRun(["discover", "foundations", "structure"]), navigate(`/p/${encodeURIComponent(projectId)}/pipeline`))} disabled={running}>
              <Play size={15} /> Run discovery and measurement
            </button>
          </div>
        </header>

        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="chip chip-ok">{tally.found} found</span>
          {tally.partial ? <span className="chip chip-warn">{tally.partial} partly found</span> : null}
          <span className={`chip ${tally.missing ? "chip-bad" : ""}`}>{tally.missing} missing</span>
          {tally.manual ? <span className="chip chip-info">{tally.manual} set by hand</span> : null}
        </div>

        {changed ? (
          <div className="banner banner-info enter">
            <AlertCircle size={16} />
            <div className="banner-body">Inputs changed. Run discovery and measurement again so the quantities use them.</div>
            <div className="banner-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => (setChanged(false), void startRun(["discover", "foundations", "structure"]), navigate(`/p/${encodeURIComponent(projectId)}/pipeline`))}>
                Run now
              </button>
            </div>
          </div>
        ) : null}

        {!inputs.data?.discovered && !inputs.isLoading ? (
          <div className="banner banner-warn">
            <AlertCircle size={16} />
            <div className="banner-body">This project has not been discovered yet, so nothing has been looked for. Run the pipeline first.</div>
          </div>
        ) : null}

        {groups.map(([group, items]) => (
          <section key={group} className="card input-group-card">
            <h2 className="input-group-title">{group}</h2>
            {items.map((entry) => (
              <InputRow
                key={entry.key}
                entry={entry}
                onUpload={() => setUpload(entry)}
                onSave={(v) => saveValue(entry.key, v)}
                onChooseBill={() => navigate(`/p/${encodeURIComponent(projectId)}/bill`)}
              />
            ))}
          </section>
        ))}
      </div>

      {upload ? (
        <UploadDialog
          open
          projectId={projectId}
          title={`Upload ${upload.label.toLowerCase()}`}
          description={upload.upload?.hint}
          accept={upload.upload?.accept}
          target={upload.upload?.target}
          onClose={() => setUpload(null)}
          onUploaded={() => setChanged(true)}
        />
      ) : null}
      <UploadDialog open={generalUpload} projectId={projectId} onClose={() => setGeneralUpload(false)} onUploaded={() => setChanged(true)} />
    </div>
  );
}

function InputRow({
  entry,
  onUpload,
  onSave,
  onChooseBill,
}: {
  entry: InputEntry;
  onUpload: () => void;
  onSave: (value: number | null) => Promise<void>;
  onChooseBill: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(entry.manual?.value != null ? String(entry.manual.value) : entry.value != null ? String(entry.value) : "");
  const status = STATUS[entry.status];
  const where = entry.sheets.map((s) => s.stem || s.file).filter(Boolean);

  return (
    <div className={`input-row st-${entry.status}`}>
      <span className="input-icon">
        {entry.status === "missing" ? <Circle size={15} /> : entry.status === "manual" ? <PenLine size={14} /> : <Check size={14} strokeWidth={3} />}
      </span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <strong>{entry.label}</strong>
          <span className={`chip ${status.tone}`}>{status.label}</span>
          {entry.value != null ? (
            <span className="chip chip-outline tnum">
              {entry.value} {entry.manual?.unit}
            </span>
          ) : null}
        </div>
        <p className="input-meta">
          {entry.status === "missing" ? entry.missingNote : where.length ? `${where.slice(0, 3).join(", ")}${entry.sheetCount > 3 ? ` and ${entry.sheetCount - 3} more` : ""}` : entry.detail}
          {entry.detail && entry.status !== "missing" && where.length ? <span className="faint"> · {entry.detail}</span> : null}
          {entry.source && entry.status !== "missing" ? <span className="faint"> · {entry.source}</span> : null}
        </p>
        <div className="feeds">
          {entry.feeds.map((f) => (
            <span key={f} className="feed">
              {f}
            </span>
          ))}
        </div>
        {editing ? (
          <div className="row input-edit">
            <div className="input-group" style={{ width: 140 }}>
              <input
                className="input input-sm input-num"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))}
                autoFocus
                style={{ paddingRight: 34 }}
              />
              <span className="input-suffix">{entry.manual?.unit}</span>
            </div>
            <button type="button" className="btn btn-primary btn-sm" disabled={!value} onClick={async () => (await onSave(Number(value)), setEditing(false))}>
              Save
            </button>
            {entry.status === "manual" ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={async () => (await onSave(null), setEditing(false), setValue(""))}>
                Clear
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        ) : null}
      </div>
      <div className="input-actions">
        {entry.manual && !editing ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
            <PenLine size={13} /> {entry.status === "manual" ? "Change" : "Set value"}
          </button>
        ) : null}
        {entry.key === "bill" && entry.status !== "missing" ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onChooseBill}>
            Choose bill
          </button>
        ) : null}
        {entry.upload && (entry.status !== "found" || entry.key === "bill") ? (
          <button type="button" className={`btn btn-sm ${entry.status === "missing" ? "btn-secondary" : "btn-ghost"}`} onClick={onUpload}>
            <Upload size={13} /> Upload
          </button>
        ) : null}
      </div>
    </div>
  );
}
