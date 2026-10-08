import type { ReactNode } from "react";

/** Shared building blocks for settings cards. */
export function SectionHead({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <header className="settings-head">
      <div className="grow">
        <h2>{title}</h2>
        {hint ? <p>{hint}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="grow">
        <h3>{title}</h3>
        {hint ? <p>{hint}</p> : null}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}
