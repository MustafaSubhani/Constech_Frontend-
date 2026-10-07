import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ClipboardList, Layers, ScanLine } from "lucide-react";
import { api } from "../api/client";
import { ACCEPT_PROJECT, describeFile, toUploads } from "../lib/files";
import { Dropzone, FileList } from "../components/ui/Dropzone";

const STEPS = [
  { icon: ScanLine, title: "Read", text: "The sheet is indexed and classified: plan, schedule, notes or bill." },
  { icon: Layers, title: "Measure", text: "Elements the engine can recognise are measured and drawn on the sheet." },
  { icon: ClipboardList, title: "Fill the gaps", text: "Anything missing, like a schedule or a cover note, is listed for you to upload or set." },
];

export function QuickTakeoffPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function launch() {
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      const created = await api.createProject(name.trim() || files[0]!.name.replace(/\.[^/.]+$/, ""), "", await toUploads(files));
      await qc.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/p/${encodeURIComponent(created.id)}`, { state: { fresh: true } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the takeoff.");
      setBusy(false);
    }
  }

  const primary = files[0];

  return (
    <div className="page-scroll">
      <div className="page-wrap page quick">
        <header className="page-head">
          <div className="titles">
            <h1>Quick takeoff</h1>
            <p>Measure one sheet without setting up a full project. You can add more files later.</p>
          </div>
        </header>

        <div className="quick-grid">
          <section className="card quick-main">
            {error ? <div className="banner banner-bad">{error}</div> : null}
            {!files.length ? (
              <Dropzone
                large
                multiple={false}
                accept={ACCEPT_PROJECT}
                title="Drop a drawing or PDF sheet"
                hint="DWG or searchable PDF works best. A bill or notes file also works on its own."
                onFiles={(list) => {
                  setFiles(list);
                  setName(list[0]!.name.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").trim());
                }}
                onReject={(names) => setError(`Not supported: ${names.join(", ")}`)}
              />
            ) : (
              <div className="stack" style={{ gap: 16 }}>
                <FileList files={files} onRemove={() => setFiles([])} />
                {primary ? (
                  <p className="muted small">
                    {describeFile(primary.name)}.{" "}
                    {/\.(dwg|dxf|pdf)$/i.test(primary.name)
                      ? "It will be discovered and measured, then you will see what is still needed."
                      : "Without a drawing nothing can be measured yet; the file is kept for comparison."}
                  </p>
                ) : null}
                <label className="field">
                  <span className="field-label">Name</span>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setFiles([])} disabled={busy}>
                    Choose another file
                  </button>
                  <button type="button" className="btn btn-primary" onClick={launch} disabled={busy}>
                    {busy ? <span className="spinner" /> : null}
                    {busy ? "Uploading" : "Start takeoff"}
                    {!busy ? <ArrowRight size={16} /> : null}
                  </button>
                </div>
              </div>
            )}
          </section>

          <ol className="quick-steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className="enter" style={{ ["--delay" as string]: `${i * 60}ms` }}>
                <span className="qs-icon">
                  <s.icon size={16} />
                </span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
