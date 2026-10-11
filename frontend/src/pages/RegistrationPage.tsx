import { FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, apiRequest } from "../api";
import { Account, AccountRole, accountLabels, accountRequest } from "../accounts";

export function RegistrationPage({ admin = false }: { admin?: boolean }) {
  const [params] = useSearchParams();
  const requested = params.get("role");
  const initial: AccountRole = requested === "cbg" || requested === "owner" ? requested : "kitchen";
  const [role, setRole] = useState<AccountRole>(initial);
  const [fields, setFields] = useState({ loginId: "", password: "", confirm: "", organisation: "",
    contact: "", address: "", lat: "", lng: "", type: "hotel", capacityKg: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Account | null>(null);
  function field(key: keyof typeof fields, label: string, type = "text", extra = {}) {
    return <label className="field"><span>{label}</span><input type={type} required
      maxLength={key === "password" || key === "confirm" ? 256 : key === "loginId" ? 100 : 200}
      value={fields[key]} onChange={(event) => setFields({ ...fields, [key]: event.currentTarget.value })}
      {...extra} /></label>;
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null);
    if (fields.password !== fields.confirm) { setError("The passwords do not match."); return; }
    setBusy(true);
    const payload = { role, loginId: fields.loginId.trim(), password: fields.password,
      organisation: fields.organisation.trim(), contact: fields.contact.trim(), address: fields.address.trim(),
      ...(role === "kitchen" ? { lat: Number(fields.lat), lng: Number(fields.lng), type: fields.type }
        : role === "admin" ? {} : { capacityKg: Number(fields.capacityKg) }),
    };
    try {
      const result = admin ? await accountRequest<Account>("/auth/accounts", payload)
        : await apiRequest<Account>("/auth/register", { method: "POST", body: JSON.stringify(payload) });
      setSaved(result); setFields({ ...fields, password: "", confirm: "" });
    } catch (reason) { setError(reason instanceof ApiError ? reason.status === 404
      ? "Registration is available in the local demo. Ask your operator to start the demo API."
      : reason.message : "Could not save registration. Check your connection and retry."); }
    finally { setBusy(false); }
  }
  return <main className="auth-shell"><section className="token-panel registration-panel">
    <Link className="brand" to="/">FeedSure CBG</Link>
    <h1>{admin ? "Create an account" : "Create a new login"}</h1>
    {saved ? <div role="status"><h2>Registration saved</h2>
      <p>Login ID: <strong>{saved.loginId}</strong>. An Admin must review and activate this account.</p>
      <Link className="button button-primary" to={admin ? "/accounts" : `/login?role=${role === "kitchen" ? "generator" : role}`}>{admin ? "Review accounts" : "Go to sign in"}</Link>
    </div> : <form onSubmit={(event) => void submit(event)}>
      <p>Register your organic waste site or CBG plant team. Your details go to an Admin for review.</p>
      <fieldset className="login-fields" disabled={busy}>
        <label className="field"><span>Registration section</span><select value={role} onChange={(event) => setRole(event.currentTarget.value as AccountRole)}>
          {(Object.keys(accountLabels) as AccountRole[]).filter((value) => admin || value !== "admin")
            .map((value) => <option key={value} value={value}>{accountLabels[value]}</option>)}
        </select></label>
        {field("organisation", role === "kitchen" ? "Organisation / site name" : role === "admin" ? "Organisation name" : "CBG plant name")}
        {field("contact", "Contact name and phone or email")}
        {field("address", role === "kitchen" ? "Pickup address" : "Plant / organisation address")}
        {role === "kitchen" ? <>
          <label className="field"><span>Generator type</span><select value={fields.type} onChange={(event) => setFields({ ...fields, type: event.currentTarget.value })}>
            <option value="hotel">Hotel</option><option value="hostel_mess">Hostel / mess</option>
            <option value="pg">PG</option><option value="restaurant">Restaurant</option><option value="canteen">Canteen</option>
          </select></label>
          <div className="account-field-pair">{field("lat", "Pickup latitude", "number", { min: -90, max: 90, step: "any" })}
            {field("lng", "Pickup longitude", "number", { min: -180, max: 180, step: "any" })}</div>
        </> : role !== "admin" && <>{field("capacityKg", "Plant intake capacity (kg/day)", "number", { min: 0.01, max: 1000000000, step: "any" })}
          <p className="muted">Plant registration is reviewed for this pilot. Activated staff use the pilot plant’s operations or intake desk.</p></>}
        {field("loginId", "Choose a login ID", "text", { pattern: "[a-zA-Z0-9][a-zA-Z0-9_.\\-]{2,99}", autoComplete: "username", autoCapitalize: "none", spellCheck: false })}
        {field("password", "Password (at least 12 characters)", "password", { minLength: 12, autoComplete: "new-password" })}
        {field("confirm", "Confirm password", "password", { minLength: 12, autoComplete: "new-password" })}
        <button className="button button-primary button-full" type="submit">{busy ? "Saving registration…" : "Request account registration"}</button>
      </fieldset>
      {error && <p className="inline-error" role="alert">{error}</p>}
    </form>}
    <Link className="text-button" to={admin ? "/accounts" : "/login"}>{admin ? "Back to accounts" : "Already registered? Sign in"}</Link>
  </section></main>;
}
