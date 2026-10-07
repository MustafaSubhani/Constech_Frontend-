import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { LoginArt } from "../components/LoginArt";

export function LoginPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [leaving, setLeaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.login(email, password);
      await qc.prefetchQuery({ queryKey: ["projects"], queryFn: () => api.listProjects() });
      setLeaving(true);
      window.setTimeout(() => navigate("/projects", { replace: true }), 380);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
      setShake(true);
      window.setTimeout(() => setShake(false), 500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`login${leaving ? " leaving" : ""}`}>
      <LoginArt />
      <section className="login-form">
        <form className={`login-card${shake ? " shake" : ""}`} onSubmit={onSubmit}>
          <img className="form-logo" src="/assets/20450-Mamdouh-Labib-V6_Logo11.png" alt="Constech Construction" />
          <p className="eyebrow rise" style={{ ["--d" as string]: "0.15s" }}>
            Quantity takeoff
          </p>
          <h1 className="rise" style={{ ["--d" as string]: "0.22s" }}>
            Welcome back
          </h1>
          <p className="lede rise" style={{ ["--d" as string]: "0.29s" }}>
            Sign in to open a drawing set, review what was measured, and compare it with the bill.
          </p>
          {error ? <p className="form-error">{error}</p> : null}
          <label className="field rise" style={{ ["--d" as string]: "0.36s" }}>
            <span>Email</span>
            <span className="input-wrap">
              <svg className="input-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 6h16v12H4z M4 7l8 6 8-6" />
              </svg>
              <input
                type="email"
                autoComplete="username"
                required
                placeholder="name@constech-uae.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </span>
          </label>
          <label className="field rise" style={{ ["--d" as string]: "0.43s" }}>
            <span>Password</span>
            <span className="input-wrap password">
              <svg className="input-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
              </svg>
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button className="btn-text" type="button" onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? "Hide" : "Show"}
              </button>
            </span>
          </label>
          <button className="btn btn-primary btn-signin rise" style={{ ["--d" as string]: "0.5s" }} type="submit" disabled={busy}>
            <span className="label">Sign in</span>
            <svg className="arrow" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14 M13 6l6 6-6 6" />
            </svg>
            <span className="spinner" aria-hidden="true" />
          </button>
          <p className="login-note rise" style={{ ["--d" as string]: "0.57s" }}>
            Preview sign-in accepts any work email until the login API is connected.{" "}
            <button
              className="btn-text"
              type="button"
              onClick={() => {
                setEmail("demo@constech-uae.com");
                setPassword("preview");
              }}
            >
              Use a preview account
            </button>
          </p>
        </form>
      </section>
    </div>
  );
}
