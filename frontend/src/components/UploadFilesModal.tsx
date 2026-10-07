import { useState, useRef, ChangeEvent, DragEvent, FormEvent } from "react";
import { api } from "../api/client";
import { XIcon, UploadCloudIcon, CheckIcon } from "./Icons";

interface UploadFilesModalProps {
  projectId: string;
  projectName: string;
  isOpen: boolean;
  onClose: () => void;
  onUploaded?: () => void;
}

interface UploadQueueFile {
  file: File;
  name: string;
  size: number;
  ext: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      const base64 = res.includes(",") ? res.split(",")[1] : res;
      resolve(base64);
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

export function UploadFilesModal({
  projectId,
  projectName,
  isOpen,
  onClose,
  onUploaded,
}: UploadFilesModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<UploadQueueFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileSelect = (selected: FileList | null) => {
    if (!selected) return;
    const newItems: UploadQueueFile[] = [];
    for (let i = 0; i < selected.length; i++) {
      const f = selected[i];
      const ext = f.name.split(".").pop()?.toLowerCase() || "";
      newItems.push({
        file: f,
        name: f.name,
        size: f.size,
        ext,
      });
    }
    setFiles((prev) => [...prev, ...newItems]);
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (files.length === 0) {
      setError("Please select at least one file to upload.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const payloadFiles: { name: string; content_base64: string }[] = [];
      for (const item of files) {
        const base64 = await fileToBase64(item.file);
        payloadFiles.push({
          name: item.name,
          content_base64: base64,
        });
      }

      await api.uploadFiles(projectId, payloadFiles);
      if (onUploaded) onUploaded();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to upload files.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-box upload-files-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-files-title"
      >
        <div className="modal-header">
          <div>
            <h2 id="upload-files-title">Upload Drawings to {projectName}</h2>
            <p className="modal-subtitle">
              Add extra CAD plans (.dwg, .dxf), PDF sheets, or revised BOQ spreadsheets.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon-only"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <XIcon size={18} />
          </button>
        </div>

        {error && (
          <div className="alert-banner alert-banner-error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <div
              className={`dropzone ${isDragging ? "dropzone-active" : ""}`}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".dwg,.dxf,.pdf,.png,.xlsx,.xls,.csv"
                style={{ display: "none" }}
                onChange={(e: ChangeEvent<HTMLInputElement>) => handleFileSelect(e.target.files)}
              />
              <div className="dropzone-inner">
                <div className="dropzone-icon">
                  <UploadCloudIcon size={32} />
                </div>
                <div className="dropzone-text">
                  <strong>Click to browse</strong> or drag & drop files here
                </div>
                <div className="dropzone-hint">
                  Saved directly into project directory structure (dwg/ / pdf/ / root)
                </div>
              </div>
            </div>
          </div>

          {files.length > 0 && (
            <div className="queued-files-list">
              <div className="queued-files-header">
                <span>Files to upload ({files.length})</span>
                <button
                  type="button"
                  className="btn-link-sm"
                  onClick={() => setFiles([])}
                >
                  Clear all
                </button>
              </div>
              <div className="file-chips-grid">
                {files.map((f, i) => (
                  <div className="file-chip" key={`${f.name}-${i}`}>
                    <span className={`chip-ext chip-ext-${f.ext}`}>
                      {f.ext.toUpperCase()}
                    </span>
                    <div className="chip-details" title={f.name}>
                      <span className="chip-name">{f.name}</span>
                      <span className="chip-size">{formatBytes(f.size)}</span>
                    </div>
                    <button
                      type="button"
                      className="chip-remove-btn"
                      onClick={() => removeFile(i)}
                      aria-label={`Remove ${f.name}`}
                    >
                      <XIcon size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || files.length === 0}
            >
              {submitting ? (
                <>
                  <span className="spinner-dots" /> Uploading...
                </>
              ) : (
                <>
                  <CheckIcon size={16} /> Upload {files.length} File{files.length !== 1 ? "s" : ""}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
