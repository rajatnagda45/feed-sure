import { FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, apiRequest } from "../api";
import { clearAccountAccess } from "../accounts";

type LoginRole = "generator" | "cbg" | "owner" | "admin";
const roleLabels: Record<LoginRole, string> = {
  generator: "Organic waste generator", cbg: "CBG operations", owner: "Plant owner", admin: "Admin",
};

interface LoginResponse {
  role: "kitchen" | "cbg" | "owner" | "admin";
  path: string;
  token: string;
  storageKey: string;
  collectionDate: string;
  loginId: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requestedRole = params.get("role");
  const [role, setRole] = useState<LoginRole>(
    requestedRole && Object.hasOwn(roleLabels, requestedRole) ? requestedRole as LoginRole : "generator",
  );
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const response = await apiRequest<LoginResponse>("/auth/login", {
        method: "POST", body: JSON.stringify({
          role: role === "generator" ? "kitchen" : role,
          loginId: loginId.trim(),
          password,
        }),
      });
      // Switching accounts clears previous role access in this tab.
      clearAccountAccess();
      sessionStorage.setItem(response.storageKey, response.token);
      sessionStorage.setItem("feedsure:account", response.token);
      sessionStorage.setItem("feedsure:account-role", response.role);
      sessionStorage.setItem("feedsure:login-id", response.loginId);
      sessionStorage.setItem("feedsure:demo-date", response.collectionDate);
      setPassword("");
      navigate(response.path, { replace: true });
    } catch (reason) {
      setError(reason instanceof ApiError
        ? reason.status === 404 ? "ID/password login requires the local demo API. Start scripts/local_demo.py." : reason.message
        : "Could not connect to the login service. Check that the local API is running.");
    } finally { setBusy(false); }
  }

  return <main className="auth-shell">
    <form className="token-panel" onSubmit={(event) => void submit(event)}>
      <Link className="brand" to="/"><span className="brand-mark">F</span><span>FeedSure CBG</span></Link>
      <h1>Sign in to FeedSure</h1>
      <p>Choose your section and enter your login ID and password.</p>
      <fieldset disabled={busy} className="login-fields">
        <label className="field"><span>Section</span><select value={role} onChange={(event) => { setRole(event.currentTarget.value as LoginRole); setError(null); }}>
          {(Object.keys(roleLabels) as LoginRole[]).map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}
        </select></label>
        <label className="field"><span>Login ID</span><input required autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={100} value={loginId} onChange={(event) => setLoginId(event.currentTarget.value)} /></label>
        <label className="field"><span>Password</span><input required type="password" autoComplete="current-password" maxLength={256} value={password} onChange={(event) => setPassword(event.currentTarget.value)} /></label>
        <button className="button button-primary button-full" type="submit">{busy ? "Signing in…" : `Sign in to ${roleLabels[role]}`}</button>
      </fieldset>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <p className="muted">Ask your demo operator for your section’s login details.</p>
      <Link className="button button-secondary button-full" to={`/register?role=${role === "admin" ? "generator" : role}`}>Create a new login</Link>
      <p className="muted">New registrations need Admin approval before signing in.</p>
      <Link className="text-button" to="/driver-access">Driver trip access</Link>
    </form>
  </main>;
}
