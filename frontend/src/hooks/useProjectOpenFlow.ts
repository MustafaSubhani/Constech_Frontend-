import { useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../types";
import { KIND_ORDER } from "../lib/kinds";
import { REVEAL_KIND_LABELS } from "../components/flowLabels";

export type OpenPhase = "measuring" | "revealing" | "bill" | "ready";

export type ProjectOpenFlow = {
  phase: OpenPhase;
  statusLabel: string;
  progress: number | null;
  visibleShapeIds: Set<string> | null;
};

function shapesByKind(project: Project): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const sheet of project.sheets ?? []) {
    for (const shape of sheet.shapes ?? []) {
      if (!shape.id) continue;
      const list = map.get(shape.kind) ?? [];
      list.push(shape.id);
      map.set(shape.kind, list);
    }
  }
  return map;
}

function kindRevealOrder(project: Project): string[] {
  const present = shapesByKind(project);
  const order: string[] = [];
  for (const kind of KIND_ORDER) {
    if (present.has(kind)) order.push(kind);
  }
  for (const kind of present.keys()) {
    if (!KIND_ORDER.includes(kind)) order.push(kind);
  }
  return order;
}

export function useProjectOpenFlow(
  projectId: string,
  workspaceOpen: boolean,
  catalog: Project | undefined,
  catalogBusy: boolean,
): ProjectOpenFlow {
  const [phase, setPhase] = useState<OpenPhase>("measuring");
  const [statusLabel, setStatusLabel] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [visibleShapeIds, setVisibleShapeIds] = useState<Set<string> | null>(() => new Set());
  const sequenceStarted = useRef(false);

  const catalogKey = catalog ? `${projectId}:${catalog.sheets?.length}:${catalog.comparison?.length}` : "";

  useEffect(() => {
    sequenceStarted.current = false;
    setPhase("measuring");
    setStatusLabel("");
    setProgress(null);
    setVisibleShapeIds(new Set());
  }, [projectId]);

  useEffect(() => {
    if (!workspaceOpen) return;

    if (catalogBusy || !catalog) {
      setPhase("measuring");
      setStatusLabel("Reading measured outlines…");
      setProgress(null);
      setVisibleShapeIds(new Set());
      return;
    }

    if (sequenceStarted.current) return;
    sequenceStarted.current = true;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const byKind = shapesByKind(catalog);
    const kinds = kindRevealOrder(catalog);
    const allIds = kinds.flatMap((k) => byKind.get(k) ?? []);
    const billRows = catalog.comparison?.length ?? 0;

    if (reduced || (allIds.length === 0 && billRows === 0)) {
      setVisibleShapeIds(null);
      setPhase("ready");
      setStatusLabel("");
      setProgress(null);
      return;
    }

    let cancelled = false;
    const timers: number[] = [];
    const later = (ms: number, fn: () => void) => {
      timers.push(window.setTimeout(fn, ms));
    };

    const revealKind = (index: number, revealed: Set<string>) => {
      if (cancelled) return;
      if (index >= kinds.length) {
        if (billRows === 0) {
          setVisibleShapeIds(null);
          setPhase("ready");
          setStatusLabel("");
          setProgress(null);
          return;
        }
        runBill(revealed);
        return;
      }
      const kind = kinds[index]!;
      const ids = byKind.get(kind) ?? [];
      ids.forEach((id) => revealed.add(id));
      setVisibleShapeIds(new Set(revealed));
      setPhase("revealing");
      const label = REVEAL_KIND_LABELS[kind] ?? kind;
      setStatusLabel(`Locating ${label}…`);
      setProgress((index + 1) / (kinds.length + (billRows > 0 ? 1 : 0)));
      later(520, () => revealKind(index + 1, revealed));
    };

    const runBill = (revealed: Set<string>) => {
      setPhase("bill");
      setStatusLabel("Calculating bill comparison…");
      setVisibleShapeIds(new Set(revealed));
      let step = 0;
      const steps = 14;
      const tick = window.setInterval(() => {
        if (cancelled) {
          window.clearInterval(tick);
          return;
        }
        step += 1;
        setProgress(step / steps);
        if (step >= steps) {
          window.clearInterval(tick);
          setVisibleShapeIds(null);
          setPhase("ready");
          setStatusLabel("");
          setProgress(null);
        }
      }, 70);
      timers.push(tick);
    };

    setPhase("revealing");
    setStatusLabel("Preparing plan sheets…");
    setProgress(0);
    setVisibleShapeIds(new Set());
    later(400, () => revealKind(0, new Set()));

    return () => {
      cancelled = true;
      timers.forEach((t) => {
        window.clearTimeout(t);
        window.clearInterval(t);
      });
    };
  }, [workspaceOpen, catalogBusy, catalog, catalogKey]);

  return useMemo(
    () => ({
      phase,
      statusLabel,
      progress,
      visibleShapeIds: phase === "ready" ? null : visibleShapeIds,
    }),
    [phase, statusLabel, progress, visibleShapeIds],
  );
}
