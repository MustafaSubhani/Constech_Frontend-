import type {
  Account,
  AssistantSettingsPatch,
  AssistantStatus,
  AssistantThread,
  Proposal,
  BillCandidate,
  CompareRow,
  ExportItem,
  ExpressionSpec,
  InputEntry,
  PipelineJob,
  PipelineStatus,
  Project,
  ProjectFile,
  ProjectSummary,
  RatesDoc,
  RatesImport,
  StageKey,
  ThreadSummary,
  UsageSummary,
  UploadFile,
  User,
} from "../types";

const SESSION = "constech.takeoff.session";

function session(): User | null {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION) || "null");
  } catch {
    return null;
  }
}

const sessionListeners = new Set<() => void>();

function storeSession(user: User | null) {
  try {
    if (user) sessionStorage.setItem(SESSION, JSON.stringify(user));
    else sessionStorage.removeItem(SESSION);
  } catch {
    /* storage unavailable */
  }
  sessionListeners.forEach((l) => l());
}

function headers(): HeadersInit {
  const user = session();
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (user?.token) h.Authorization = `Bearer ${user.token}`;
  return h;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...options, headers: { ...headers(), ...options?.headers } });
  } catch {
    throw new ApiError(0, "Cannot reach the takeoff server. Check that it is running.");
  }
  if (response.status === 401 && !path.startsWith("/api/auth/") && !path.startsWith("/api/account")) {
    // The session ended (signed out elsewhere, password changed, or a session from before accounts).
    storeSession(null);
    if (!window.location.pathname.startsWith("/login")) window.location.assign("/login");
    throw new ApiError(401, "Your session has ended. Sign in again.");
  }
  if (!response.ok) {
    let message = "The server could not complete that request.";
    try {
      const body = await response.json();
      if (body?.message) message = body.message;
    } catch {
      /* keep fallback */
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

const post = <T>(path: string, body: unknown = {}) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });

const p = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export type ExportKind = "bill" | "rates";
export type ExportFormat = "csv" | "xlsx" | "pdf";
/** What the user is looking at: the scope (project, all floors or one floor) and the column order. */
export type ExportView = { scope?: string; sort?: string; dir?: "asc" | "desc" };

export const api = {
  session,
  async login(email: string, password: string): Promise<User> {
    const payload = await post<{ token: string; user: { email: string; name: string; hasPassword?: boolean } }>("/api/auth/login", {
      email,
      password,
    });
    const user: User = { ...payload.user, token: payload.token };
    storeSession(user);
    return user;
  },
  async logout(): Promise<void> {
    try {
      await post("/api/auth/logout");
    } catch {
      /* the local session is cleared either way */
    }
    storeSession(null);
  },
  onSession(listener: () => void) {
    sessionListeners.add(listener);
    return () => {
      sessionListeners.delete(listener);
    };
  },
  account: () => request<Account>("/api/account"),
  async updateAccount(name: string): Promise<Account> {
    const account = await post<Account>("/api/account", { name });
    const current = session();
    if (current) storeSession({ ...current, name: account.name, hasPassword: account.hasPassword });
    return account;
  },
  async changePassword(currentPassword: string, newPassword: string): Promise<Account> {
    const account = await post<Account>("/api/account/password", { currentPassword, newPassword });
    const current = session();
    if (current) storeSession({ ...current, hasPassword: true });
    return account;
  },

  listProjects: () => request<ProjectSummary[]>("/api/projects"),
  getProject: (id: string) => request<Project>(p(id)),
  getProjectSummary: (id: string) => request<Project>(`${p(id)}?catalog=0`),
  createProject: (name: string, place: string, files: UploadFile[]) =>
    post<ProjectSummary & { saved: string[] }>("/api/projects", { name, place, files }),
  uploadFiles: (id: string, files: UploadFile[], target?: string) =>
    post<{ saved: string[] }>(`${p(id)}/upload`, { files, target }),
  listFiles: (id: string) => request<ProjectFile[]>(`${p(id)}/files`),
  listExports: () => request<ExportItem[]>("/api/exports"),

  pipelineStatus: (id: string) => request<PipelineStatus>(`${p(id)}/pipeline`),
  startPipeline: (
    id: string,
    body: { mode: "open" | "run"; stages?: StageKey[]; autorun?: boolean; discovery?: string },
  ) => post<PipelineJob>(`${p(id)}/pipeline`, body),

  getInputs: (id: string) => request<{ discovered: boolean; entries: InputEntry[] }>(`${p(id)}/inputs`),
  saveInputs: (id: string, values: Record<string, number | null>) => post(`${p(id)}/inputs`, { values }),

  getBills: (id: string) => request<{ selected: string; candidates: BillCandidate[] }>(`${p(id)}/bills`),
  selectBill: (id: string, file: string) => post<{ selected: string }>(`${p(id)}/bills/select`, { file }),

  addManualMeasurement: (
    id: string,
    body: {
      tag: string;
      sheet: string;
      element_type: string;
      reason?: string;
      points?: [number, number][];
      expressions?: Record<string, ExpressionSpec>;
    },
  ) => post<{ entry: { id: string } }>(`${p(id)}/measurements/manual`, body),
  updateManualMeasurement: (
    id: string,
    mid: string,
    body: { points?: [number, number][]; tag?: string; expressions?: Record<string, ExpressionSpec>; reason?: string },
  ) => post(`${p(id)}/measurements/manual/${encodeURIComponent(mid)}`, body),
  deleteManualMeasurement: (id: string, mid: string) =>
    post(`${p(id)}/measurements/manual/${encodeURIComponent(mid)}/delete`),
  adjustMeasurement: (
    id: string,
    mid: string,
    body: { expressions?: Record<string, ExpressionSpec>; status?: "excluded"; adjustment_reason?: string },
  ) => post(`${p(id)}/measurements/${encodeURIComponent(mid)}`, body),
  resetMeasurement: (id: string, mid: string) => post(`${p(id)}/measurements/${encodeURIComponent(mid)}/reset`),

  saveShape: (
    id: string,
    body: { sheetId: string; shapeId: string; points?: [number, number][]; hidden?: boolean; reset?: boolean },
  ) => post(`${p(id)}/shapes`, body),

  adjustBillLine: (
    id: string,
    key: string,
    body: { expression: string; variables: Record<string, number>; adjustment_reason?: string },
  ) => post<{ line: CompareRow }>(`${p(id)}/bill/${encodeURIComponent(key)}`, body),
  resetBillLine: (id: string, key: string) => post(`${p(id)}/bill/${encodeURIComponent(key)}/reset`),
  hideBillLine: (id: string, key: string, hidden: boolean) =>
    post(`${p(id)}/bill/${encodeURIComponent(key)}/hide`, { hidden }),
  addCustomLine: (
    id: string,
    body: { label: string; section: string; unit: string; floor?: string; bill?: number | null; expression: string; variables: Record<string, number> },
  ) => post(`${p(id)}/bill-lines`, body),
  updateCustomLine: (
    id: string,
    lineId: string,
    body: Partial<{ label: string; section: string; unit: string; floor: string; bill: number | null; expression: string; variables: Record<string, number> }>,
  ) => post(`${p(id)}/bill-lines/${encodeURIComponent(lineId)}`, body),
  deleteCustomLine: (id: string, lineId: string) => post(`${p(id)}/bill-lines/${encodeURIComponent(lineId)}/delete`),

  getRates: (id: string) => request<RatesDoc>(`${p(id)}/rates`),
  saveRates: (id: string, body: Partial<RatesDoc>) => post<RatesDoc>(`${p(id)}/rates`, body),
  importRates: (id: string, file: UploadFile) => post<RatesImport>(`${p(id)}/rates/import`, file),

  assistantStatus: () => request<AssistantStatus>("/api/assistant/status"),
  saveAssistantSettings: (patch: AssistantSettingsPatch) => post<AssistantStatus>("/api/assistant/settings", patch),
  testAssistant: () => post<{ ok: boolean; error?: string; model?: string; ms?: number; reply?: string }>("/api/assistant/test"),
  assistantUsage: (days = 30) => request<UsageSummary>(`/api/assistant/usage?days=${days}`),
  clearAssistantUsage: () => post<UsageSummary>("/api/assistant/usage/clear"),
  assistantChat: (
    id: string,
    body: { message: string; threadId?: string; context?: Record<string, string>; task?: "chat" | "discovery"; autoApply?: boolean },
  ) => post<{ thread: AssistantThread }>(`${p(id)}/assistant`, body),
  assistantStop: (id: string, threadId: string) => post<{ cancelled: boolean }>(`${p(id)}/assistant/threads/${encodeURIComponent(threadId)}/stop`),
  assistantDeleteThread: (id: string, threadId: string) => post(`${p(id)}/assistant/threads/${encodeURIComponent(threadId)}/delete`),
  assistantThreads: (id: string) => request<ThreadSummary[]>(`${p(id)}/assistant/threads`),
  assistantThread: (id: string, threadId: string) => request<AssistantThread>(`${p(id)}/assistant/threads/${encodeURIComponent(threadId)}`),
  reviewMarks: (id: string) => request<{ marks: Record<string, string[]> }>(`${p(id)}/review-marks`),
  setReviewMarks: (id: string, sheetId: string, shapeIds: string[], reviewed: boolean) =>
    post<{ marks: Record<string, string[]> }>(`${p(id)}/review-marks`, { sheetId, shapeIds, reviewed }),
  proposals: (id: string) => request<Proposal[]>(`${p(id)}/assistant/proposals`),
  proposalAction: (id: string, proposalId: string, action: "apply" | "reject" | "undo") =>
    post<Proposal>(`${p(id)}/assistant/proposals/${encodeURIComponent(proposalId)}/${action}`),

  exportUrl: (id: string, kind: ExportKind, format: ExportFormat, view?: ExportView) => {
    const q = new URLSearchParams();
    if (view?.scope && view.scope !== "project") q.set("scope", view.scope);
    if (view?.sort) {
      q.set("sort", view.sort);
      q.set("dir", view.dir ?? "asc");
    }
    const qs = q.toString();
    return `${p(id)}/export/${kind}.${format}${qs ? `?${qs}` : ""}`;
  },
  sheetImageUrl: (id: string, sheetId: string, explicit?: string) =>
    explicit || `${p(id)}/sheets/${encodeURIComponent(`${sheetId}.png`)}`,
};
