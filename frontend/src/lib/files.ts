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

export function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
