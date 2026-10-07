import { Logo } from "./brand/Logo";
import { Building3D } from "./brand/Building3D";
import { resolvedTheme } from "../lib/settings";

type Props = { active: boolean; exiting?: boolean; status?: string };

/** Full-screen loader: the frame assembling, the brand mark and a plain status line. */
export function ConstechLoader({ active, exiting = false, status }: Props) {
  if (!active && !exiting) return null;
  return (
    <div className={`loader${exiting ? " out" : ""}`} role="status" aria-live="polite" aria-label={status || "Loading"}>
      <div className="loader-inner">
        <Building3D storeys={2} tone={resolvedTheme() === "dark" ? "dark" : "light"} speed={1.6} />
        <Logo height={26} />
        <div className="progress indeterminate" aria-hidden="true">
          <span />
        </div>
        <p className="loader-status">{status || ""}</p>
      </div>
    </div>
  );
}
