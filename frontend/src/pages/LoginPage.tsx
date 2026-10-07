import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Mail } from "lucide-react";
import { api } from "../api/client";
import { Logo } from "../components/brand/Logo";
import { Building3D } from "../components/brand/Building3D";

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
      void qc.prefetchQuery({ queryKey: ["projects"], queryFn: api.listProjects });
      setLeaving(true);
      window.setTimeout(() => navigate("/projects", { replace: true }), 260);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
      setShake(true);
      window.setTimeout(() => setShake(false), 400);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`login${leaving ? " leaving" : ""}`}>
      <div className="login-shell">
        <section className="login-art" aria-hidden="true">
          <div className="login-art-head">
            <Logo height={28} onDark />
            <h1>Every quantity, traced to the drawing it came from.</h1>
          </div>
          <Building3D tone="brand" caption storeys={3} />
          <p className="login-art-foot">Structural takeoff and bill comparison</p>
        </section>

        <section className={`login-form${shake ? " shake" : ""}`}>
          <div>
            <h2>Sign in</h2>
            <p className="lede">Open a drawing set, review the measurements and compare with the bill.</p>
          </div>
          <form onSubmit={onSubmit} noValidate>
            {error ? (
              <div className="banner banner-bad" role="alert">
                {error}
              </div>
            ) : null}
            <label className="field">
              <span className="field-label">Work email</span>
              <div className="input-group">
                <Mail size={15} />
                <input
                  className="input"
                  type="email"
                  autoComplete="username"
                  required
                  autoFocus
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <div className="password-wrap">
                <input
                  className="input"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>
            <button className="btn btn-primary btn-block" type="submit" disabled={busy || !email}>
              {busy ? <span className="spinner" /> : null}
              {busy ? "Signing in" : "Sign in"}
              {!busy ? <ArrowRight size={16} /> : null}
            </button>
          </form>
          <p className="login-note">
            Preview sign-in: any work email is accepted until single sign-on is connected.
          </p>
        </section>
      </div>
    </div>
  );
}
