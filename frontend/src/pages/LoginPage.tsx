import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { AuthShell } from "./auth/AuthShell";
import { accountPath, useAccount } from "../auth";
import { supabase, supabaseEnabled } from "../supabase";
import { authMessage } from "../network";
import { authRedirect, emailDeliveryEnabled } from "../authEmail";

export function LoginPage() {
  const { account, userId, pending, recovery, refresh, loading, error: verificationError } = useAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(cooldown - 1), 1000); return () => clearTimeout(timer); }, [cooldown]);
  if (recovery) return <Navigate to="/reset-password" replace />;
  if (account && !loading) return <Navigate to={accountPath(account)} replace />;
  async function resend() {
    if (!supabase || busy || cooldown || !email.trim()) return;
    setBusy(true); setError(null);
    try {
      const result = await supabase.auth.resend({ type: "signup", email: email.trim(), options: { emailRedirectTo: authRedirect("/login") } });
      if (result.error) throw result.error;
      setNotice("If this account needs confirmation, an email has been sent. Check your inbox and spam folder.");
    } catch (issue) { setError(authMessage(issue)); }
    finally { setBusy(false); setCooldown(60); }
  }
  async function login(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError(null);
    try {
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      setPassword("");
    } catch (issue) { setError(authMessage(issue)); }
    finally { setBusy(false); }
  }
  return <AuthShell><section className="token-panel">
    <Link className="brand" to="/"><span className="brand-mark">F</span><span>FeedSure CBG</span></Link>
    <h1>Sign in</h1>
    <p>Sign in with your email to complete your profile or open your dashboard.</p>
    {userId && !loading && <div role="status"><h2>{pending ? "Complete your profile" : "Account access needs attention"}</h2>
      <p>{pending ? "Save your complete profile and pickup location to activate access automatically. No Admin approval is required." : "Retry the account check, or sign out below and sign in again. Contact your plant Admin if access was suspended."}</p>
      <button className="button button-secondary" onClick={refresh}>Check account status</button><Link className="button button-primary" to="/account">Complete my profile</Link></div>}
    {!supabase ? <p role="status">{supabaseEnabled ? "Supabase configuration is incomplete." : "Account login is not configured for this installation. Use your private access link."}</p>
      : <form onSubmit={login}>
        <label className="field"><span>Email</span><input type="email" autoComplete="username" required
          value={email} onChange={(event) => setEmail(event.currentTarget.value)} /></label>
        <label className="field"><span>Password</span><input type="password" autoComplete="current-password" required
          value={password} onChange={(event) => setPassword(event.currentTarget.value)} /></label>
        {(error || verificationError) && <p role="alert" className="inline-error">{error || verificationError}</p>}
        <button className="button button-primary" disabled={busy || loading} type="submit">
          {busy || loading ? "Signing in…" : "Sign in"}</button>
      </form>}
    {notice && <p role="status">{notice}</p>}
    {supabase && <><Link className="text-button" to="/forgot-password">Forgot password</Link>
      {emailDeliveryEnabled && <button className="text-button" disabled={busy || cooldown > 0 || !email.trim()} onClick={() => void resend()}>{cooldown ? `Resend available in ${cooldown}s` : "Resend confirmation"}</button>}
      <Link className="text-button" to="/register">Register your organisation or CBG team</Link></>}
  </section></AuthShell>;
}
