/**
 * Contract for the agentic assistant (not connected yet).
 * Mirrors backend/structural_boq/agent.py. The assistant only proposes; the QS applies
 * a proposal through the same endpoints the UI uses for manual edits.
 */
export type AssistantIntent =
  | "ask"
  | "explain_line"
  | "propose_measurement"
  | "adjust_formula"
  | "find_source"
  | "parse_notes";

export type AssistantRequest = {
  intent: AssistantIntent;
  prompt: string;
  context?: {
    sheetId?: string;
    measurementId?: string;
    lineId?: string;
  };
};

export type AssistantCitation = { file: string; sheetId?: string; box?: [number, number, number, number]; text?: string };

export type AssistantProposal = {
  kind: "measurement_override" | "manual_element" | "bill_line_override" | "project_input";
  summary: string;
  patch: Record<string, unknown>;
  citations: AssistantCitation[];
};

export type AssistantReply = { message: string; proposals: AssistantProposal[] };

export const SUGGESTED_PROMPTS: { intent: AssistantIntent; text: string }[] = [
  { intent: "explain_line", text: "Why is footing concrete 0.3% over the bill?" },
  { intent: "find_source", text: "Where does the depth of F3 come from?" },
  { intent: "adjust_formula", text: "Use 75 mm cover for all footing steel" },
  { intent: "parse_notes", text: "Read the general notes and set blinding and cover" },
];
