import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Monitor, Moon, Sun } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

function sessionUser() {
  return api.session();
}
import { AssistantSettings } from "../components/assistant/AssistantSettings";
import { CURRENCIES, updateSettings, useSettings, type ThemePref } from "../lib/settings";

export function SettingsPage() {
  const settings = useSettings();
  const assistant = useQuery({ queryKey: ["assistant-status"], queryFn: api.assistantStatus });
  const assistantReady = Boolean(assistant.data?.enabled && !assistant.data.problems.length);
  const { hash } = useLocation();
  const user = sessionUser();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash]);
  return (
    <div className="page-scroll">
      <div className="page-wrap page settings">
        <header className="page-head">
          <div className="titles">
            <h1>Settings</h1>
            <p>Defaults for new estimates and how projects run. Changes save as you make them.</p>
          </div>
        </header>

        <section className="card settings-card" id="account">
          <h2>Account</h2>
          <Row title="Name" hint="Signed in on this device.">
            <span className="small">{user?.name ?? "—"}</span>
          </Row>
          <Row title="Email">
            <span className="small">{user?.email ?? "—"}</span>
          </Row>
        </section>

        <section className="card settings-card">
          <h2>Estimate defaults</h2>
          <Row title="Currency" hint="Used for new rate sheets. Each project keeps its own currency once set.">
            <select className="select" style={{ width: 160 }} value={settings.currency} onChange={(e) => updateSettings({ currency: e.target.value })}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Row>
          <Row title="Overheads and profit" hint="Starting percentage added on top of direct works.">
            <div className="input-group" style={{ width: 160 }}>
              <input
                className="input input-num"
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={settings.defaultMarkupPercent}
                onChange={(e) => updateSettings({ defaultMarkupPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                style={{ paddingRight: 28 }}
              />
              <span className="input-suffix">%</span>
            </div>
          </Row>
        </section>

        <section className="card settings-card">
          <h2>Pipeline</h2>
          <Row title="Run new projects automatically" hint="When a project with no results opens, discover and measure it straight away.">
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.autorunNewProjects}
                onChange={(e) => updateSettings({ autorunNewProjects: e.target.checked })}
              />
              <span />
            </label>
          </Row>
          <Row title="Discovery method" hint="How a drawing set is read before measuring.">
            <div className="segmented">
              <button type="button" aria-pressed={settings.discovery === "rules"} onClick={() => updateSettings({ discovery: "rules" })}>
                Rule based
              </button>
              <button
                type="button"
                aria-pressed={settings.discovery === "agentic"}
                disabled={!assistantReady}
                title={assistantReady ? "Rule-based pass, then an assistant review that proposes corrections" : "Enable the assistant below first"}
                onClick={() => updateSettings({ discovery: "agentic" })}
              >
                Rules and assistant
              </button>
            </div>
          </Row>
        </section>

        <AssistantSettings />

        <section className="card settings-card">
          <h2>Appearance</h2>
          <Row title="Theme">
            <div className="segmented">
              {(
                [
                  ["system", "System", Monitor],
                  ["light", "Light", Sun],
                  ["dark", "Dark", Moon],
                ] as [ThemePref, string, typeof Sun][]
              ).map(([value, label, Icon]) => (
                <button key={value} type="button" aria-pressed={settings.theme === value} onClick={() => updateSettings({ theme: value })}>
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          </Row>
        </section>
      </div>
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="grow">
        <h3>{title}</h3>
        {hint ? <p>{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}
