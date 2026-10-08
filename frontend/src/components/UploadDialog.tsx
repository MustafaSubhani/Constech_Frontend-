import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { ACCEPT_PROJECT, toUploads } from "../lib/files";
import { Dialog } from "./ui/Dialog";
import { Dropzone, FileList } from "./ui/Dropzone";
import { useToast } from "./ui/Toast";

type Props = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  title?: string;
  description?: string;
  accept?: string;
  target?: string;
  hint?: string;
  onUploaded?: (saved: string[]) => void;
};

export function UploadDialog({ open, onClose, projectId, title, description, accept = ACCEPT_PROJECT, target, hint, onUploaded }: Props) {
  const qc = useQueryClient();
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setFiles([]);
      setError("");
    }
  }, [open]);

  async function submit() {
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.uploadFiles(projectId, await toUploads(files), target);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["project", projectId] }),
        qc.invalidateQueries({ queryKey: ["inputs", projectId] }),
        qc.invalidateQueries({ queryKey: ["bills", projectId] }),
        qc.invalidateQueries({ queryKey: ["projects"] }),
        qc.invalidateQueries({ queryKey: ["files", projectId] }),
        qc.invalidateQueries({ queryKey: ["exports"] }),
      ]);
      toast.success(`${result.saved.length} file${result.saved.length === 1 ? "" : "s"} added`);
      onUploaded?.(result.saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title={title ?? "Add files"}
      description={description ?? "Drawings go to dwg/ and pdf/, spreadsheets and notes to the project folder."}
      footer={
        <>
          <span className="grow">{files.length ? `${files.length} selected` : ""}</span>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !files.length}>
            {busy ? <span className="spinner" /> : null}
            {busy ? "Uploading" : "Upload"}
          </button>
        </>
      }
    >
      {error ? <div className="banner banner-bad">{error}</div> : null}
      <Dropzone
        accept={accept}
        hint={hint}
        onFiles={(list) => setFiles((prev) => [...prev, ...list])}
        onReject={(names) => setError(`Not supported here: ${names.join(", ")}`)}
      />
      <FileList files={files} onRemove={(i) => setFiles((prev) => prev.filter((_, j) => j !== i))} />
    </Dialog>
  );
}
