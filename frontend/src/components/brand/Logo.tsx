const SRC = "/assets/20450-Mamdouh-Labib-V6_Logo11.png";

/** Full wordmark, or just the chevron mark (cropped from the same artwork) for tight spaces. */
export function Logo({ variant = "full", height = 26, onDark = false }: { variant?: "full" | "mark"; height?: number; onDark?: boolean }) {
  if (variant === "mark") {
    return (
      <span className={`logo-mark${onDark ? " on-dark" : ""}`} style={{ height, width: Math.round(height * 0.74) }} aria-label="Constech">
        <img src={SRC} alt="" style={{ height }} draggable={false} />
      </span>
    );
  }
  return <img className={`logo-full${onDark ? " on-dark" : ""}`} src={SRC} alt="Constech Construction" style={{ height }} draggable={false} />;
}
