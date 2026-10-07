import { useRef, useState, type ReactNode } from "react";
import { Upload, X } from "lucide-react";
import { acceptsFile, describeFile, extOf } from "../../lib/files";
import { formatBytes } from "../../lib/format";

type Props = {
  accept: string;
  multiple?: boolean;
  title?: ReactNode;
  hint?: ReactNode;
  onFiles: (files: File[]) => void;
  onReject?: (names: string[]) => void;
  large?: boolean;
};

export function Dropzone({ accept, multiple = true, title, hint, onFiles, onReject, large }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);

  function take(list: FileList | null) {
    if (!list?.length) return;
    const all = [...list];
    const ok = all.filter((f) => acceptsFile(f.name, accept));
    const rejected = all.filter((f) => !acceptsFile(f.name, accept)).map((f) => f.name);
    if (rejected.length) onReject?.(rejected);
    if (ok.length) onFiles(multiple ? ok : ok.slice(0, 1));
  }

  return (
    <div
      className={`dropzone${active ? " active" : ""}`}
      style={large ? { padding: "48px 24px" } : undefined}
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), input.current?.click())}
      onDragOver={(e) => {
        e.preventDefault();
        setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setActive(false);
        take(e.dataTransfer.files);
      }}
    >
      <input
        ref={input}
        type="file"
        hidden
        multiple={multiple}
        accept={accept}
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
      <span className="dz-icon">
        <Upload size={18} />
      </span>
      <div>
        <strong>{title ?? "Drop files here"}</strong> <span className="muted">or browse</span>
      </div>
      <div className="dz-hint">{hint ?? accept.replace(/\./g, "").toUpperCase().split(",").join(", ")}</div>
    </div>
  );
}

export function FileList({ files, onRemove }: { files: File[]; onRemove?: (index: number) => void }) {
  if (!files.length) return null;
  return (
    <div className="file-list">
      {files.map((f, i) => {
        const ext = extOf(f.name);
        return (
          <div className="file-row" key={`${f.name}-${i}`}>
            <span className={`file-ext x-${ext}`}>{ext.toUpperCase()}</span>
            <div className="grow">
              <div className="file-name truncate">{f.name}</div>
              <div className="file-meta">
                {describeFile(f.name)} · {formatBytes(f.size)}
              </div>
            </div>
            {onRemove ? (
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove ${f.name}`} onClick={() => onRemove(i)}>
                <X size={14} />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
