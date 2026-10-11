import { createContext, ReactNode, useContext, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ApiError, apiRequest } from "./api";
import { clearAccountAccess } from "./accounts";
import { authMessage } from "./network";
import { supabase, supabaseEnabled } from "./supabase";

export interface Account {
  id: string;
  role: "ADMIN" | "PLANT_OWNER" | "GENERATOR" | "DRIVER";
  generatorId?: string;
  planKey?: string;
  accountRole?: "kitchen" | "cbg" | "owner" | "admin" | "driver";
}
export function accountPath(account: Account): string {
  switch (account.role) {
    case "ADMIN": return account.accountRole === "cbg" ? "/plant" : "/admin";
    case "PLANT_OWNER": return "/owner";
    case "GENERATOR":
      if (account.generatorId && /^[a-z0-9][a-z0-9-]{0,62}$/.test(account.generatorId)) return `/g/${encodeURIComponent(account.generatorId)}`;
      break;
    case "DRIVER":
      if (!account.planKey) return "/driver";
      if (/^\d{4}-\d{2}-\d{2}#p-[a-zA-Z0-9-]{1,64}$/.test(account.planKey)) return `/driver/${encodeURIComponent(account.planKey)}`;
      break;
  }
  throw new Error("Your account needs a valid assignment. Contact your plant administrator.");
}
type AuthState = {
  account: Account | null; userId: string | null; loading: boolean; error: string | null;
  pending: boolean; recovery: boolean; signingOut: boolean;
  refresh: () => void; signOut: (scope?: "local" | "global") => Promise<boolean>;
};
const AuthContext = createContext<AuthState>({ account: null, userId: null, loading: supabaseEnabled,
  error: null, pending: false, recovery: false, signingOut: false, refresh: () => {}, signOut: async () => false });
export const useAccount = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [account, setAccount] = useState<Account | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(supabaseEnabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const generation = useRef(0);
  const logoutBusy = useRef(false);
  const verifiedUser = useRef<string | null>(null);
  useEffect(() => {
    if (!supabaseEnabled) return;
    if (!supabase) { setError("Account login is not fully configured. Contact your operator."); setLoading(false); return; }
    let live = true;
    const verify = (id: string | null, recovering = false) => {
      const current = ++generation.current;
      setUserId(id); setPending(false); setError(null);
      if (id !== verifiedUser.current) setAccount(null);
      if (!id) { verifiedUser.current = null; setRecovery(false); clearAccountAccess(); setLoading(false); return; }
      if (recovering) { setRecovery(true); setLoading(false); return; }
      if (id !== verifiedUser.current) setLoading(true);
      // Leave the SDK auth lock before apiRequest calls getSession.
      setTimeout(() => {
        if (!live || current !== generation.current) return;
        apiRequest<{ account: Account }>("/auth/session").then((result) => {
          accountPath(result.account);
          if (live && current === generation.current) { verifiedUser.current = id; setAccount(result.account); }
        }).catch((issue) => {
          if (live && current === generation.current) {
            verifiedUser.current = null; setAccount(null);
            // A pending account is the normal "finish your profile" state, not a
            // failure. Keep the message, but let the UI present it as guidance
            // (via `pending`) rather than a red error.
            setPending(issue instanceof ApiError && issue.code === "ACCOUNT_PENDING");
            setError(authMessage(issue));
          }
        }).finally(() => { if (live && current === generation.current) setLoading(false); });
      }, 0);
    };
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      verify(session?.user.id ?? null, event === "PASSWORD_RECOVERY");
    });
    return () => { live = false; ++generation.current; data.subscription.unsubscribe(); };
  }, [refreshKey]);
  async function signOut(scope: "local" | "global" = "local") {
    if (!supabase || logoutBusy.current) return false;
    logoutBusy.current = true; setSigningOut(true); setError(null);
    ++generation.current; verifiedUser.current = null; setAccount(null); setLoading(true);
    try {
      const result = await supabase.auth.signOut({ scope });
      if (result.error) throw result.error;
      clearAccountAccess(); setUserId(null); setPending(false); setRecovery(false);
      navigate("/login", { replace: true });
      return true;
    } catch (issue) {
      setError(`Sign-out could not be confirmed. ${authMessage(issue)} Retry Sign out.`);
      return false;
    } finally { logoutBusy.current = false; setLoading(false); setSigningOut(false); }
  }
  return <AuthContext.Provider value={{ account, userId, loading, error, pending, recovery, signingOut,
    refresh: () => setRefreshKey((value) => value + 1), signOut }}>
    {children}
    {userId && <aside className="account-session" aria-label="Account session">
      {account && <Link to={accountPath(account)}>My dashboard</Link>}
      {!recovery && <Link to="/account">My profile</Link>}
      {account?.accountRole === "admin" && <Link to="/accounts">Manage accounts</Link>}
      <button type="button" disabled={signingOut} onClick={() => void signOut()}>{signingOut ? "Signing out…" : "Sign out"}</button>
      {error && <p role={pending ? "status" : "alert"} className={pending ? "account-pending-note" : undefined}>{error}</p>}
    </aside>}
  </AuthContext.Provider>;
}
export function SessionGate({ children }: { children: ReactNode }) {
  const { userId, loading, recovery } = useAccount();
  if (loading) return <main className="auth-shell"><p role="status">Checking your session…</p></main>;
  if (recovery) return <Navigate to="/reset-password" replace />;
  if (!userId) return <Navigate to="/login" replace />;
  return <div key={userId}>{children}</div>;
}
export function AccountGate({ role, manage = false, children }: { role: Account["role"]; manage?: boolean; children: ReactNode }) {
  const { account, loading, recovery } = useAccount();
  const { id, planKey } = useParams();
  if (!supabaseEnabled) return <>{children}</>;
  if (recovery) return <Navigate to="/reset-password" replace />;
  if (loading) return <main className="auth-shell"><p role="status">Verifying your account…</p></main>;
  if (!account) return <Navigate to="/login" replace />;
  if (account.role !== role || (manage && account.accountRole !== "admin") || (role === "GENERATOR" && account.generatorId !== id)
    || (role === "DRIVER" && account.planKey !== planKey)) {
    return <main className="auth-shell"><section className="token-panel"><h1>Access is not assigned to this account</h1>
      <Link className="button button-primary" to={accountPath(account)}>Open my dashboard</Link></section></main>;
  }
  return <div key={account.id}>{children}</div>;
}
