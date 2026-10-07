import type { AppSettings } from "../types";

const SETTINGS_KEY = "constech_global_settings";

export const DEFAULT_SETTINGS: AppSettings = {
  currency: "AED",
  defaultMarkupPercent: 15,
  unitSystem: "metric",
  decimalPlaces: 2,
};

export function getAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveAppSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore storage errors */
  }
}
