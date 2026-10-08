import { createContext, useContext } from "react";

export type ShellState = {
  /** Open and on a page where the assistant works. */
  assistantOpen: boolean;
  assistantAvailable: boolean;
  setAssistantOpen: (open: boolean) => void;
  openPalette: () => void;
};

export const ShellContext = createContext<ShellState | null>(null);

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("ShellContext missing");
  return ctx;
}
