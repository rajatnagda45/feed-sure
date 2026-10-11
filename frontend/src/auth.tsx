import { createContext, ReactNode, useContext, useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { apiRequest } from "./api";
import { supabase, supabaseEnabled } from "./supabase";

export interface Account {
  id: string;
  role: "ADMIN" | "PLANT_OWNER" | "GENERATOR" | "DRIVER";
  generatorId?: string;
  planKey?: string;
}
export function accountPath(account: Account): string {
  switch (account.role) {
    case "ADMIN": return "/admin";
    case "PLANT_OWNER": return "/owner";
    case "GENERATOR":
      if (account.generatorId && /^[a-z0-9][a-z0-9-]{0,62}$/.test(account.generatorId))
        return `/g/${encodeURIComponent(account.generatorId)}`;
      break;
    case "DRIVER":
      if (account.planKey && /^\d{4}-\d{2}-\d{2}#p-[a-zA-Z0-9-]{1,64}$/.test(account.planKey))
        return `/driver/${encodeURIComponent(account.planKey)}`;
      break;
  }
  throw new Error("Your account needs a role and assignment. Ask your operator.");
}

const AuthContext = createContext<{ account: Account | null; loading: boolean; error: string | null }>({
  account: null, loading: supabaseEnabled, error: null,
});
export const useAccount = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(supabaseEnabled);
  const [error, setError] = useState<string | null>(null);
  const verifiedUser = useRef<string | null>(null);
  useEffect(() => {
    if (!supabaseEnabled) return;
    if (!supabase) { setError("Configure both Supabase frontend variables."); setLoading(false); return; }
    let live = true, sequence = 0;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const current = ++sequence;
      // Leave the SDK callback before requesting another SDK session (avoids auth lock contention).
      queueMicrotask(() => {
        if (!live || current !== sequence) return;
        setError(null);
        if (!session) { verifiedUser.current = null; setAccount(null); setLoading(false); return; }
        if (session.user.id !== verifiedUser.current) setLoading(true);
        apiRequest<{ account: Account }>("/auth/session").then((result) => {
          accountPath(result.account);
          if (live && current === sequence) {
            verifiedUser.current = result.account.id; setAccount(result.account);
          }
        }).catch((issue) => {
          if (live && current === sequence) {
            verifiedUser.current = null; setAccount(null); setError(issue instanceof Error ? issue.message : "Could not verify login.");
          }
        }).finally(() => { if (live && current === sequence) setLoading(false); });
      });
    });
    return () => { live = false; data.subscription.unsubscribe(); };
  }, []);
  return <AuthContext.Provider value={{ account, loading, error }}>
    {children}
    {account && <aside className="account-session" aria-label="Account session">
      <Link to={accountPath(account)}>My dashboard</Link>
      <button type="button" onClick={() => void supabase?.auth.signOut({ scope: "local" }).then(({ error: issue }) => {
        if (issue) setError(issue.message);
      })}>Sign out</button>
      {error && <p role="alert">{error}</p>}
    </aside>}
  </AuthContext.Provider>;
}

export function AccountGate({ role, children }: { role: Account["role"]; children: ReactNode }) {
  const { account, loading } = useAccount();
  const { id, planKey } = useParams();
  if (!supabaseEnabled) return <>{children}</>;
  if (loading) return <main className="auth-shell"><p role="status">Verifying your account…</p></main>;
  if (!account) return <Navigate to="/login" replace />;
  if (account.role !== role || (role === "GENERATOR" && account.generatorId !== id)
    || (role === "DRIVER" && account.planKey !== planKey)) {
    return <main className="auth-shell"><section className="token-panel">
      <h1>Access is not assigned to this account</h1>
      <Link className="button button-primary" to={accountPath(account)}>Open my dashboard</Link>
    </section></main>;
  }
  return <>{children}</>;
}
