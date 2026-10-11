import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "../auth";
import { authRedirect, emailDeliveryEnabled } from "../authEmail";
import { authMessage } from "../network";
import { supabase } from "../supabase";

export function RecoveryPage({ reset = false }: { reset?: boolean }) {
  const { userId, loading, signOut } = useAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [changed, setChanged] = useState(false);
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(cooldown - 1), 1000); return () => clearTimeout(timer); }, [cooldown]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || busy || cooldown) return;
    if (reset && password !== confirm) { setError("The passwords do not match."); return; }
    setBusy(true); setError(null);
    try {
      const result = reset ? await supabase.auth.updateUser({ password })
        : await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: authRedirect("/reset-password") });
      if (result.error) throw result.error;
      if (reset) {
        setChanged(true); setPassword(""); setConfirm("");
        if (!await signOut("global")) setMessage("Password changed. Retry Sign out before signing in again.");
      } else setMessage("If this address can receive a recovery email, a link has been sent. Check your inbox and spam folder.");
    } catch (issue) { setError(authMessage(issue)); }
    finally { setBusy(false); if (!reset) setCooldown(60); }
  }
  return <main className="auth-shell"><section className="token-panel"><h1>{reset ? "Choose a new password" : "Forgot password"}</h1>
    {!emailDeliveryEnabled && !reset ? <p>This pilot does not send account emails. Contact your plant Admin to reset your password. They can do this from Manage accounts after checking your identity.</p>
      : loading ? <p role="status">Checking the email link…</p>
      : reset && !userId ? <p role="alert">This recovery link is missing, expired or already used. <Link to="/forgot-password">Request another link</Link>.</p>
      : changed ? <button className="button" onClick={() => void signOut("global")}>Retry Sign out</button>
      : <form onSubmit={(event) => void submit(event)}><fieldset disabled={busy || cooldown > 0} className="login-fields">
        {reset ? <><label className="field">New password (at least 12 characters)<input type="password" minLength={12} maxLength={256} autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.currentTarget.value)} /></label>
          <label className="field">Confirm password<input type="password" minLength={12} maxLength={256} autoComplete="new-password" required value={confirm} onChange={(event) => setConfirm(event.currentTarget.value)} /></label></>
          : <label className="field">Email address<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} /></label>}
        <button className="button button-primary">{busy ? "Please wait…" : cooldown ? `Try again in ${cooldown}s` : reset ? "Save password and sign out" : "Send recovery link"}</button>
      </fieldset></form>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}<Link to="/login">Back to sign in</Link>
  </section></main>;
}

export function DriverWaitingPage() {
  const { refresh, loading } = useAccount();
  return <main className="auth-shell"><section className="token-panel"><h1>No trip assigned yet</h1>
    <p>Your dispatcher must assign a dispatched trip to your driver account.</p><button className="button" disabled={loading} onClick={refresh}>Check assignment</button></section></main>;
}
