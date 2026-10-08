import type { UploadFile } from "../types";

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result || "");
      resolve(res.includes(",") ? res.split(",")[1]! : res);
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export async function toUploads(files: File[]): Promise<UploadFile[]> {
  return Promise.all(files.map(async (f) => ({ name: f.name, content_base64: await fileToBase64(f) })));
}

export function extOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export const ACCEPT_PROJECT = ".dwg,.dxf,.pdf,.xlsx,.csv,.txt,.md";

export function describeFile(name: string): string {
  const ext = extOf(name);
  if (ext === "dwg" || ext === "dxf") return "CAD drawing";
  if (ext === "pdf") return "PDF sheet";
  if (ext === "xlsx" || ext === "csv") return "Spreadsheet";
  if (ext === "txt" || ext === "md") return "Notes";
  return "File";
}

export function acceptsFile(name: string, accept: string): boolean {
  const ext = `.${extOf(name)}`;
  return accept
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .includes(ext);
}

/** Fetch a generated file and save it; a server error becomes a thrown Error instead of a page of JSON. */
export async function downloadFile(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error("Cannot reach the takeoff server. Check that it is running.");
  }
  if (!response.ok) {
    let message = "The file could not be generated.";
    try {
      const body = await response.json();
      if (body?.message) message = body.message;
    } catch {
      /* keep fallback */
    }
    throw new Error(message);
  }
  const disposition = response.headers.get("Content-Disposition") || "";
  const star = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plain = disposition.match(/filename="?([^";]+)"?/i);
  const name = star ? decodeURIComponent(star[1]!) : plain ? plain[1]! : url.split("/").pop()!.split("?")[0]!;
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  return name;
}

export function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
