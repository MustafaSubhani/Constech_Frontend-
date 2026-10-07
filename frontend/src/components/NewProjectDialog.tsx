import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { ACCEPT_PROJECT, toUploads } from "../lib/files";
import { Dialog } from "./ui/Dialog";
import { Dropzone, FileList } from "./ui/Dropzone";

function nameFromFile(name: string) {
  return name.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setPlace("");
      setFiles([]);
      setError("");
    }
  }, [open]);

  async function create() {
    if (!name.trim()) {
      setError("Give the project a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await api.createProject(name.trim(), place.trim(), await toUploads(files));
      await qc.invalidateQueries({ queryKey: ["projects"] });
      onClose();
      navigate(`/p/${encodeURIComponent(created.id)}`, { state: { fresh: true } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the project.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title="New project"
      description="Add the drawing set now or later. The pipeline runs as soon as the project opens."
      size="lg"
      footer={
        <>
          <span className="grow">{files.length ? `${files.length} file${files.length === 1 ? "" : "s"} ready` : "No files yet"}</span>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={create} disabled={busy || !name.trim()}>
            {busy ? <span className="spinner" /> : null}
            {busy ? "Creating" : "Create and open"}
          </button>
        </>
      }
    >
      {error ? <div className="banner banner-bad">{error}</div> : null}
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Project name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Marina Tower, structure" data-autofocus />
        </label>
        <label className="field">
          <span className="field-label">Location</span>
          <input className="input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Optional" />
        </label>
      </div>
      <Dropzone
        accept={ACCEPT_PROJECT}
        title="Drop drawings, bills and notes"
        hint="DWG, PDF, XLSX, CSV, TXT"
        onFiles={(list) => {
          setFiles((prev) => [...prev, ...list]);
          if (!name && list[0]) setName(nameFromFile(list[0].name));
        }}
        onReject={(names) => setError(`Not supported: ${names.join(", ")}`)}
      />
      <FileList files={files} onRemove={(i) => setFiles((prev) => prev.filter((_, j) => j !== i))} />
    </Dialog>
  );
}
