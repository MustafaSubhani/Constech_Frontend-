import { Layers } from "lucide-react";
import type { FloorInfo } from "../types";
import type { Scope } from "../lib/floors";

type Props = { value: Scope; floors: FloorInfo[]; onChange: (scope: Scope) => void };

/** Whole project, every floor side by side, or a single floor. */
export function ScopeSelect({ value, floors, onChange }: Props) {
  const named = floors.filter((f) => f.key !== "unsplit");
  return (
    <label className="scope-select" title="Show quantities for the whole project, side by side per floor, or for one floor">
      <Layers size={14} />
      <select className="select input-sm" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Scope">
        <option value="project">Whole project</option>
        {floors.length ? <option value="floors">By floor, side by side</option> : null}
        {named.length ? (
          <optgroup label="One floor">
            {named.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </label>
  );
}
