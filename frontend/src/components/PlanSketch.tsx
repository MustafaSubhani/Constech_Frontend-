/** Shared floor-plan sketch used on login and splash screens (no metric callouts). */
export function PlanSketch({ className = "" }: { className?: string }) {
  return (
    <svg className={`plan-sketch ${className}`.trim()} viewBox="0 0 560 330" aria-hidden="true">
      <defs>
        <linearGradient id="plan-scan" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#48B59B" stopOpacity="0" />
          <stop offset="0.85" stopColor="#48B59B" stopOpacity="0.35" />
          <stop offset="1" stopColor="#7FE0C6" stopOpacity="1" />
        </linearGradient>
      </defs>
      <rect className="draw frame" x="20" y="20" width="520" height="290" pathLength={1} />
      <path className="draw grid" style={{ ["--d" as string]: "0.5s" }} d="M20 115 H540 M20 215 H540 M190 20 V310 M370 20 V310" pathLength={1} />
      <path className="raft" d="M120 80 H420 V150 H470 V260 H120 Z" />
      <path className="draw beam" style={{ ["--d" as string]: "1.1s" }} d="M70 62 H490" pathLength={1} />
      <path className="draw beam" style={{ ["--d" as string]: "1.25s" }} d="M70 62 V270" pathLength={1} />
      <path className="draw beam" style={{ ["--d" as string]: "1.4s" }} d="M490 62 V270" pathLength={1} />
      <path className="draw beam" style={{ ["--d" as string]: "1.55s" }} d="M70 270 H490" pathLength={1} />
      <g className="footings">
        <rect className="pop" style={{ ["--d" as string]: "1.7s" }} x="40" y="34" width="58" height="52" />
        <rect className="pop" style={{ ["--d" as string]: "1.8s" }} x="250" y="30" width="56" height="50" />
        <rect className="pop" style={{ ["--d" as string]: "1.9s" }} x="462" y="34" width="58" height="52" />
        <rect className="pop" style={{ ["--d" as string]: "2.0s" }} x="40" y="246" width="58" height="52" />
        <rect className="pop" style={{ ["--d" as string]: "2.1s" }} x="250" y="252" width="56" height="50" />
        <rect className="pop" style={{ ["--d" as string]: "2.2s" }} x="462" y="246" width="58" height="52" />
      </g>
      <g className="columns">
        <rect className="pop" style={{ ["--d" as string]: "2.3s" }} x="180" y="105" width="20" height="20" />
        <rect className="pop" style={{ ["--d" as string]: "2.4s" }} x="360" y="105" width="20" height="20" />
        <rect className="pop" style={{ ["--d" as string]: "2.5s" }} x="180" y="205" width="20" height="20" />
        <rect className="pop" style={{ ["--d" as string]: "2.6s" }} x="360" y="205" width="20" height="20" />
      </g>
      <rect className="missed pop" style={{ ["--d" as string]: "2.7s" }} x="395" y="170" width="52" height="42" />
      <g className="scanner">
        <rect x="-60" y="20" width="60" height="290" fill="url(#plan-scan)" />
      </g>
    </svg>
  );
}
