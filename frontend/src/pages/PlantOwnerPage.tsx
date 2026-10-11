
import { useAccount } from "../auth";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError, GateRequest, IntakeResponse, IntakeTrip, WeightSource,
  createIdempotencyKey, getPlantIntake, savePlantGate,
} from "../api";
import { formatKg, formatPercent, formatServiceDate, parseNetGateKg, reconciliationLabel, serviceDateInIndia } from "../workflow";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) {
    return "Plant owner access is invalid or expired. Lock this desk and enter your current plant credential.";
  }
  return error instanceof ApiError ? error.message : "Could not connect. Check the connection and retry.";
}

export function IntakeTripPanel({ trip, token, refresh, onSaving }: {
  trip: IntakeTrip; token: string; refresh: (conflict: boolean) => void; onSaving: (saving: boolean) => void;
}) {
  const [netKg, setNetKg] = useState(String(trip.gate?.netKg ?? ""));
  const [source, setSource] = useState<WeightSource>(trip.gate?.weightSource ?? "SCALE");
  const [reference, setReference] = useState(trip.gate?.reference ?? "");
  const [correction, setCorrection] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const reconciliation = trip.reconciliation;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const weight = parseNetGateKg(netKg);
    if (weight === null) { setError("Enter a valid net received weight of zero or more."); return; }
    if (trip.gate && !correction.trim()) { setError("Enter a reason for correcting the saved gate record."); return; }
    const request: GateRequest = {
      planKey: trip.planKey, netKg: weight, weightSource: source,
      reference: reference.trim() || null, expectedRevision: trip.gate?.revision ?? 0,
      ...(trip.gate ? { correctionReason: correction.trim() } : {}),
    };
    const signature = JSON.stringify(request);
    if (!attempt.current || attempt.current.signature !== signature) {
      attempt.current = { signature, key: createIdempotencyKey("plant-gate") };
    }
    setSaving(true); onSaving(true); setError(null);
    try {
      await savePlantGate(request, token, attempt.current.key);
      attempt.current = null;
      refresh(false);
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "CONFLICT") {
        attempt.current = null;
        refresh(true);
      } else {
        setError(errorMessage(reason) + " Retry unchanged values to safely repeat the same intake event.");
      }
    } finally { setSaving(false); onSaving(false); }
  }

  return <section className="owner-trip" aria-label={`Intake for trip ${trip.planKey}`}>
    <div className="section-heading">
      <div><h2>{reconciliationLabel(reconciliation.status)}</h2><p className="muted">Trip {trip.planKey} · Planned return {trip.returnAt}</p></div>
      {trip.simulated && <span className="data-tag">Simulated supplier data</span>}
    </div>
    <div className="metric-grid">
      <div><span>Recorded pickup</span><strong>{formatKg(reconciliation.pickedKg)}</strong></div>
      <div><span>Net received</span><strong>{formatKg(reconciliation.netGateKg)}</strong></div>
      <div><span>Difference</span><strong>{formatKg(reconciliation.deltaKg)}</strong></div>
      <div><span>Difference %</span><strong>{formatPercent(reconciliation.deltaPct)}</strong></div>
    </div>
    {reconciliation.provisional && <p className="notice warning">Provisional comparison: at least one weight is estimated.</p>}
    {reconciliation.pendingStopIds.length > 0 && <p className="notice warning">Pickup outcomes still pending: {reconciliation.pendingStopIds.join(", ")}. Intake can be recorded, but reconciliation remains incomplete.</p>}
    <div className="owner-trip-body">
      <div className="owner-pickups">
        <h3>Collection records</h3>
        {trip.pickups.length === 0 ? <p className="muted">No driver pickup outcomes have been saved yet.</p> :
          <ul className="owner-records">{trip.pickups.map((pickup) => <li key={pickup.generatorId}>
            <div><strong>{pickup.name ?? pickup.generatorId}</strong><span>{pickup.outcome.replaceAll("_", " ")} · {pickup.weightSource?.toLowerCase() ?? "no weight"}</span></div>
            <strong>{formatKg(pickup.kg)}</strong>
          </li>)}</ul>}
        {trip.gate && <p className="muted">Gate record revision {trip.gate.revision} · {trip.gate.actor.type === "PLANT_OWNER" ? "Plant owner" : "Admin"}<br />{trip.gate.reference && `Reference: ${trip.gate.reference}`}</p>}
      </div>
      <form className="gate-form" onSubmit={(event) => void submit(event)}>
        <h3>{trip.gate ? "Correct net intake" : "Record net plant intake"}</h3>
        <fieldset disabled={saving} className="owner-gate-fields">
          <label className="field"><span>Net received kg</span><input required type="number" min="0" step="any" value={netKg} onChange={(event) => setNetKg(event.currentTarget.value)} /></label>
          <label className="field"><span>Weight source</span><select value={source} onChange={(event) => setSource(event.currentTarget.value as WeightSource)}><option value="SCALE">Scale</option><option value="ESTIMATE">Estimate</option></select></label>
          <label className="field"><span>Weighbridge reference (optional)</span><input value={reference} onChange={(event) => setReference(event.currentTarget.value)} /></label>
          {trip.gate && <label className="field"><span>Correction reason</span><input required placeholder="Example: corrected a typing error using the weighbridge slip" value={correction} onChange={(event) => setCorrection(event.currentTarget.value)} /><small>Explain why you are changing the saved intake. The previous weight and this reason remain in the audit history.</small></label>}
          <button className="button button-primary button-full" type="submit">{saving ? "Saving intake…" : trip.gate ? "Save correction" : "Save net intake"}</button>
        </fieldset>
        {error && <p className="notice error" role="alert">{error}</p>}
        <small>Received weight describes plant intake. It does not prove downstream processing.</small>
      </form>
    </div>
  </section>;
}

export function PlantOwnerPage() {
  const { account, signOut, signingOut } = useAccount();
  const [token, setToken] = useState(() => account ? "supabase-account" : sessionStorage.getItem("feedsure:plant-owner") ?? "");
  const [credential, setCredential] = useState("");
  const [date, setDate] = useState(() => sessionStorage.getItem("feedsure:demo-date") ?? serviceDateInIndia());
  const [data, setData] = useState<IntakeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setLoading(true); setError(null); setData(null);
    getPlantIntake(date, token, controller.signal).then((response) => {
      if (!controller.signal.aborted) setData(response);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(errorMessage(reason));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, date, refreshKey]);

  function unlock(event: FormEvent) {
    event.preventDefault();
    const value = credential.trim();
    if (!value) return;
    sessionStorage.setItem("feedsure:plant-owner", value);
    setToken(value); setCredential("");
  }
  function lock() {
    if (account) { void signOut(); return; }
    sessionStorage.removeItem("feedsure:plant-owner");
    setToken(""); setData(null); setError(null); setNotice(null);
  }
  function refreshAfterWrite(conflict: boolean) {
    setNotice(conflict
      ? "The record changed or this request conflicts with a saved event. Refreshing the latest intake; review the saved weight and revision before trying again."
      : "Net intake saved. Refreshing the pickup comparison and saved gate record.");
    setRefreshKey((value) => value + 1);
  }

  if (!token) return <main className="auth-shell">
    <form className="token-panel" onSubmit={unlock}>
      <Link className="brand" to="/"><span className="brand-mark">F</span><span>FeedSure CBG</span></Link>
      <h1>Plant owner access</h1>
      <p>Review delivered waste and record net intake using your plant owner credential.</p>
      <p>Ask the plant operator for your current plant owner credential. Dispatcher and driver credentials do not open this desk.</p>
      <label className="field"><span>Plant owner token</span><input required type="password" autoComplete="off" value={credential} onChange={(event) => setCredential(event.currentTarget.value)} /></label>
      <button className="button button-primary button-full" type="submit">Open plant intake</button>
      <Link className="text-button" to="/admin">Admin / dispatcher access</Link>
    </form>
  </main>;

  return <main className="plant-shell owner-shell">
    <header className="plant-header">
      <Link className="brand" to="/"><span className="brand-mark">F</span><span>FeedSure · Plant owner</span></Link>
      <button className="text-button" disabled={saving} onClick={lock}>{account ? (signingOut ? "Signing out…" : "Sign out") : "Lock"}</button>
    </header>
    <div className="owner-content">
      <div className="section-heading"><div><h1>Plant intake</h1><p className="muted">Compare the driver’s recorded pickup with what the plant received.</p></div></div>
      <div className="operations-toolbar">
        <label className="field compact"><span>Collection date · India time</span><input type="date" value={date} disabled={saving} onChange={(event) => { if (event.currentTarget.value) { setData(null); setNotice(null); setDate(event.currentTarget.value); } }} /></label>
        <button className="button button-secondary" disabled={loading || saving} onClick={() => { setNotice(null); setRefreshKey((value) => value + 1); }}>Refresh intake</button>
        {data && <span className="data-tag">Database: {data.database}</span>}
      </div>
      {loading && <p role="status">Loading dispatched trips…</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {data && data.trips.length === 0 && <section className="owner-trip"><h2>No dispatched trips for {formatServiceDate(date)}</h2><p>The admin must review and dispatch a route before it appears here.</p></section>}
      {data?.trips.map((trip) => <IntakeTripPanel key={trip.planKey} trip={trip} token={token} refresh={refreshAfterWrite} onSaving={setSaving} />)}
    </div>
  </main>;
}
