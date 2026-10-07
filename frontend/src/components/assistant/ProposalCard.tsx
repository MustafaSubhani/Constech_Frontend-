import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, RotateCcw, X } from "lucide-react";
import { api } from "../../api/client";
import type { Proposal } from "../../types";
import { fmt } from "../../lib/format";
import { useToast } from "../ui/Toast";

const KIND_LABEL: Record<Proposal["kind"], string> = {
  measurement_change: "Element quantity",
  exclude: "Remove element",
  new_element: "New element",
  bill_override: "Bill line override",
  project_input: "Project input",
  sheet_role: "Sheet role",
};

function value(v: unknown) {
  if (v == null || v === "") return "none";
  if (typeof v === "number") return fmt(v, Math.abs(v) >= 100 ? 1 : 3);
  if (typeof v === "object") return Object.entries(v as Record<string, number>).map(([k, n]) => `${k.replace(/_/g, " ")} ${fmt(n, 3)}`).join(", ");
  return String(v);
}

/** One proposed change: what changes, its effect on the bill, the evidence, and accept / reject / undo. */
export function ProposalCard({ proposal, projectId, compact = false }: { proposal: Proposal; projectId: string; compact?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const unverified = proposal.evidence.some((e) => !e.verified) || proposal.evidence.length === 0;

  async function act(action: "apply" | "reject" | "undo") {
    setBusy(true);
    try {
      await api.proposalAction(projectId, proposal.id, action);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["proposals", projectId] }),
        qc.invalidateQueries({ queryKey: ["project", projectId] }),
        qc.invalidateQueries({ queryKey: ["inputs", projectId] }),
      ]);
      toast.show(action === "apply" ? "Change applied" : action === "undo" ? "Change undone" : "Proposal rejected", "success");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`proposal st-${proposal.status}${compact ? " compact" : ""}`}>
      <div className="proposal-head">
        <span className="proposal-kind">{KIND_LABEL[proposal.kind]}</span>
        {proposal.status === "applied" ? (
          <>
            <span className="chip chip-ok">Applied</span>
            <button type="button" className="btn btn-ghost btn-icon btn-sm undo" title="Undo" aria-label="Undo this change" onClick={() => act("undo")} disabled={busy}>
              <RotateCcw size={13} />
            </button>
          </>
        ) : proposal.status === "rejected" ? (
          <span className="chip chip-outline">Rejected</span>
        ) : proposal.status === "undone" ? (
          <span className="chip chip-outline">Undone</span>
        ) : null}
      </div>
      <p className="proposal-summary">{proposal.summary}</p>
      {proposal.before !== undefined && proposal.after !== undefined && proposal.kind !== "sheet_role" ? (
        <div className="proposal-diff">
          <span className="was">{value(proposal.before)}</span>
          <ArrowRight size={13} />
          <span className="now">{value(proposal.after)}</span>
        </div>
      ) : null}
      {proposal.impacts.length && !compact ? (
        <div className="proposal-impacts">
          {proposal.impacts.map((i) => (
            <div key={i.lineId} className="impact">
              <span className="truncate">{i.label}</span>
              <span className="tnum muted">{fmt(i.before, 2)}</span>
              <ArrowRight size={11} />
              <span className="tnum">{fmt(i.after, 2)}</span>
              <span className="unit muted">{i.unit}</span>
            </div>
          ))}
        </div>
      ) : null}
      <p className="proposal-reason">{proposal.reason}</p>
      <ul className="proposal-evidence">
        {proposal.evidence.map((e, i) => (
          <li key={i} className={e.verified ? "ok" : "warn"} title={e.check}>
            {e.verified ? <Check size={12} strokeWidth={3} /> : <AlertTriangle size={12} />}
            <span className="truncate">
              <strong>{e.sheet}</strong> {e.text}
            </span>
          </li>
        ))}
        {!proposal.evidence.length ? (
          <li className="warn">
            <AlertTriangle size={12} /> No evidence given
          </li>
        ) : null}
      </ul>
      {unverified && proposal.status === "pending" ? <p className="proposal-warning">Some cited text was not found on the drawings. Check before accepting.</p> : null}
      {proposal.status === "pending" ? (
        <div className="proposal-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => act("reject")} disabled={busy}>
            <X size={13} /> Reject
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => act("apply")} disabled={busy}>
            {busy ? <span className="spinner" /> : <Check size={13} />} Accept
          </button>
        </div>
      ) : null}
    </div>
  );
}
