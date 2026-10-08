import { ChevronDown, Download, FileSpreadsheet, FileText, Table2 } from "lucide-react";
import { api, type ExportFormat, type ExportKind, type ExportView } from "../api/client";
import { downloadFile } from "../lib/files";
import { Menu } from "./ui/Menu";
import { useToast } from "./ui/Toast";

const FORMATS: { format: ExportFormat; label: string; icon: typeof FileText }[] = [
  { format: "xlsx", label: "Excel workbook", icon: FileSpreadsheet },
  { format: "csv", label: "CSV", icon: Table2 },
  { format: "pdf", label: "PDF", icon: FileText },
];

type Props = {
  projectId: string;
  kinds?: ExportKind[];
  disabled?: boolean;
  label?: string;
  beforeExport?: () => Promise<void> | void;
  /** Scope and order to export, matching what is on screen. */
  view?: ExportView;
  /** Plain description of that view, shown in the menu. */
  viewLabel?: string;
};

export function ExportMenu({ projectId, kinds = ["bill", "rates"], disabled, label = "Export", beforeExport, view, viewLabel }: Props) {
  const toast = useToast();
  return (
    <Menu
      width={240}
      trigger={({ toggle }) => (
        <button type="button" className="btn btn-secondary btn-sm" onClick={toggle} disabled={disabled}>
          <Download size={14} /> {label} <ChevronDown size={14} />
        </button>
      )}
    >
      {(close) =>
        kinds.map((kind, i) => (
          <div key={kind}>
            {i > 0 ? <div className="menu-sep" /> : null}
            <div className="menu-label">{kind === "bill" ? "Bill comparison" : "Rates and estimate"}</div>
            {viewLabel ? <div className="menu-note">{viewLabel}</div> : null}
            {FORMATS.map(({ format, label: text, icon: Icon }) => (
              <button
                key={format}
                type="button"
                className="menu-item"
                onClick={async () => {
                  close();
                  try {
                    await beforeExport?.();
                    const name = await downloadFile(api.exportUrl(projectId, kind, format, view));
                    toast.success(`Downloaded ${name}`);
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                }}
              >
                <Icon size={15} /> {text}
                <span className="menu-meta">.{format}</span>
              </button>
            ))}
          </div>
        ))
      }
    </Menu>
  );
}
