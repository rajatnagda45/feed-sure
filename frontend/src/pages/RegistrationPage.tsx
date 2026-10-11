import { AuthShell } from "./auth/AuthShell";
import { useAccount } from "../auth";
import { emailDeliveryEnabled } from "../authEmail";
import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError } from "../api";
import { AccountRole, accountLabels, checkRegistrationSetup, registerAccount } from "../accounts";
import { supabase } from "../supabase";

export function RegistrationPage({ admin = false }: { admin?: boolean }) {
  const { userId } = useAccount();
  const [params] = useSearchParams();
  const requested = params.get("role");
  const initial: AccountRole = requested === "cbg" || requested === "owner" ? requested : "kitchen";
  const [role, setRole] = useState<AccountRole>(initial);
  const [fields, setFields] = useState({ email: "", password: "", confirm: "", organisation: "",
    contact: "", address: "", lat: "", lng: "", type: "hotel", capacityKg: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [ready, setReady] = useState(admin);
  const [checking, setChecking] = useState(!admin);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupAttempt, setSetupAttempt] = useState(0);
  useEffect(() => {
    if (admin) return;
    let active = true;
    setChecking(true); setSetupError(null); setReady(false);
    if (!supabase) {
      setSetupError("Supabase registration is not configured. Ask your operator."); setChecking(false);
      return;
    }
    checkRegistrationSetup().then(() => {
      if (active) setReady(true);
    }).catch((reason) => {
      if (active) setSetupError(reason instanceof ApiError && reason.status === 404
        ? "This API needs the registration update. Ask your operator to restart the updated app."
        : reason instanceof Error ? reason.message : "Could not check registration setup.");
    }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [admin, setupAttempt]);
  function field(key: keyof typeof fields, label: string, type = "text", extra = {}) {
    return <label className="field"><span>{label}</span><input type={type} required
      maxLength={key === "password" || key === "confirm" ? 256 : key === "email" ? 254 : 200}
      value={fields[key]} onChange={(event) => setFields({ ...fields, [key]: event.currentTarget.value })}
      {...extra} /></label>;
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null);
    if (fields.password !== fields.confirm) { setError("The passwords do not match."); return; }
    if (busy || !ready) return;
    setBusy(true);
    const payload = { role, email: fields.email.trim(), password: fields.password,
      organisation: fields.organisation.trim(), contact: fields.contact.trim(), address: fields.address.trim(),
      ...(role === "kitchen" ? { type: fields.type }
        : (role === "admin" || role === "driver") ? {} : { capacityKg: Number(fields.capacityKg) }),
    };
    try {
      await registerAccount(payload, admin);
      setSaved(true); setFields({ ...fields, password: "", confirm: "" });
    } catch (reason) { setError(reason instanceof ApiError ? reason.status === 404
      ? "Account management is unavailable. Ask your operator to check the Supabase migration."
      : reason.message : reason instanceof Error ? reason.message : "Could not save registration. Check your connection and retry."); }
    finally { setBusy(false); }
  }
  return <AuthShell><section className="token-panel registration-panel">
    <Link className="brand" to="/">FeedSure CBG</Link>
    <h1>{admin ? "Create an account" : "Create a new login"}</h1>
    {saved ? <div role="status"><h2>Registration saved</h2>
      <p>{admin ? (role === "admin" || role === "driver" ? "Activate this managed account from Manage accounts."
        : "The login is created. Access activates automatically when its profile is complete.")
        : emailDeliveryEnabled ? "Check your email, then complete your profile to activate access automatically. No Admin approval is required."
        : "Your login is ready. Complete your profile and pickup location to activate access automatically. No email verification or Admin approval is required."}</p>
      <Link className="button button-primary" to={admin ? "/accounts" : userId ? "/account" : "/login"}>{admin ? "Manage accounts" : userId ? "Complete my profile" : "Sign in to complete my profile"}</Link>
    </div> : <form onSubmit={(event) => void submit(event)}>
      <p>Create your login first. Complete your address and find your PIN-code area in My profile to activate access automatically.</p>
      {checking && <p role="status">Checking registration setup…</p>}
      {setupError && <div role="alert"><p className="inline-error">Registration unavailable: {setupError}</p>
        <button className="button button-secondary" type="button" onClick={() => setSetupAttempt((value) => value + 1)}>Try again</button>
      </div>}
      <fieldset className="login-fields" disabled={busy || !ready || checking}>
        <label className="field"><span>Registration section</span><select value={role} onChange={(event) => setRole(event.currentTarget.value as AccountRole)}>
          {(Object.keys(accountLabels) as AccountRole[]).filter((value) => admin || (value !== "admin" && value !== "driver"))
            .map((value) => <option key={value} value={value}>{accountLabels[value]}</option>)}
        </select></label>
        {field("organisation", role === "kitchen" ? "Organisation / site name" : role === "admin" ? "Organisation name" : "CBG plant name")}
        {field("contact", "Contact name and phone or email")}
        {field("address", "Address (optional — you can add it in your profile)", "text", { required: false, autoComplete: "street-address" })}
        {role === "kitchen" ? <>
          <label className="field"><span>Generator type</span><select value={fields.type} onChange={(event) => setFields({ ...fields, type: event.currentTarget.value })}>
            <option value="hotel">Hotel</option><option value="hostel_mess">Hostel / mess</option>
            <option value="pg">PG</option><option value="restaurant">Restaurant</option><option value="canteen">Canteen</option>
          </select></label>
          <p className="muted">No map or GPS is needed to create your login. Find your PIN-code area in My profile to activate access; the exact entrance can be added later.</p>
        </> : (role === "cbg" || role === "owner") && <>{field("capacityKg", "Plant intake capacity (kg/day)", "number", { min: 0.01, max: 1000000000, step: "any" })}
          <p className="muted">You are joining the existing pilot plant. This does not create a separate plant. Registered capacity does not change route settings.</p></>}
        {field("email", "Email address", "email", { autoComplete: "username", autoCapitalize: "none", spellCheck: false })}
        {field("password", "Password (at least 12 characters)", "password", { minLength: 12, autoComplete: "new-password" })}
        {field("confirm", "Confirm password", "password", { minLength: 12, autoComplete: "new-password" })}
        <button className="button button-primary button-full" type="submit">{busy ? "Saving registration…" : "Create account"}</button>
      </fieldset>
      {error && <p className="inline-error" role="alert">{error}</p>}
    </form>}
    <Link className="text-button" to={admin ? "/accounts" : "/login"}>{admin ? "Back to accounts" : "Already registered? Sign in"}</Link>
  </section></AuthShell>;
}
