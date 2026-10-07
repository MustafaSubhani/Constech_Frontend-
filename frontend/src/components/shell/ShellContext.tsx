import { createContext, useContext } from "react";

export type ShellState = {
  assistantOpen: boolean;
  setAssistantOpen: (open: boolean) => void;
  openPalette: () => void;
};

export const ShellContext = createContext<ShellState | null>(null);

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("ShellContext missing");
  return ctx;
}
