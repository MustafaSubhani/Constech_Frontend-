export type Capability = { id: string; status: string; reason?: string };

export type Shape = {
  id: string;
  kind: string;
  label: string;
  points: [number, number][];
  dashed?: boolean;
  measurementId?: string;
};

export type MeasurementSource = {
  role: string;
  sheet?: string;
  detail?: string;
};

export type Measurement = {
  id: string;
  elementType: string;
  tag: string;
  sheet: string;
  status: string;
  confidence: string;
  quantities: Record<string, number | null | undefined>;
  formula: string;
  inputs: Record<string, unknown>;
  sources: MeasurementSource[];
  note: string;
  adjustmentReason?: string;
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
  widthMm?: number | null;
  heightMm?: number | null;
  depthMm?: number | null;
  areaM2?: number | null;
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
  sources?: BillLineSource[];
  inputs?: Record<string, unknown>;
  placements?: BillPlacement[];
  adjusted?: boolean;
  adjustmentReason?: string;
};

export type Project = {
  id: string;
  name: string;
  place: string;
  bill: string;
  updated: string;
  runs: Record<string, boolean>;
  capabilities: Capability[];
  sheets: Sheet[];
  comparison: CompareRow[];
  measurements?: Measurement[];
  reviewQueue?: ReviewItem[];
};

export type ProjectSummary = {
  id: string;
  name: string;
  place: string;
  bill: string;
  updated: string;
  drawings: number;
  measuredSheets: number;
  runs: Record<string, boolean>;
  capabilities: Capability[];
  close: number;
  near: number;
  far: number;
  compared: number;
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

export type AppSettings = {
  currency: string;
  defaultMarkupPercent: number;
  unitSystem: "metric" | "imperial";
  decimalPlaces: number;
};
