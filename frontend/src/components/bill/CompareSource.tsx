import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, FileSpreadsheet, Upload } from "lucide-react";
import { api } from "../../api/client";
import type { BillSource } from "../../types";
import { relativeTime } from "../../lib/format";
import { Menu } from "../ui/Menu";
import { useToast } from "../ui/Toast";
import { UploadDialog } from "../UploadDialog";

export function CompareSource({ projectId, source }: { projectId: string; source: BillSource }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const bills = useQuery({ queryKey: ["bills", projectId], queryFn: () => api.getBills(projectId) });

  async function choose(file: string) {
    setBusy(true);
    try {
      await api.selectBill(projectId, file);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["project", projectId] }),
        qc.invalidateQueries({ queryKey: ["bills", projectId] }),
        qc.invalidateQueries({ queryKey: ["projects"] }),
      ]);
      toast.success("Comparison updated");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Menu
        align="left"
        width={360}
        trigger={({ toggle }) => (
          <button type="button" className="source-trigger" onClick={toggle} disabled={busy}>
            <FileSpreadsheet size={14} />
            <span className="muted">Compared against</span>
            <strong className="truncate">{source.name || "no bill"}</strong>
            {busy ? <span className="spinner" /> : <ChevronDown size={14} />}
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="menu-label">Bills in this project</div>
            {(bills.data?.candidates ?? []).map((b) => (
              <button
                key={b.file}
                type="button"
                role="menuitemradio"
                aria-checked={b.file === source.file}
                className="menu-item"
                onClick={() => {
                  close();
                  if (b.file !== source.file) void choose(b.file);
                }}
              >
                {b.file === source.file ? <Check size={15} /> : <FileSpreadsheet size={15} />}
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="truncate" style={{ display: "block" }}>{b.name}</span>
                  <span className="muted small">
                    {b.kind === "takeoff" ? "Takeoff workbook" : "Bill"}
                    {b.engineDefault ? " · engine default" : ""}
                    {b.uploaded ? ` · uploaded ${relativeTime(b.modified)}` : ""}
                  </span>
                </span>
              </button>
            ))}
            {!bills.data?.candidates.length ? <div className="menu-item muted">No bill files found</div> : null}
            <div className="menu-sep" />
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                close();
                setUploadOpen(true);
              }}
            >
              <Upload size={15} /> Upload a bill (.xlsx or .csv)
            </button>
          </>
        )}
      </Menu>
      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        projectId={projectId}
        title="Upload a bill to compare against"
        description="Needs a header row with Description and Quantity, or an Item column with the line keys. It becomes the active comparison."
        accept=".xlsx,.csv"
        hint="XLSX or CSV"
        target="bills"
      />
    </>
  );
}
