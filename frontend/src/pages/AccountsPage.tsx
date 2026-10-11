import { useAccount } from "../auth";
import { LocationPicker } from "../components/LocationPicker";
import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Account, accountLabels, accountRequest, clearAccountAccess } from "../accounts";

function message(reason: unknown) {
  return reason instanceof Error ? reason.message : "Could not connect. Check the connection and retry.";
}

function AccountEditor({ account, refresh }: { account: Account; refresh: (message: string) => void }) {
  const [fields, setFields] = useState({ organisation: account.organisation, contact: account.contact, address: account.address });
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const [editingLocation, setEditingLocation] = useState(false);
  const [profile, setProfile] = useState(account.profile);
  const [capacity, setCapacity] = useState(String(account.capacityKg ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function action(name: string, extra = {}) {
    setBusy(true); setError(null); setNotice(null);
    try {
      await accountRequest<Account>(`/auth/accounts/${encodeURIComponent(account.id)}`, {
        action: name, expectedRevision: account.revision, ...extra,
      });
      setPassword(""); setConfirmation("");
      setNotice(name === "password" ? "Password reset. Existing sessions have been signed out." : "Account updated.");
      refresh(name === "password" ? "Password reset. Existing sessions have been signed out."
        : name === "delete" ? "Account deleted. Collection and intake records were retained."
        : name === "activate" ? "Account approved and active. The user can now sign in."
        : name === "suspend" ? "Account suspended. All its sessions have been signed out." : "Account details saved.");
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }
  return <article className="account-row">
    <div className="account-row-heading"><div><h2>{account.organisation}</h2><p>{account.loginId} · {accountLabels[account.role]}</p></div>
      <span className={`account-status account-status-${account.status.toLowerCase()}`}>{account.status.toLowerCase()}</span></div>
    <p>{account.contact || "No contact details"} · {account.address || "No address supplied"}</p>
    {account.capacityKg && <p>Registered plant capacity: {account.capacityKg.toLocaleString("en-IN")} kg/day</p>}
    {account.profile && <p>Pickup coordinates: {account.profile.lat}, {account.profile.lng} · {account.profile.type.replaceAll("_", " ")}</p>}
    {account.status === "PENDING" && account.role !== "kitchen" && <p className="notice">Check the plant details before approval. Activating this account gives access to the existing pilot plant.</p>}
    <div className="account-actions">
      {account.status !== "ACTIVE" && <button type="button" className="button button-primary" disabled={busy} onClick={() => void action("activate")}>{account.status === "PENDING" ? "Approve account" : "Reactivate account"}</button>}
      {account.status === "ACTIVE" && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void action("suspend")}>Suspend account</button>}
    </div>
    <details><summary>Edit account details</summary><form onSubmit={(event) => { event.preventDefault(); void action("update", { ...fields, ...(account.role === "kitchen" && profile ? { profile } : {}), ...(["cbg", "owner"].includes(account.role) ? { capacityKg: Number(capacity) } : {}) }); }}>
      <fieldset className="login-fields" disabled={busy}>
        {(Object.keys(fields) as (keyof typeof fields)[]).map((key) => <label className="field" key={key}><span>{key === "organisation" ? "Organisation / plant name" : key === "contact" ? "Contact" : "Address"}</span>
          <input required maxLength={200} value={fields[key]} onChange={(event) => setFields({ ...fields, [key]: event.currentTarget.value })} /></label>)}
        {account.role === "kitchen" && <><label className="field">Generator type<select value={profile?.type ?? "hotel"} onChange={(event) => setProfile((current) => ({ lat: current?.lat ?? 0, lng: current?.lng ?? 0, type: event.currentTarget.value }))}><option value="hotel">Hotel</option><option value="hostel_mess">Hostel / mess</option><option value="pg">PG</option><option value="restaurant">Restaurant</option><option value="canteen">Canteen</option></select></label>
          <details onToggle={(event) => { if (event.currentTarget.open) setEditingLocation(true); }}><summary>Correct pickup location</summary><LocationPicker address={fields.address} onChange={(point) => { setLocationConfirmed(Boolean(point)); if (point) setProfile((current) => ({ ...point, type: current?.type ?? "hotel" })); }} /></details>
          <p>Changes apply to future planning. Previously dispatched trips keep their original pickup location.</p></>}
        {["cbg", "owner"].includes(account.role) && <label className="field">Reviewed capacity (kg/day)<input type="number" required min="0.01" step="any" max="1000000000" value={capacity} onChange={(event) => setCapacity(event.currentTarget.value)} /></label>}
        <button className="button button-secondary" type="submit" disabled={account.role === "kitchen" && (editingLocation || fields.address !== account.address) && !locationConfirmed}>Save details</button>
      </fieldset>
    </form></details>
    <details><summary>Reset password</summary><form onSubmit={(event) => { event.preventDefault(); void action("password", { password }); }}>
      <label className="field"><span>New password (at least 12 characters)</span><input type="password" required minLength={12} maxLength={256} autoComplete="new-password" value={password} disabled={busy} onChange={(event) => setPassword(event.currentTarget.value)} /></label>
      <button className="button button-secondary" type="submit" disabled={busy}>Reset password and sign out sessions</button>
    </form></details>
    <details className="account-delete"><summary>Delete account</summary>
      <p>This removes login access and signs out all sessions. Collection and intake records are retained.</p>
      <label className="field"><span>Type {account.loginId} to confirm</span><input autoComplete="off" value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.currentTarget.value)} /></label>
      <button className="button button-secondary" type="button" disabled={busy || confirmation !== account.loginId} onClick={() => void action("delete")}>Delete account</button>
    </details>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </article>;
}

export function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    accountRequest<{ accounts: Account[] }>("/auth/accounts").then((result) => { if (active) setAccounts(result.accounts); })
      .catch((reason) => { if (active) { setAccounts([]); setError(message(reason)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  const visible = accounts.filter((account) => (filter === "ALL" || account.status === filter)
    && `${account.organisation} ${account.loginId} ${accountLabels[account.role]}`.toLowerCase().includes(search.toLowerCase()));
  return <main className="account-shell">
    <div className="section-heading"><div><h1>Manage accounts</h1><p>Review registrations and manage access for generators and your CBG plant team.</p></div>
      <Link className="button button-primary" to="/accounts/new">Create new login</Link></div>
    <div className="account-toolbar">
      <label className="field"><span>Search accounts</span><input type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /></label>
      <label className="field"><span>Account status</span><select value={filter} onChange={(event) => setFilter(event.currentTarget.value)}><option value="ALL">All accounts</option><option value="PENDING">Pending approval</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></select></label>
      <button className="button button-secondary" disabled={loading} type="button" onClick={() => setRevision((value) => value + 1)}>Refresh accounts</button>
    </div>
    {notice && <p className="notice success" role="status">{notice}</p>}
    {loading ? <p role="status">Loading accounts…</p> : error ? <div role="alert"><p className="inline-error">{error}</p><Link to="/login?role=admin">Sign in as an Admin</Link></div>
      : visible.length === 0 ? <p>No accounts match this view. Choose another status or create a new login.</p>
      : visible.map((account) => <AccountEditor key={`${account.loginId}:${account.revision}`} account={account} refresh={(result) => { setNotice(result); setRevision((value) => value + 1); }} />)}
  </main>;
}

export function MyAccountPage() {
  const navigate = useNavigate();
  const { signOut } = useAccount();
  const [account, setAccount] = useState<Account | null>(null);
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    accountRequest<Account>("/auth/account").then((result) => { if (active) setAccount(result); })
      .catch((reason) => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, []);
  async function save(event: FormEvent, action: "password" | "delete") {
    event.preventDefault();
    if (!account) return;
    setError(null);
    if (action === "password" && password !== confirmPassword) { setError("The new passwords do not match."); return; }
    setBusy(true);
    try {
      await accountRequest("/auth/account", { action, expectedRevision: account.revision, currentPassword,
        ...(action === "password" ? { password } : {}),
      });
      if (!await signOut()) throw new Error("Account updated. Retry Sign out before signing in again.");
      clearAccountAccess(); navigate("/login", { replace: true });
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }
  return <main className="auth-shell"><section className="token-panel">
    <h1>My account</h1>
    {account && <><p><strong>{account.loginId}</strong> · {accountLabels[account.role]}</p><p>{account.organisation}</p>
      {account.status === "PENDING" && <p role="status">Your registration is waiting for Admin approval. Account changes become available after approval.</p>}
      <form onSubmit={(event) => void save(event, "password")}><fieldset className="login-fields" disabled={busy || account.status !== "ACTIVE"}>
        <label className="field"><span>Current password</span><input type="password" required maxLength={256} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.currentTarget.value)} /></label>
        <label className="field"><span>New password (at least 12 characters)</span><input type="password" required minLength={12} maxLength={256} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} /></label>
        <label className="field"><span>Confirm new password</span><input type="password" required minLength={12} maxLength={256} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.currentTarget.value)} /></label>
        <button className="button button-primary" type="submit">Change password and sign out</button>
      </fieldset></form>
      <details className="account-delete"><summary>Delete my account</summary><p>Login access will be removed. Collection and intake records are retained.</p>
        <form onSubmit={(event) => void save(event, "delete")}><fieldset className="login-fields" disabled={busy || account.status !== "ACTIVE"}>
          <label className="field"><span>Current password</span><input type="password" required maxLength={256} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.currentTarget.value)} /></label>
          <label className="field"><span>Type {account.loginId} to confirm</span><input required value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} /></label>
          <button className="button button-secondary" type="submit" disabled={confirmation !== account.loginId}>Delete my account</button>
        </fieldset></form>
      </details></>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!account && <Link to="/login">Sign in to manage your account</Link>}
    <Link className="text-button" to="/">Back to FeedSure</Link>
  </section></main>;
}
