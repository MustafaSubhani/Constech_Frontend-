import { useEffect, useState } from "react";
import { PlanSketch } from "./PlanSketch";
const LOGIN_LABELS = ["Read the drawings", "Measure outlines", "Compare with the bill"];

export function LoginArt() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const timer = window.setInterval(() => {
      setIndex((i) => (i + 1) % LOGIN_LABELS.length);
    }, 2800);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="login-art">
      <div className="art-bg" aria-hidden="true">
        <span className="orb orb-a" />
        <span className="orb orb-b" />
      </div>
      <header className="login-art-head">
        <img
          className="brand-logo art-logo"
          src="/assets/20450-Mamdouh-Labib-V6_Logo11.png"
          alt="Constech Construction"
        />
        <h1 className="rise" style={{ ["--d" as string]: "0.1s" }}>
          See every <em>quantity</em> on the drawing.
        </h1>
        <p className="lede rise" style={{ ["--d" as string]: "0.18s" }}>
          Footings, slabs, beams, and walls: measured on the sheets, checked against the bill.
        </p>
      </header>
      <div className="plan-stage rise" style={{ ["--d" as string]: "0.26s" }}>
        <PlanSketch />
        <div className="plan-caption" aria-live="polite">
          <div className="splash-dots on-dark" aria-hidden="true">
            {LOGIN_LABELS.map((_, i) => (
              <span key={i} className={i === index ? "on" : i < index ? "done" : ""} />
            ))}
          </div>
          <p className="plan-caption-text">{LOGIN_LABELS[index]}</p>
        </div>
      </div>
    </section>
  );
}
