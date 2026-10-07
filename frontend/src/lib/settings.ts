import { useSyncExternalStore } from "react";

export type ThemePref = "system" | "light" | "dark";

export type AppSettings = {
  currency: string;
  defaultMarkupPercent: number;
  autorunNewProjects: boolean;
  discovery: "rules" | "agentic";
  theme: ThemePref;
};

const KEY = "constech.settings.v3";

export const DEFAULT_SETTINGS: AppSettings = {
  currency: "AED",
  defaultMarkupPercent: 15,
  autorunNewProjects: true,
  discovery: "rules",
  theme: "light",
};

export const CURRENCIES = ["AED", "SAR", "QAR", "KWD", "OMR", "BHD", "USD", "EUR", "GBP", "PKR", "INR"];

let current: AppSettings = read();
const listeners = new Set<() => void>();

function read(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as AppSettings;
    if (parsed.discovery !== "rules" && parsed.discovery !== "agentic") parsed.discovery = "rules";
    return parsed;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function getSettings(): AppSettings {
  return current;
}

export function updateSettings(patch: Partial<AppSettings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage may be unavailable; keep in memory */
  }
  if (patch.theme) applyTheme(current.theme);
  listeners.forEach((l) => l());
}

export function useSettings(): AppSettings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function resolvedTheme(pref: ThemePref = current.theme): "light" | "dark" {
  if (pref === "system") return media?.matches ? "dark" : "light";
  return pref;
}

export function applyTheme(pref: ThemePref = current.theme) {
  document.documentElement.setAttribute("data-theme", resolvedTheme(pref));
}

media?.addEventListener("change", () => {
  if (current.theme === "system") {
    applyTheme("system");
    listeners.forEach((l) => l());
  }
});
