import type { ExportItem, Project, ProjectSummary, User } from "../types";

const SESSION = "constech.takeoff.session";

function session(): User | null {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION) || "null");
  } catch {
    return null;
  }
}

function headers(): HeadersInit {
  const user = session();
  const h: HeadersInit = { "Content-Type": "application/json" };
  if (user?.token) h.Authorization = `Bearer ${user.token}`;
  return h;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { ...headers(), ...options?.headers } });
  if (!response.ok) {
    let message = "The server could not complete that request.";
    try {
      const body = await response.json();
      if (body?.message) message = body.message;
    } catch {
      /* keep fallback */
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export const api = {
  session,
  async login(email: string, password: string): Promise<User> {
    const payload = await request<{ token: string; user: { email: string; name: string } }>(
      "/api/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
    );
    const user: User = { ...payload.user, token: payload.token };
    sessionStorage.setItem(SESSION, JSON.stringify(user));
    return user;
  },
  async logout(): Promise<void> {
    sessionStorage.removeItem(SESSION);
    try {
      await request("/api/auth/logout", { method: "POST" });
    } catch {
      /* session cleared locally */
    }
  },
  listProjects(): Promise<ProjectSummary[]> {
    return request("/api/projects");
  },
  getProject(id: string, catalog = true): Promise<Project> {
    const q = catalog ? "" : "?catalog=0";
    return request(`/api/projects/${encodeURIComponent(id)}${q}`);
  },
  createProject(
    name: string,
    place?: string,
    files?: { name: string; content_base64: string }[],
  ): Promise<Project> {
    return request("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, place, files }),
    });
  },
  uploadFiles(
    projectId: string,
    files: { name: string; content_base64: string }[],
  ): Promise<{ saved: string[] }> {
    return request(`/api/projects/${encodeURIComponent(projectId)}/upload`, {
      method: "POST",
      body: JSON.stringify({ files }),
    });
  },
  listExports(): Promise<ExportItem[]> {
    return request("/api/exports");
  },
  runProject(id: string, kind: "discover" | "foundations" | "structure"): Promise<{ message: string }> {
    return request(`/api/projects/${encodeURIComponent(id)}/${kind}`, { method: "POST" });
  },
  addManualMeasurement(
    projectId: string,
    body: {
      tag?: string;
      sheet?: string;
      element_type?: string;
      reason?: string;
      formula?: string;
      quantities?: Record<string, number>;
      inputs?: Record<string, unknown>;
    },
  ): Promise<{ entry: Record<string, unknown> }> {
    return request(`/api/projects/${encodeURIComponent(projectId)}/measurements/manual`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  adjustMeasurement(
    projectId: string,
    measurementId: string,
    body: {
      quantities?: Record<string, number>;
      formula?: string;
      inputs?: Record<string, unknown>;
      note?: string;
      adjustment_reason?: string;
    },
  ): Promise<{ override: Record<string, unknown> }> {
    return request(
      `/api/projects/${encodeURIComponent(projectId)}/measurements/${encodeURIComponent(measurementId)}`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },
  adjustBillLine(
    projectId: string,
    itemKey: string,
    body: { ours?: number; formula?: string; note?: string; adjustment_reason?: string },
  ): Promise<{ line: Record<string, unknown> }> {
    return request(`/api/projects/${encodeURIComponent(projectId)}/bill/${encodeURIComponent(itemKey)}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  getRates(projectId: string): Promise<{ currency?: string; rates?: Record<string, string> }> {
    return request(`/api/projects/${encodeURIComponent(projectId)}/rates`);
  },
  saveRates(
    projectId: string,
    body: { currency?: string; rates?: Record<string, string> },
  ): Promise<{ currency?: string; rates?: Record<string, string> }> {
    return request(`/api/projects/${encodeURIComponent(projectId)}/rates`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  sheetImageUrl(projectId: string, sheetId: string, explicit?: string): string {
    if (explicit) return explicit;
    return `/api/projects/${encodeURIComponent(projectId)}/sheets/${encodeURIComponent(`${sheetId}.png`)}`;
  },
};
