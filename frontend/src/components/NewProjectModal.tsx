import { useState, useRef, ChangeEvent, DragEvent, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import {
  XIcon,
  UploadCloudIcon,
  FileSpreadsheetIcon,
  CheckIcon,
} from "./Icons";

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
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

export function NewProjectModal({ isOpen, onClose, onCreated }: NewProjectModalProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
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
    if (!name && newItems.length > 0) {
      // Auto-populate name if empty based on first file
      const raw = newItems[0].name.replace(/\.[^/.]+$/, "");
      setName(raw.replace(/[_-]+/g, " ").trim());
    }
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
    if (!name.trim()) {
      setError("Please enter a project name.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Encode files to base64
      const payloadFiles: { name: string; content_base64: string }[] = [];
      for (const item of files) {
        const base64 = await fileToBase64(item.file);
        payloadFiles.push({
          name: item.name,
          content_base64: base64,
        });
      }

      const created = await api.createProject(name.trim(), place.trim() || undefined, payloadFiles);
      if (onCreated) onCreated();
      onClose();
      // Navigate to created project
      navigate(`/p/${encodeURIComponent(created.id)}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create project.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-box new-project-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
      >
        <div className="modal-header">
          <div>
            <h2 id="new-project-title">Create New Takeoff Project</h2>
            <p className="modal-subtitle">
              Upload drawings (.dwg, .pdf) or BOQ spreadsheets (.xlsx) to set up your estimation workspace.
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
          <div className="form-grid-2">
            <div className="form-group">
              <label htmlFor="proj-name">
                Project Name <span className="req">*</span>
              </label>
              <input
                id="proj-name"
                type="text"
                className="input-text"
                placeholder="e.g. Marina Horizon Tower - Structure R02"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label htmlFor="proj-place">Site Location / City</label>
              <input
                id="proj-place"
                type="text"
                className="input-text"
                placeholder="e.g. Dubai, United Arab Emirates"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Drawings & Bill Files</label>
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
                  Supports CAD Drawings (.dwg, .dxf), PDFs (.pdf), and Excel BOQ (.xlsx, .csv)
                </div>
              </div>
            </div>
          </div>

          {files.length > 0 && (
            <div className="queued-files-list">
              <div className="queued-files-header">
                <span>Selected Files ({files.length})</span>
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
              disabled={submitting || !name.trim()}
            >
              {submitting ? (
                <>
                  <span className="spinner-dots" /> Uploading & Initializing...
                </>
              ) : (
                <>
                  <CheckIcon size={16} /> Create Project ({files.length} file{files.length !== 1 ? "s" : ""})
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
