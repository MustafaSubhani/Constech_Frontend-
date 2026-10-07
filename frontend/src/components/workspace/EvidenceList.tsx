import { FileText, Crosshair } from "lucide-react";
import type { Evidence, Sheet } from "../../types";
import { EvidenceCrop } from "./EvidenceCrop";

const ROLE_ORDER = ["schedule", "note", "label", "plan_tag", "outline"];
type Box = [number, number, number, number];

type Props = {
  evidence: Evidence[];
  sheet: Sheet;
  imageUrl: string;
  onFocus?: (box: Box) => void;
  limit?: number;
};

/** Where each value was read: the file, the sheet, and a crop of that exact area. */
export function EvidenceList({ evidence, sheet, imageUrl, onFocus, limit = 4 }: Props) {
  const sorted = [...evidence].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)).slice(0, limit);
  if (!sorted.length) return <p className="muted small">No source position was recorded for this outline.</p>;
  return (
    <div className="evidence-list">
      {sorted.map((ev, i) => {
        const box = ev.box;
        return (
          <figure className="evidence" key={`${ev.role}-${i}`}>
            <figcaption>
              <span className="evi-label">{ev.label}</span>
              {onFocus && box ? (
                <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => onFocus(box)} aria-label="Show on the sheet" title="Show on the sheet">
                  <Crosshair size={13} />
                </button>
              ) : null}
            </figcaption>
            {box ? (
              <EvidenceCrop imageUrl={imageUrl} sheetWidth={sheet.width} sheetHeight={sheet.height} box={box} onClick={onFocus ? () => onFocus(box) : undefined} />
            ) : (
              <p className="muted small">Read from the drawing data; its position on the printed sheet could not be confirmed.</p>
            )}
            {ev.text ? <code className="evi-text">{ev.text}</code> : null}
            <span className="evi-file">
              <FileText size={12} /> {sheet.pdf || `${sheet.id}.pdf`}
              {sheet.file ? <span className="faint"> · from {sheet.file}</span> : null}
            </span>
          </figure>
        );
      })}
    </div>
  );
}
