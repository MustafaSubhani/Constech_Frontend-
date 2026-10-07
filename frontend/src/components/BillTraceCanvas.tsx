import { useMemo } from "react";
import type { BillPlacement, Project, Sheet } from "../types";
import { SheetCanvas } from "./SheetCanvas";

type Props = {
  project: Project;
  sheet: Sheet | undefined;
  placements: BillPlacement[];
  focusPlacement: BillPlacement | null;
  onSelectShape: (shapeId: string) => void;
};

export function BillTraceCanvas({ project, sheet, placements, focusPlacement, onSelectShape }: Props) {
  const highlightShapeIds = useMemo(() => {
    if (!sheet) return null;
    const ids = new Set<string>();
    for (const p of placements) {
      if (p.sheetId === sheet.id && p.shapeId) ids.add(p.shapeId);
    }
    return ids.size ? ids : null;
  }, [placements, sheet]);

  const traceFocusShapeId = focusPlacement?.shapeId || null;

  if (!sheet) {
    return (
      <div className="bill-trace-canvas empty">
        <p>No drawing sheet linked to this line yet. Run Foundations/Structure with catalog loaded.</p>
      </div>
    );
  }

  if (!sheet.shapes?.length && !sheet.image) {
    return (
      <div className="bill-trace-canvas empty">
        <p>
          Source file <strong>{focusPlacement?.sourceFile || placements[0]?.sourceFile || sheet.title}</strong>
        </p>
      </div>
    );
  }

  return (
    <div className="bill-trace-canvas">
      <SheetCanvas
        project={project}
        sheet={sheet}
        filter="all"
        selected={traceFocusShapeId}
        panelOpen={false}
        highlightShapeIds={highlightShapeIds}
        traceFocusShapeId={traceFocusShapeId}
        compact
        onTogglePanel={() => {}}
        onSelect={(id) => {
          if (id) onSelectShape(id);
        }}
      />
    </div>
  );
}
