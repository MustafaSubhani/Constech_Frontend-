import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, KeyRound, LockKeyhole } from "lucide-react";
import { api } from "../../api/client";
import { useToast } from "../ui/Toast";
import { Row, SectionHead } from "./parts";

/** Display name and password for the signed-in account. */
export function AccountSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const raw = useSyncExternalStore(api.onSession, () => sessionStorage.getItem("constech.takeoff.session"));
  const session = raw ? api.session() : null;
  const account = useQuery({ queryKey: ["account"], queryFn: api.account, retry: false });
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState("");

  const hasPassword = account.data?.hasPassword ?? session?.hasPassword ?? false;
  const savedName = account.data?.name ?? session?.name ?? "";

  useEffect(() => {
    setName(savedName);
  }, [savedName]);

  async function saveName() {
    const value = name.trim();
    if (!value || value === savedName) return;
    setSavingName(true);
    try {
      const updated = await api.updateAccount(value);
      qc.setQueryData(["account"], updated);
      toast.success("Name updated");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setPwError("");
    if (next.length < 8) return setPwError("Use at least 8 characters.");
    if (next !== confirm) return setPwError("The new passwords do not match.");
    setPwBusy(true);
    try {
      const updated = await api.changePassword(current, next);
      qc.setQueryData(["account"], updated);
      setPwOpen(false);
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success(hasPassword ? "Password changed. Other devices were signed out." : "Password set. It is now required to sign in.");
    } catch (err) {
      setPwError((err as Error).message);
    } finally {
      setPwBusy(false);
    }
  }

  const sessionExpired = account.error && (account.error as { status?: number }).status === 401;

  return (
    <section className="card settings-card" id="account">
      <SectionHead title="Account" hint="How you appear in Constech, and how you sign in." />
      {sessionExpired ? (
        <div className="banner banner-warn" style={{ marginBottom: 12 }}>
          This session was started before accounts were saved on the server. Sign out and in again to change your name or password.
        </div>
      ) : null}
      <Row title="Name" hint="Shown in the side bar and on your changes.">
        <div className="inline-edit">
          <input
            className="input field-lg"
            value={name}
            maxLength={80}
            disabled={Boolean(sessionExpired)}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveName();
              if (e.key === "Escape") setName(savedName);
            }}
            aria-label="Name"
          />
          {name.trim() && name.trim() !== savedName ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={saveName} disabled={savingName}>
              {savingName ? <span className="spinner" /> : <Check size={14} />} Save
            </button>
          ) : null}
        </div>
      </Row>
      <Row title="Email" hint="Your sign-in. Ask an administrator to change it.">
        <span className="settings-value">{session?.email ?? "—"}</span>
      </Row>
      <Row title="Password" hint={hasPassword ? "Required when you sign in." : "Not set: any password signs this email in. Set one to protect your account."}>
        {!pwOpen ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPwOpen(true)} disabled={Boolean(sessionExpired)}>
            <KeyRound size={14} /> {hasPassword ? "Change password" : "Set a password"}
          </button>
        ) : null}
      </Row>
      {pwOpen ? (
        <form className="password-form" onSubmit={savePassword}>
          {hasPassword ? (
            <label className="field">
              <span className="field-label">Current password</span>
              <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
            </label>
          ) : null}
          <label className="field">
            <span className="field-label">New password</span>
            <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} autoFocus={!hasPassword} />
            <span className="field-hint">At least 8 characters.</span>
          </label>
          <label className="field">
            <span className="field-label">Confirm new password</span>
            <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          {pwError ? <div className="banner banner-bad">{pwError}</div> : null}
          <div className="password-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setPwOpen(false);
                setPwError("");
              }}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={pwBusy || !next || (hasPassword && !current)}>
              {pwBusy ? <span className="spinner" /> : <LockKeyhole size={14} />} {hasPassword ? "Change password" : "Set password"}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
