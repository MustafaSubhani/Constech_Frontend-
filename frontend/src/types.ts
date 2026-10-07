export type Capability = { id: string; status: string; reason?: string };

export type Evidence = {
  role: "schedule" | "plan_tag" | "note" | "label" | "outline" | string;
  label: string;
  text?: string;
  box: [number, number, number, number] | null;
  sheetId: string;
};

export type Shape = {
  id: string;
  kind: string;
  label: string;
  points: [number, number][];
  dashed?: boolean;
  measurementId?: string;
  evidence?: Evidence[];
  edited?: boolean;
  enginePoints?: [number, number][];
  manual?: boolean;
  hidden?: boolean;
};

export type MeasurementSource = {
  role: string;
  sheet?: string;
  detail?: string;
};

export type ExpressionSpec = { expression: string; variables: Record<string, number> };

export type Measurement = {
  id: string;
  elementType: string;
  tag: string;
  sheet: string;
  status: string;
  confidence: string;
  quantities: Record<string, number | string | null | undefined>;
  engineQuantities?: Record<string, number | string | null | undefined> | null;
  formula: string;
  expressions?: Record<string, ExpressionSpec>;
  inputs: Record<string, unknown>;
  sources: MeasurementSource[];
  note: string;
  adjustmentReason?: string;
  manual?: boolean;
};

export type ReviewItem = {
  id: string;
  kind: string;
  severity: string;
  sheet: string;
  tag: string;
  message: string;
  measurementId?: string;
};

export type Sheet = {
  id: string;
  code: string;
  title: string;
  role: string;
  floor?: string;
  file?: string;
  pdf?: string;
  fitOk?: boolean | null;
  measurable?: boolean;
  width: number;
  height: number;
  shapes: Shape[];
  image?: string;
  signals?: string[];
};

export type BillLineSource = {
  role: string;
  file?: string;
  detail?: string;
};

export type BillPlacement = {
  measurementId: string;
  shapeId?: string;
  sheetId: string;
  sheetCode?: string;
  sourceFile: string;
  sourceRole?: string;
  tag: string;
  label?: string;
  kind?: string;
  quantity: number;
  quantityField: string;
  status?: string;
  widthMm?: number | null;
  heightMm?: number | null;
  depthMm?: number | null;
  areaM2?: number | null;
};

export type MeasureDelta = {
  delta: number;
  changes: { measurementId: string; tag: string; before: number; after: number; status: string }[];
};

export type CompareRow = {
  id: string;
  section: string;
  label: string;
  unit: string;
  digits: number;
  bill: number | null;
  ours: number | null;
  engineOurs?: number | null;
  note?: string;
  formula?: string;
  expression?: string;
  variables?: Record<string, number>;
  sources?: BillLineSource[];
  inputs?: Record<string, unknown>;
  placements?: BillPlacement[];
  measureDelta?: MeasureDelta | null;
  adjusted?: boolean;
  lineOverride?: boolean;
  adjustmentReason?: string;
  custom?: boolean;
  hidden?: boolean;
  /** Measured quantity per storey; always sums to `ours`. */
  floors?: Record<string, number>;
  /** Storey a hand-added line belongs to. */
  floor?: string;
};

export type FloorInfo = { key: string; label: string };

export type BillSource = { file: string; name: string; engineDefault: boolean; matched: number };

export type Runs = { discover: boolean; foundations: boolean; structure: boolean };

export type Project = {
  id: string;
  name: string;
  place: string;
  bill: string;
  billSource: BillSource;
  updated: string;
  runs: Runs;
  capabilities: Capability[];
  rules?: Record<string, unknown>;
  sheets: Sheet[];
  comparison: CompareRow[];
  floors?: FloorInfo[];
  measurements: Measurement[];
  reviewQueue: ReviewItem[];
  measuredSheets: number;
};

export type ProjectSummary = {
  id: string;
  name: string;
  place: string;
  bill: string;
  updated: string;
  drawings: number;
  measuredSheets: number;
  runs: Runs;
  capabilities: Capability[];
  close: number;
  near: number;
  far: number;
  compared: number;
  lines: number;
  pipelineRunning?: boolean;
};

export type StageKey = "files" | "discover" | "foundations" | "structure" | "sheets" | "compare";
export type StageStatus = "pending" | "running" | "done" | "cached" | "skipped" | "error" | "blocked";

export type PipelineStage = {
  key: StageKey;
  label: string;
  status: StageStatus;
  detail: string;
  progress: number | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  lines: string[];
};

export type PipelineJob = {
  id: string;
  projectId: string;
  status: "running" | "done" | "error";
  error: string;
  startedAt: string;
  elapsedMs: number;
  stages: PipelineStage[];
};

export type PipelineStatus = {
  job: PipelineJob | null;
  runs: Runs;
  lastRun: Partial<Record<StageKey, { status: string; detail: string; endedAt: string; durationMs: number }>>;
};

export type ProjectFile = {
  path: string;
  name: string;
  ext: string;
  kind: "drawing" | "sheet" | "bill" | "rates" | "notes" | "other";
  sizeBytes: number;
  modified: string;
};

export type InputEntry = {
  key: string;
  label: string;
  group: string;
  feeds: string[];
  status: "found" | "partial" | "missing" | "manual";
  sheets: { stem: string; file: string; role: string }[];
  sheetCount: number;
  upload: { accept: string; hint: string; target?: string } | null;
  manual: { unit: string; value?: number | null } | null;
  missingNote: string;
  detail?: string;
  value?: number | null;
  source?: string;
};

export type BillCandidate = {
  file: string;
  name: string;
  kind: "bill" | "takeoff";
  engineDefault: boolean;
  uploaded: boolean;
  sizeBytes: number;
  modified: number;
};

export type RatesDoc = {
  currency: string;
  markupPercent: number;
  rates: Record<string, number>;
  source?: string;
};

export type RateRow = { row: number; sheet: string; description: string; key: string; unit: string; rate: number };

export type RatesImport = {
  file: string;
  rows: RateRow[];
  suggestions: { key: string; rowIndex: number | null; score: number }[];
  unmatched: number[];
};

export type User = { email: string; name: string; token: string };

export type ExportItem = {
  projectId: string;
  projectName: string;
  fileName: string;
  category: string;
  ext: string;
  sizeBytes: number;
  modifiedAt: string;
  downloadUrl: string;
};

export type UploadFile = { name: string; content_base64: string };

export type AssistantProvider = "anthropic" | "openai" | "openai_compatible";

export type AssistantStatus = {
  enabled: boolean;
  provider: AssistantProvider;
  model: string;
  baseUrl: string;
  effort: "low" | "medium" | "high" | "xhigh";
  maxSteps: number;
  local: boolean;
  keySaved: boolean;
  keyAvailable: boolean;
  fromEnvironment: string[];
  problems: string[];
  configFile: string;
};

export type AssistantSettingsPatch = Partial<{
  enabled: boolean;
  provider: AssistantProvider;
  model: string;
  baseUrl: string;
  effort: string;
  maxSteps: number;
  apiKey: string;
  clearKey: boolean;
}>;

export type TranscriptItem = {
  role: "user" | "assistant" | "tool" | "notice";
  text?: string;
  name?: string;
  summary?: string;
  error?: boolean;
  proposalId?: string;
  tone?: "error" | "warn";
  at: string;
};

export type AssistantThread = { id: string; created: string; updated: string; provider: string; model: string; task: string; transcript: TranscriptItem[] };

export type ProposalImpact = { lineId: string; label: string; unit: string; before: number | null; after: number | null; bill: number | null };

export type Proposal = {
  id: string;
  threadId: string;
  kind: "measurement_change" | "exclude" | "new_element" | "bill_override" | "project_input" | "sheet_role";
  status: "pending" | "applied" | "rejected" | "undone";
  reason: string;
  summary: string;
  evidence: { sheet: string; text: string; verified: boolean; check: string }[];
  target: Record<string, string>;
  before?: number | string | null;
  after?: number | string | Record<string, number> | null;
  impacts: ProposalImpact[];
  created: string;
};
