import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bot, Calculator, Gauge, Monitor, Moon, Palette, Sun, UserRound, Workflow } from "lucide-react";
import { api } from "../api/client";
import { AccountSettings } from "../components/settings/AccountSettings";
import { UsageSettings } from "../components/settings/UsageSettings";
import { Row, SectionHead } from "../components/settings/parts";
import { AssistantSettings } from "../components/assistant/AssistantSettings";
import { CURRENCIES, updateSettings, useSettings, type ThemePref } from "../lib/settings";

const SECTIONS = [
  { id: "account", label: "Account", icon: UserRound },
  { id: "estimate", label: "Estimate defaults", icon: Calculator },
  { id: "pipeline", label: "Pipeline", icon: Workflow },
  { id: "assistant", label: "Assistant", icon: Bot },
  { id: "usage", label: "Token usage", icon: Gauge },
  { id: "appearance", label: "Appearance", icon: Palette },
];

export function SettingsPage() {
  const settings = useSettings();
  const assistant = useQuery({ queryKey: ["assistant-status"], queryFn: api.assistantStatus });
  const assistantReady = Boolean(assistant.data?.enabled && !assistant.data.problems.length);
  const { hash } = useLocation();
  const [active, setActive] = useState(SECTIONS[0]!.id);

  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash]);

  // The nav follows the section in view.
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-10% 0px -60% 0px" },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="page-scroll">
      <div className="settings-layout page">
        <nav className="settings-nav" aria-label="Settings sections">
          <h1>Settings</h1>
          <p>Saved as you change them.</p>
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className={active === id ? "active" : ""}
              onClick={(e) => {
                e.preventDefault();
                setActive(id);
                document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                history.replaceState(null, "", `#${id}`);
              }}
            >
              <Icon size={16} /> {label}
            </a>
          ))}
        </nav>

        <div className="settings-main">
          <AccountSettings />

          <section className="card settings-card" id="estimate">
            <SectionHead title="Estimate defaults" hint="Starting values for new rate sheets. Each project keeps its own once set." />
            <Row title="Currency" hint="Used for new rate sheets.">
              <select className="select field-md" value={settings.currency} onChange={(e) => updateSettings({ currency: e.target.value })}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Row>
            <Row title="Overheads and profit" hint="Percentage added on top of direct works.">
              <div className="input-group has-suffix field-md">
                <input
                  className="input input-num"
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={settings.defaultMarkupPercent}
                  onChange={(e) => updateSettings({ defaultMarkupPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                />
                <span className="input-suffix">%</span>
              </div>
            </Row>
          </section>

          <section className="card settings-card" id="pipeline">
            <SectionHead title="Pipeline" hint="How a project is read and measured when it opens." />
            <Row title="Run new projects automatically" hint="When a project with no results opens, discover and measure it straight away.">
              <label className="switch">
                <input type="checkbox" checked={settings.autorunNewProjects} onChange={(e) => updateSettings({ autorunNewProjects: e.target.checked })} />
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
                  title={assistantReady ? "Rule-based pass, then an assistant review that proposes corrections" : "Enable the assistant first"}
                  onClick={() => updateSettings({ discovery: "agentic" })}
                >
                  Rules and assistant
                </button>
              </div>
            </Row>
          </section>

          <AssistantSettings />
          <UsageSettings />

          <section className="card settings-card" id="appearance">
            <SectionHead title="Appearance" />
            <Row title="Theme" hint="System follows your computer's light or dark setting.">
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
    </div>
  );
}
