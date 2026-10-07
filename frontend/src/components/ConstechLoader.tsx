import { useEffect, useState } from "react";

type Props = {
  active: boolean;
  exiting?: boolean;
  statusLabels?: string[];
};

/** Full-screen construction-animated loader. */
export function ConstechLoader({ active, exiting = false, statusLabels }: Props) {
  const [step, setStep] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) {
      setStep(0);
      setTick(0);
      return;
    }
    setStep(0);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    if (statusLabels?.length) {
      const labelTimer = window.setInterval(() => {
        setStep((s) => Math.min(s + 1, statusLabels.length - 1));
      }, 950);
      const tickTimer = window.setInterval(() => {
        setTick((t) => t + 1);
      }, 80);
      return () => {
        window.clearInterval(labelTimer);
        window.clearInterval(tickTimer);
      };
    }
    const tickTimer = window.setInterval(() => setTick((t) => t + 1), 80);
    return () => window.clearInterval(tickTimer);
  }, [active, statusLabels]);

  if (!active && !exiting) return null;

  const status = statusLabels?.[step];

  return (
    <div
      className={`loader constech-loader${exiting ? " out" : ""}`}
      role="status"
      aria-live="polite"
      aria-label={status ?? "Loading"}
    >
      <div className="loader-inner">
        {/* Building animation SVG */}
        <svg className="loader-building" viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Ground line */}
          <line x1="10" y1="148" x2="190" y2="148" stroke="var(--loader-line)" strokeWidth="2" strokeLinecap="round" />

          {/* Building body */}
          <rect className="lb-base" x="55" y="70" width="90" height="78" fill="var(--loader-fill)" stroke="var(--loader-stroke)" strokeWidth="1.5" />

          {/* Windows - ground floor */}
          <rect className="lb-win" x="66" y="120" width="14" height="18" rx="2" fill="var(--loader-win)" style={{"--wd": "0.1s"} as React.CSSProperties} />
          <rect className="lb-win" x="93" y="120" width="14" height="18" rx="2" fill="var(--loader-win)" style={{"--wd": "0.2s"} as React.CSSProperties} />
          <rect className="lb-win" x="120" y="120" width="14" height="18" rx="2" fill="var(--loader-win)" style={{"--wd": "0.3s"} as React.CSSProperties} />

          {/* Windows - mid floor */}
          <rect className="lb-win" x="66" y="96" width="14" height="16" rx="2" fill="var(--loader-win)" style={{"--wd": "0.4s"} as React.CSSProperties} />
          <rect className="lb-win" x="93" y="96" width="14" height="16" rx="2" fill="var(--loader-win)" style={{"--wd": "0.5s"} as React.CSSProperties} />
          <rect className="lb-win" x="120" y="96" width="14" height="16" rx="2" fill="var(--loader-win)" style={{"--wd": "0.6s"} as React.CSSProperties} />

          {/* Top floor - under construction */}
          <rect className="lb-floor" x="55" y="52" width="90" height="20" fill="var(--loader-accent-fill)" stroke="var(--loader-accent)" strokeWidth="1.5" />
          <rect className="lb-win" x="66" y="57" width="14" height="10" rx="1.5" fill="var(--loader-win-accent)" style={{"--wd": "0.7s"} as React.CSSProperties} />
          <rect className="lb-win" x="93" y="57" width="14" height="10" rx="1.5" fill="var(--loader-win-accent)" style={{"--wd": "0.8s"} as React.CSSProperties} />
          <rect className="lb-win" x="120" y="57" width="14" height="10" rx="1.5" fill="var(--loader-win-accent)" style={{"--wd": "0.9s"} as React.CSSProperties} />

          {/* Crane arm */}
          <line className="lb-crane" x1="145" y1="10" x2="145" y2="72" stroke="var(--loader-crane)" strokeWidth="3" strokeLinecap="round" />
          <line className="lb-crane" x1="90" y1="10" x2="170" y2="10" stroke="var(--loader-crane)" strokeWidth="3" strokeLinecap="round" />
          {/* Crane cable */}
          <line className="lb-cable" x1="160" y1="10" x2="160" y2={32 + (tick % 20)} stroke="var(--loader-cable)" strokeWidth="1.5" strokeDasharray="4 3" strokeLinecap="round" />
          {/* Crane hook */}
          <rect className="lb-hook" x="154" y={28 + (tick % 20)} width="12" height="8" rx="2" fill="var(--loader-accent)" />

          {/* Scaffolding left */}
          <line className="lb-scaf" x1="44" y1="70" x2="44" y2="148" stroke="var(--loader-scaf)" strokeWidth="1.5" />
          <line className="lb-scaf" x1="44" y1="148" x2="55" y2="148" stroke="var(--loader-scaf)" strokeWidth="1.5" />
          <line className="lb-scaf" x1="44" y1="110" x2="55" y2="110" stroke="var(--loader-scaf)" strokeWidth="1.5" />
          <line className="lb-scaf" x1="44" y1="80" x2="55" y2="80" stroke="var(--loader-scaf)" strokeWidth="1.5" />

          {/* Scaffolding right */}
          <line className="lb-scaf" x1="156" y1="70" x2="156" y2="148" stroke="var(--loader-scaf)" strokeWidth="1.5" />
          <line className="lb-scaf" x1="145" y1="148" x2="156" y2="148" stroke="var(--loader-scaf)" strokeWidth="1.5" />
          <line className="lb-scaf" x1="145" y1="110" x2="156" y2="110" stroke="var(--loader-scaf)" strokeWidth="1.5" />
          <line className="lb-scaf" x1="145" y1="80" x2="156" y2="80" stroke="var(--loader-scaf)" strokeWidth="1.5" />

          {/* Particles / dust */}
          {[0, 1, 2].map((i) => (
            <circle
              key={i}
              className="lb-particle"
              cx={60 + i * 30 + ((tick * 2 + i * 30) % 40) - 20}
              cy={50 - ((tick * 1.5 + i * 20) % 30)}
              r={1.5 + (i % 2)}
              fill="var(--loader-accent)"
              opacity={(1 - ((tick * 1.5 + i * 20) % 30) / 30) * 0.7}
            />
          ))}
        </svg>

        <p className="loader-word">CONSTECH</p>
        {status ? (
          <p className="loader-status" key={step}>
            {status}
          </p>
        ) : null}

        {/* Pulsing progress dots */}
        <div className="loader-dots" aria-hidden="true">
          <span className="ld" style={{"--i": 0} as React.CSSProperties} />
          <span className="ld" style={{"--i": 1} as React.CSSProperties} />
          <span className="ld" style={{"--i": 2} as React.CSSProperties} />
        </div>
      </div>
    </div>
  );
}
