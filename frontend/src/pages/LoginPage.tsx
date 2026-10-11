import { FormEvent, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { accountPath, useAccount } from "../auth";
import { supabase, supabaseEnabled } from "../supabase";

export function LoginPage() {
  const { account, loading, error: verificationError } = useAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (account && !loading) return <Navigate to={accountPath(account)} replace />;
  async function login(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError(null);
    try {
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      setPassword("");
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Login failed. Try again."); }
    finally { setBusy(false); }
  }
  return <main className="auth-shell"><section className="token-panel">
    <Link className="brand" to="/"><span className="brand-mark">F</span><span>FeedSure CBG</span></Link>
    <h1>Sign in</h1>
    <p>Sign in with your email after your registration has been approved.</p>
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
    {supabase && <Link className="text-button" to="/register">Register your organisation or CBG team</Link>}
  </section></main>;
}
