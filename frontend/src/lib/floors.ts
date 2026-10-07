import { useEffect, useState } from "react";
import type { CompareRow, FloorInfo, Project } from "../types";

/** "project" for whole-project totals, "floors" for one column per floor, or a single floor key. */
export type Scope = string;

export const UNSPLIT = "unsplit";

export const UNSPLIT_HINT =
  "Quantity in the line total that the element records do not place on a floor, for example a slab steel total or a hand override. It is shown, not spread.";

export function projectFloors(project: Project): FloorInfo[] {
  return project.floors ?? [];
}

export function floorQty(row: CompareRow, floor: string): number | null {
  const value = row.floors?.[floor];
  return value == null || value === 0 ? null : value;
}

export function scopeLabel(scope: Scope, floors: FloorInfo[]): string {
  if (scope === "project") return "Whole project";
  if (scope === "floors") return "By floor";
  return floors.find((f) => f.key === scope)?.label ?? "Whole project";
}

const storageKey = (projectId: string) => `constech.scope.${projectId}`;

/** Scope shared by the bill and rates pages of one project, remembered in this browser. */
export function useScope(projectId: string, floors: FloorInfo[]): [Scope, (scope: Scope) => void] {
  const valid = (s: string | null): s is Scope =>
    s === "project" || (s === "floors" && floors.length > 0) || (!!s && floors.some((f) => f.key === s));
  const [scope, setScope] = useState<Scope>(() => {
    try {
      const saved = localStorage.getItem(storageKey(projectId));
      return valid(saved) ? saved : "project";
    } catch {
      return "project";
    }
  });
  useEffect(() => {
    if (!valid(scope)) setScope("project");
  });
  const update = (next: Scope) => {
    setScope(next);
    try {
      localStorage.setItem(storageKey(projectId), next);
    } catch {
      /* the choice still applies for this visit */
    }
  };
  return [valid(scope) ? scope : "project", update];
}
