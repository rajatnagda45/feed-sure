import { useAccount } from "../auth";
import { ProfileDetails } from "../components/ProfileDetails";
import { LocationPicker } from "../components/LocationPicker";
import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Account, accountLabels, accountRequest, clearAccountAccess } from "../accounts";

function message(reason: unknown) {
  return reason instanceof Error ? reason.message : "Could not connect. Check the connection and retry.";
}

function initialsOf(account: Account): string {
  const source = (account.organisation || account.loginId || "F").trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "F";
}

function dashboardHref(account: Account): string | null {
  if (account.status !== "ACTIVE") return null;
  switch (account.role) {
    case "kitchen":
      return account.generatorId ? `/g/${encodeURIComponent(account.generatorId)}` : null;
    case "owner": return "/owner";
    case "cbg":
    case "admin": return "/admin";
    case "driver": return account.planKey ? `/driver/${encodeURIComponent(account.planKey)}` : "/driver";
    default: return null;
  }
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
        : name === "activate" ? "Account active. The user can now sign in."
        : name === "suspend" ? "Account suspended. All its sessions have been signed out." : "Account details saved.");
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }
  return <article className="account-row">
    <div className="account-row-heading"><div><h2>{account.organisation}</h2><p>{account.loginId} · {accountLabels[account.role]}</p></div>
      <span className={`account-status account-status-${account.status.toLowerCase()}`}>{account.status.toLowerCase()}</span></div>
    <p>{account.contact || "No contact details"} · {account.address || "No address supplied"}</p>
    {account.capacityKg && <p>Registered plant capacity: {account.capacityKg.toLocaleString("en-IN")} kg/day</p>}
    {account.role === "kitchen" && <p>{Number.isFinite(account.profile?.lat) && Number.isFinite(account.profile?.lng) ? `Pickup entrance: ${account.profile?.lat}, ${account.profile?.lng}` : "Pickup location incomplete — the user can confirm it in My profile to activate access."}</p>}
    {account.status === "PENDING" && <p className="notice">Complete profile details activate generator and plant access automatically.</p>}
    <div className="account-actions">
      {(account.status === "SUSPENDED" || (account.status === "PENDING" && ["admin", "driver"].includes(account.role))) && <button type="button" className="button button-primary" disabled={busy || !account.address || (account.role === "kitchen" && (!Number.isFinite(account.profile?.lat) || !Number.isFinite(account.profile?.lng)))} onClick={() => void action("activate")}>{account.status === "PENDING" ? "Activate managed account" : "Reactivate account"}</button>}
      {account.status === "ACTIVE" && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void action("suspend")}>Suspend account</button>}
    </div>
    <details><summary>Edit account details</summary><form onSubmit={(event) => { event.preventDefault(); void action("update", { ...fields, ...(account.role === "kitchen" && profile && Number.isFinite(profile.lat) && Number.isFinite(profile.lng) ? { profile } : {}), ...(["cbg", "owner"].includes(account.role) ? { capacityKg: Number(capacity) } : {}) }); }}>
      <fieldset className="login-fields" disabled={busy}>
        {(Object.keys(fields) as (keyof typeof fields)[]).map((key) => <label className="field" key={key}><span>{key === "organisation" ? "Organisation / plant name" : key === "contact" ? "Contact" : "Address"}</span>
          <input required maxLength={200} value={fields[key]} onChange={(event) => setFields({ ...fields, [key]: event.currentTarget.value })} /></label>)}
        {account.role === "kitchen" && <><label className="field">Generator type<select value={profile?.type ?? "hotel"} onChange={(event) => setProfile((current) => ({ ...current, type: event.currentTarget.value }))}><option value="hotel">Hotel</option><option value="hostel_mess">Hostel / mess</option><option value="pg">PG</option><option value="restaurant">Restaurant</option><option value="canteen">Canteen</option></select></label>
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
      <label className="field"><span>Account status</span><select value={filter} onChange={(event) => setFilter(event.currentTarget.value)}><option value="ALL">All accounts</option><option value="PENDING">Setup incomplete</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></select></label>
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
  const { signOut, refresh } = useAccount();
  const [account, setAccount] = useState<Account | null>(null);
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setError(null); setLoading(true);
    accountRequest<Account>("/auth/account").then((result) => { if (active) setAccount(result); })
      .catch((reason) => { if (active) setError(message(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
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
  const dash = account ? dashboardHref(account) : null;
  const locationDone = account?.role === "kitchen"
    ? Number.isFinite(account.profile?.lat) && Number.isFinite(account.profile?.lng) : null;
  return <main className="account-page"><div className="account-wrap">
    {loading && !account && <div className="account-skeleton" role="status" aria-label="Loading your profile">
      <div className="sk sk-hero" /><div className="sk sk-card" /><div className="sk sk-card" />
    </div>}
    {account && <>
      <header className="account-hero reveal-up">
        <span className="account-avatar" aria-hidden="true">{initialsOf(account)}</span>
        <div className="account-hero__id">
          <p className="context-line">My profile</p>
          <h1>{account.organisation || account.loginId}</h1>
          <p className="account-hero__meta">{account.loginId} · {accountLabels[account.role]}</p>
        </div>
        <span className={`account-badge account-badge--${account.status.toLowerCase()}`}>
          <span className="account-badge__dot" aria-hidden="true" />{account.status.toLowerCase()}
        </span>
      </header>

      {account.status === "PENDING" && <p className="account-pending reveal-up" role="status">
        {account.role === "admin" || account.role === "driver" ? "This managed account needs activation by an Admin." : "Complete your profile below to activate your access automatically — no Admin approval is required."}</p>}
      {notice && <p className="account-flash reveal-up" role="status">{notice}</p>}
      {error && <p className="inline-error reveal-up" role="alert">{error}</p>}

      <div className="account-columns">
        <div className="account-col-main">
          <section className="account-card reveal-up">
            <div className="account-card__head"><div><p className="context-line">Organisation</p><h2>Site &amp; contact details</h2></div></div>
            <ProfileDetails key={`${account.id}:${account.revision}`} account={account} onSaved={(result) => { setAccount(result); setNotice(result.status === "ACTIVE" ? "Profile saved — your access is active." : "Profile saved. Complete the remaining details to activate access."); refresh(); }} />
          </section>

          <section className="account-card reveal-up">
            <div className="account-card__head"><div><p className="context-line">Security</p><h2>Login &amp; password</h2></div></div>
            <p className="account-note">Your sign-in email is <strong>{account.loginId}</strong>. Contact the Admin if you need to change it.</p>
            <form onSubmit={(event) => void save(event, "password")}><fieldset className="login-fields" disabled={busy || account.status !== "ACTIVE"}>
              <label className="field"><span>Current password</span><input type="password" required maxLength={256} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.currentTarget.value)} /></label>
              <div className="account-field-pair">
                <label className="field"><span>New password (min 12 characters)</span><input type="password" required minLength={12} maxLength={256} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} /></label>
                <label className="field"><span>Confirm new password</span><input type="password" required minLength={12} maxLength={256} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.currentTarget.value)} /></label>
              </div>
              <button className="button button-primary" type="submit">Change password &amp; sign out</button>
            </fieldset></form>
          </section>

          <section className="account-card account-card--danger reveal-up">
            <div className="account-card__head"><div><p className="context-line">Danger zone</p><h2>Delete my account</h2></div></div>
            <details className="account-delete"><summary>I want to delete my account</summary><p className="account-note">Login access will be removed and all sessions signed out. Your collection and intake records are retained.</p>
              <form onSubmit={(event) => void save(event, "delete")}><fieldset className="login-fields" disabled={busy || account.status !== "ACTIVE"}>
                <label className="field"><span>Current password</span><input type="password" required maxLength={256} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.currentTarget.value)} /></label>
                <label className="field"><span>Type <code>{account.loginId}</code> to confirm</span><input required value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} /></label>
                <button className="button button-danger" type="submit" disabled={confirmation !== account.loginId}>Delete my account</button>
              </fieldset></form>
            </details>
          </section>
        </div>

        <aside className="account-col-side">
          <section className="account-card account-summary reveal-up">
            <h3>Account overview</h3>
            <dl className="account-facts">
              <div><dt>Role</dt><dd>{accountLabels[account.role]}</dd></div>
              <div><dt>Status</dt><dd className={`account-facts__status account-facts__status--${account.status.toLowerCase()}`}>{account.status.toLowerCase()}</dd></div>
              {account.contact && <div><dt>Contact</dt><dd>{account.contact}</dd></div>}
              {account.address && <div><dt>Address</dt><dd>{account.address}</dd></div>}
              {typeof account.capacityKg === "number" && <div><dt>Reviewed capacity</dt><dd>{account.capacityKg.toLocaleString("en-IN")} kg/day</dd></div>}
              {locationDone !== null && <div><dt>Pickup location</dt><dd className={locationDone ? "account-facts__ok" : "account-facts__warn"}>{locationDone ? "Confirmed" : "Incomplete"}</dd></div>}
            </dl>
            <div className="account-side-actions">
              {dash && account.status === "ACTIVE" && <Link className="button button-primary button-full" to={dash}>Open my dashboard</Link>}
              <button className="text-button" type="button" disabled={busy || loading} onClick={() => { setNotice(null); setAccount(null); setAttempt((value) => value + 1); }}>{loading ? "Reloading…" : "Reload saved profile"}</button>
              <Link className="text-button" to="/">Back to FeedSure</Link>
            </div>
          </section>
        </aside>
      </div>
    </>}
    {!account && !loading && <section className="account-card reveal-up"><h1>My profile</h1>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="account-side-actions"><Link className="button button-primary" to="/login">Check account access</Link>
        <button className="text-button" type="button" onClick={() => { setNotice(null); setAttempt((value) => value + 1); }}>Retry</button></div></section>}
  </div></main>;
}
