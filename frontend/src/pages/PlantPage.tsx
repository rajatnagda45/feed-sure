import { HazardReview } from "../components/HazardReview";
import { DriverAssignment } from "../components/DriverAssignment";

import { useAccount } from "../auth";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  ApiError,
  apiRequest,
  OperationsSnapshot,
  PlanDetailsResponse,
  PlanEnvelope,
  PlannerParams,
  WeightSource,
  createIdempotencyKey,
  createPlan,
  dispatchPlan,
  getLatestPlan,
  getOperations,
  getPlanDetails,
  saveReadiness,
} from "../api";
import { RouteMap } from "../components/RouteMap";
import { PhotoEvidence } from "../components/PhotoEvidence";
import {
  exclusionAction,
  currentExclusion,
  confirmedSupplyKg,
  formatKg,
  formatServiceDate,
  formatPercent,
  planMapPoints,
  reconciliationLabel,
  serviceDateInIndia,
} from "../workflow";

interface PlanControls {
  targetKg: string;
  truckCapacityKg: string;
  capacityBuffer: string;
  shiftStart: string;
  shiftEnd: string;
  serviceMin: string;
  maxRadiusKm: string;
}

interface PhoneForm {
  generatorId: string;
  status: "READY" | "NOT_READY";
  kg: string;
  source: WeightSource;
  start: string;
  end: string;
  confirmedBy: string;
  reason: string;
}

const emptyControls: PlanControls = {
  targetKg: "",
  truckCapacityKg: "",
  capacityBuffer: "",
  shiftStart: "",
  shiftEnd: "",
  serviceMin: "",
  maxRadiusKm: "",
};

function controlsFrom(defaults: PlannerParams): PlanControls {
  return {
    targetKg: String(defaults.targetKg),
    truckCapacityKg: String(defaults.truckCapacityKg),
    capacityBuffer: String(defaults.capacityBuffer),
    shiftStart: defaults.shiftStart,
    shiftEnd: defaults.shiftEnd,
    serviceMin: String(defaults.serviceMin),
    maxRadiusKm: String(defaults.maxRadiusKm),
  };
}

function displayError(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return "This dispatcher credential is invalid or expired. Lock this desk and ask the operator for a current credential.";
  if (error instanceof ApiError) return `${error.message} (${error.code})`;
  return "The request failed. Check the API connection and try again.";
}

export function PlantPage() {
  const { account, signOut, signingOut } = useAccount();
  const [adminToken, setAdminToken] = useState(() => account ? "supabase-account" : sessionStorage.getItem("feedsure:admin") ?? "");
  const [tokenDraft, setTokenDraft] = useState("");
  const [date, setDate] = useState(() => sessionStorage.getItem("feedsure:demo-date") ?? serviceDateInIndia());
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [plan, setPlan] = useState<PlanEnvelope | null>(null);
  const [details, setDetails] = useState<PlanDetailsResponse | null>(null);
  const [controls, setControls] = useState<PlanControls>(emptyControls);
  const [controlsTouched, setControlsTouched] = useState(false);
  const [mandatoryIds, setMandatoryIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [phone, setPhone] = useState<PhoneForm | null>(null);
  const [driverAccess, setDriverAccess] = useState<{ token: string; expiresAt: string; planKey: string } | null>(null);
  const [supplyFilter, setSupplyFilter] = useState("all");
  const [driverLinkVisible, setDriverLinkVisible] = useState(false);
  const renewalAttempt = useRef<string | null>(null);
  const dispatchAttempt = useRef<{ signature: string; key: string } | null>(null);
  const phoneEditor = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!phone) return;
    phoneEditor.current?.scrollIntoView({ block: "start" });
    phoneEditor.current?.querySelector<HTMLSelectElement>("select")?.focus({ preventScroll: true });
  }, [phone?.generatorId]);

  useEffect(() => {
    if (!adminToken) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      getOperations(date, adminToken, controller.signal),
      getLatestPlan(date, adminToken, controller.signal),
    ]).then(async ([operations, latest]) => {
      if (controller.signal.aborted) return;
      setSnapshot(operations);
      if (!controlsTouched) {
        setControls(controlsFrom(latest.plan?.params ?? operations.defaults));
        setMandatoryIds(latest.plan?.params.mandatoryIds ?? []);
      }
      setMandatoryIds((current) => current.filter((id) => operations.generators.some((g) => g.generatorId === id)));
      setPlan(latest.plan);
      setDetails(null);
      if (latest.plan) {
        const response = await getPlanDetails(latest.plan.planKey, adminToken, controller.signal);
        if (!controller.signal.aborted) setDetails(response);
      } else {
        setDetails(null);
      }
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(displayError(reason));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [adminToken, date, refreshKey]);

  const activePlan = details?.plan ?? plan;
  const execution = details?.execution ?? null;
  const points = useMemo(
    () => planMapPoints(activePlan, snapshot?.generators ?? [], snapshot?.depot ?? null, snapshot?.inputRevision),
    [activePlan, snapshot],
  );
  const statusCounts = snapshot?.generators.reduce<Record<string, number>>((counts, generator) => {
    counts[generator.readinessStatus] = (counts[generator.readinessStatus] ?? 0) + 1;
    if (generator.unresolvedHazards.length) counts.HAZARD = (counts.HAZARD ?? 0) + 1;
    return counts;
  }, {}) ?? {};
  const actualPicked = execution?.pickups.reduce((sum, pickup) => sum + pickup.kg, 0) ?? null;
  const controlsMatchPlan = !activePlan || (Object.entries(controls).every(([key, value]) =>
    String(activePlan.params[key as keyof PlanControls]) === String(Number.isFinite(Number(value)) ? Number(value) : value))
    && [...mandatoryIds].sort().join("|") === [...activePlan.params.mandatoryIds].sort().join("|"));
  const staleDraft = activePlan?.state === "DRAFT" && activePlan.inputRevision !== snapshot?.inputRevision;
  const pendingOutcomes = activePlan?.plan.stops.filter((stop) => !execution?.pickups.some((pickup) => pickup.generatorId === stop.generatorId)) ?? [];
  const nextStep = !activePlan ? "Review the confirmations and build a draft route."
    : activePlan.state === "DISPATCHED" ? pendingOutcomes.length
      ? `Hand off the frozen trip. ${pendingOutcomes.length} stop outcomes are still pending.`
      : execution?.gate ? "Review the pickup and net intake reconciliation." : "All stop outcomes are recorded. Ask the plant owner to record net intake."
    : staleDraft ? "Waste supplier inputs changed. Re-plan before dispatch."
    : !controlsMatchPlan ? "Planning controls changed. Re-plan to save these choices."
    : activePlan.mandatoryConflicts.length ? "Resolve mandatory stop conflicts before dispatch."
    : !activePlan.plan.stops.length ? "No stops fit this draft. Review waste supplier confirmations and constraints."
    : activePlan.status !== "FEASIBLE" ? "This draft is not feasible. Review the shortfall and constraints before re-planning."
    : "Review addresses, windows and exclusions, then dispatch this version.";
  const currentDriverAccess = driverAccess?.planKey === activePlan?.planKey ? driverAccess : null;
  const driverLink = currentDriverAccess && activePlan
    ? `${window.location.origin}/driver/${encodeURIComponent(activePlan.planKey)}?t=${encodeURIComponent(currentDriverAccess.token)}` : "";

  const changeDate = (value: string) => {
    if (!value || value === date) return;
    setDate(value); setControlsTouched(false); setMandatoryIds([]); setSnapshot(null);
    setPlan(null); setDetails(null); setDriverAccess(null); setDriverLinkVisible(false);
    setPhone(null); setMessage(null);
  };

  const authenticate = (event: FormEvent) => {
    event.preventDefault();
    const value = tokenDraft.trim();
    if (!value) return;
    sessionStorage.setItem("feedsure:admin", value);
    setAdminToken(value);
    setTokenDraft("");
  };

  const clearToken = () => {
    if (account) { void signOut(); return; }
    sessionStorage.removeItem("feedsure:admin");
    setAdminToken("");
    setSnapshot(null);
    setPlan(null);
    setDetails(null);
    setDriverAccess(null);
    setDriverLinkVisible(false);
  };

  const replan = async () => {
    if (!snapshot || !adminToken) return;
    setPlanning(true);
    setError(null);
    setMessage(null);
    try {
      const response = await createPlan(adminToken, {
        collectionDate: date,
        targetKg: Number(controls.targetKg),
        truckCapacityKg: Number(controls.truckCapacityKg),
        capacityBuffer: Number(controls.capacityBuffer),
        shiftStart: controls.shiftStart,
        shiftEnd: controls.shiftEnd,
        serviceMin: Number(controls.serviceMin),
        maxRadiusKm: Number(controls.maxRadiusKm),
        mandatoryIds,
      });
      setPlan(response);
      setDetails(null);
      setDriverAccess(null);
      setDriverLinkVisible(false);
      dispatchAttempt.current = null;
      setMessage("New draft saved. Review the stops and conflicts before dispatch.");
    } catch (reason) {
      setError(displayError(reason));
    } finally {
      setPlanning(false);
    }
  };

  const dispatch = async () => {
    if (!activePlan || !adminToken) return;
    const request = {
      expectedVersion: activePlan.version,
      expectedInputRevision: activePlan.inputRevision,
    };
    const signature = JSON.stringify({ planKey: activePlan.planKey, ...request });
    if (!dispatchAttempt.current || dispatchAttempt.current.signature !== signature) {
      dispatchAttempt.current = { signature, key: createIdempotencyKey("dispatch") };
    }
    setDispatching(true);
    setError(null);
    try {
      const response = await dispatchPlan(
        activePlan.planKey,
        adminToken,
        request,
        dispatchAttempt.current.key,
      );
      dispatchAttempt.current = null;
      setPlan(response.plan);
      setDriverAccess({ ...response.driverAccess, planKey: response.plan.planKey });
      setDriverLinkVisible(false);
      setMessage(activePlan.state === "DISPATCHED"
        ? "Private driver access retrieved for the frozen trip."
        : "Trip dispatched and frozen. Waste supplier edits now appear as alerts.");
      setRefreshKey((value) => value + 1);
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "CONFLICT") {
        setError("Dispatch was rejected because the plan or inputs changed. Refresh, re-plan, and review before dispatching again.");
        setRefreshKey((value) => value + 1);
      } else {
        setError(displayError(reason) + " Retrying uses the same dispatch key and payload.");
      }
    } finally {
      setDispatching(false);
    }
  };

  const renewAccess = async () => {
    if (!activePlan || dispatching) return;
    setDispatching(true); setError(null);
    renewalAttempt.current ??= createIdempotencyKey("renew-access");
    try {
      const result = await apiRequest<{ plan: PlanEnvelope; driverAccess: { token: string; expiresAt: string } }>(`/plans/${encodeURIComponent(activePlan.planKey)}/renew-access`, {
        method: "POST", adminToken, idempotencyKey: renewalAttempt.current, body: JSON.stringify({ expectedVersion: activePlan.version }),
      });
      setDriverAccess({ ...result.driverAccess, planKey: activePlan.planKey }); renewalAttempt.current = null;
      setMessage("Driver access renewed. Previously issued private links are revoked; share the new link if using token access.");
    } catch (issue) { setError(displayError(issue)); }
    finally { setDispatching(false); }
  };

  const copyDriverLink = async () => {
    if (!currentDriverAccess || !activePlan) return;
    try {
      await navigator.clipboard.writeText(driverLink);
      setMessage(`Private driver link copied. It expires at ${new Date(currentDriverAccess.expiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.`);
    } catch {
      setDriverLinkVisible(true);
      setMessage("Clipboard access was unavailable. Select and copy the private link in the handoff panel.");
    }
  };

  const submitPhone = async (event: FormEvent) => {
    event.preventDefault();
    if (!phone || !adminToken) return;
    const kg = Number(phone.kg);
    if (!phone.confirmedBy.trim() || !phone.reason.trim()
      || (phone.status === "READY" && (!Number.isFinite(kg) || kg <= 0 || phone.start >= phone.end))) {
      setError("Phone confirmations require a supervisor label, reason, and valid READY quantity/window.");
      return;
    }
    try {
      await saveReadiness({
        generatorId: phone.generatorId,
        collectionDate: date,
        status: phone.status,
        ...(phone.status === "READY" ? {
          confirmedKg: kg,
          weightSource: phone.source,
          window: { start: phone.start, end: phone.end },
          photoKeys: [],
        } : {}),
        confirmedBy: phone.confirmedBy.trim(),
        reason: phone.reason.trim(),
        lang: "en",
      }, { adminToken });
      setPhone(null);
      setMessage("Phone confirmation saved. Input revision advanced; re-plan before dispatch.");
      setRefreshKey((value) => value + 1);
    } catch (reason) {
      setError(displayError(reason));
    }
  };

  if (!adminToken) {
    return (
      <main className="auth-shell">
        <form className="token-panel" onSubmit={authenticate}>
          <Link className="brand" to="/"><span className="brand-mark">F</span><span>FeedSure dispatch</span></Link>
          <p className="context-line">Runtime access</p>
          <h1>Open the operations desk</h1>
          <p>The admin token stays in this browser tab and is never compiled into the app.</p>
          <label className="field"><span>Admin token</span><input type="password" autoComplete="off" value={tokenDraft} onChange={(event) => setTokenDraft(event.currentTarget.value)} /></label>
          <button className="button button-primary button-full" type="submit">Open dashboard</button>
        </form>
      </main>
    );
  }

  return (
    <main className="plant-shell">
      <header className="plant-header">
        <Link className="brand" to="/"><span className="brand-mark">F</span><span>FeedSure · Operations</span></Link>
        <div className="header-actions">
          {snapshot?.simulated && <span className="data-tag">Simulated supplier data</span>}
          <button className="text-button" type="button" onClick={clearToken}>{account ? (signingOut ? "Signing out…" : "Sign out") : "Lock"}</button>
        </div>
      </header>

      <section className="operations-toolbar">
        <label className="field compact"><span>Planning date · India time</span><input type="date" disabled={planning || dispatching} value={date} onChange={(event) => changeDate(event.currentTarget.value)} /></label>
        <button className="text-button" type="button" disabled={planning || dispatching} onClick={() => changeDate(serviceDateInIndia(new Date(), 0))}>Today</button>
        <button className="text-button" type="button" disabled={planning || dispatching} onClick={() => changeDate(serviceDateInIndia())}>Tomorrow</button>
        <button className="button button-secondary" type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}>Refresh data</button>
        {snapshot && <div className="mode-line"><span>Database {snapshot.serviceMode.database}</span><span>Matrix {activePlan?.matrixSource ?? snapshot.serviceMode.matrix}</span><span>Screening {snapshot.serviceMode.screening}</span></div>}
      </section>

      {loading && <p className="loading-line page-pad">Refreshing authoritative operations data…</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice success" aria-live="polite">{message}</p>}
      {details?.alerts.map((alert) => <p className="notice warning" key={alert.code}>{alert.message} {activePlan?.state === "DISPATCHED" ? "The dispatched route remains frozen." : "Re-plan and review the updated inputs before dispatch."}</p>)}

      {snapshot && (
        <>
          <section className="status-rail" aria-label="Supply status">
            <div><span>Ready</span><strong>{statusCounts.READY ?? 0}</strong></div>
            <div><span>Not ready</span><strong>{statusCounts.NOT_READY ?? 0}</strong></div>
            <div><span>Unconfirmed</span><strong>{statusCounts.UNCONFIRMED ?? 0}</strong></div>
            <div><span>Hazard holds</span><strong>{statusCounts.HAZARD ?? 0}</strong></div>
            <div><span>Confirmed quantity</span><strong>{formatKg(confirmedSupplyKg(snapshot.generators))}</strong></div>
          </section>

          <section className="operations-brief" aria-label="Collection brief">
            <div><h1>{formatServiceDate(date)}</h1><p>{nextStep}</p></div>
            <nav aria-label="Operations sections"><a href="#route-review">Route</a><a href="#supply-actions">Waste supplier actions</a>{activePlan?.state === "DISPATCHED" && <a href="#gate-record">Plant intake</a>}</nav>
            <p className="brief-detail">{formatKg(confirmedSupplyKg(snapshot.generators, true))} confirmed without hazard holds in the accepted stream. Confirmed quantity is not expected collection. Input revision {snapshot.inputRevision}.</p>
          </section>

          <section className="planner-controls" aria-labelledby="plan-controls-title">
            <div className="section-heading"><div><p className="context-line">Feasibility inputs</p><h2 id="plan-controls-title">Build a reviewed route</h2></div><p>Defaults come from the server.</p></div>
            <div className="control-grid">
              {([
                ["targetKg", "Target kg"], ["truckCapacityKg", "Truck capacity kg"],
                ["capacityBuffer", "Capacity buffer"], ["serviceMin", "Service min"],
                ["maxRadiusKm", "Maximum distance from plant (km)"],
              ] as const).map(([key, label]) => (
                <label className="field compact" key={key}><span>{label}</span><input type="number" min="0" step={key === "capacityBuffer" ? "0.01" : "1"} value={controls[key]} onChange={(event) => { const value = event.currentTarget.value; setControlsTouched(true); setControls((current) => ({ ...current, [key]: value })); }} /></label>
              ))}
              <label className="field compact"><span>Shift start</span><input type="time" value={controls.shiftStart} onChange={(event) => { const value = event.currentTarget.value; setControlsTouched(true); setControls((current) => ({ ...current, shiftStart: value })); }} /></label>
              <label className="field compact"><span>Shift end</span><input type="time" value={controls.shiftEnd} onChange={(event) => { const value = event.currentTarget.value; setControlsTouched(true); setControls((current) => ({ ...current, shiftEnd: value })); }} /></label>
              <button className="button button-primary" type="button" onClick={() => void replan()} disabled={planning || activePlan?.state === "DISPATCHED"}>{planning ? "Planning…" : activePlan?.state === "DISPATCHED" ? "Route frozen" : activePlan ? "Re-plan" : "Build plan"}</button>
            </div>
          </section>

          <section className="operations-grid" id="route-review">
            <div className="map-panel"><RouteMap points={points} roadRoute={activePlan?.roadRoute} /></div>
            <div className="plan-panel">
              <div className="section-heading"><div><p className="context-line">{activePlan?.state ?? "No draft"}</p><h2>Route review</h2></div>{activePlan && <span className={`status-badge status-${activePlan.status.toLowerCase()}`}>{activePlan.status.replaceAll("_", " ")}</span>}</div>
              {!activePlan ? <p className="empty-state">Build a plan from the current confirmations.</p> : (
                <>
                  <div className="metric-grid">
                    <div><span>Expected collected</span><strong>{formatKg(activePlan.plan.totals.expectedCollectionKg)}</strong></div>
                    <div><span>Reserved load</span><strong>{formatKg(activePlan.plan.totals.reservedLoadKg)}</strong></div>
                    <div><span>Actual picked</span><strong>{formatKg(actualPicked)}</strong></div>
                    <div><span>Net received</span><strong>{formatKg(execution?.reconciliation.netGateKg)}</strong></div>
                  </div>
                  <div className="trip-overview"><strong>{activePlan.plan.stops.length} stops · {activePlan.plan.totals.totalKm.toFixed(1)} km · {Math.round(activePlan.plan.totals.totalMin)} min</strong><span>Plant departure {activePlan.plan.startAt} · return {activePlan.plan.returnAt}</span><span>Shift {activePlan.params.shiftStart}–{activePlan.params.shiftEnd} · target {formatKg(activePlan.params.targetKg)}</span><span>Reserved {formatKg(activePlan.plan.totals.reservedLoadKg)} of {formatKg(activePlan.params.truckCapacityKg)} capacity</span></div>
                  <p className="assumption-note">Planning assumptions: {(activePlan.assumptions.readinessPrior * 100).toFixed(0)}% readiness prior, {(activePlan.assumptions.capacityBuffer * 100).toFixed(0)}% capacity buffer. Expected kg is a forecast; reserved kg protects capacity.</p>
                  {activePlan.shortfall.kg > 0 && <p className="shortfall">Short by {formatKg(activePlan.shortfall.kg)}. Constraints: {activePlan.shortfall.reasons.join(", ") || "available confirmed supply"}.</p>}
                  {activePlan.mandatoryConflicts.length > 0 && <p className="notice error">Mandatory conflicts: {activePlan.mandatoryConflicts.map((item) => `${item.generatorId} (${item.reason})`).join(", ")}. Dispatch is blocked.</p>}
                  <ol className="route-list">
                    <li className="depot-stop"><span className="stop-number plant-number">P</span><div><strong>Depart CBG plant</strong><span>{activePlan.plan.startAt} · {snapshot.depot.lat.toFixed(4)}, {snapshot.depot.lng.toFixed(4)}</span></div></li>
                    {activePlan.plan.stops.map((stop, index) => <li key={stop.generatorId}><span className="stop-number">{index + 1}</span><div><strong>{stop.name}</strong><span>{stop.address}</span>{activePlan.travelLegs?.[index] && <span>{activePlan.travelLegs[index].km.toFixed(1)} km · {Math.round(activePlan.travelLegs[index].min)} min travel from previous stop ({activePlan.travelLegs[index].source === "fallback" ? "estimated" : "road matrix"})</span>}<span>Arrival {stop.arrivalAt} · service {stop.serviceStartAt}–{stop.serviceEndAt}</span><span>Window {stop.window.start}–{stop.window.end} · {formatKg(stop.confirmedKg)} confirmed ({stop.weightSource.toLowerCase()})</span></div><div><strong>{formatKg(stop.expectedCollectionKg)} expected</strong><span>{formatKg(stop.reservedLoadKg)} reserved{stop.mandatory ? " · mandatory" : ""}</span></div></li>)}
                    <li className="depot-stop"><span className="stop-number plant-number">P</span><div><strong>Return to CBG plant</strong><span>{activePlan.plan.returnAt} · unload and record net intake</span></div></li>
                  </ol>
                  {(staleDraft || !controlsMatchPlan) && activePlan.state === "DRAFT" && <p className="notice warning">{staleDraft ? "Confirmations changed since this draft." : "Controls differ from the saved draft."} Re-plan before dispatch.</p>}
                  {account && activePlan.state === "DISPATCHED" && <DriverAssignment planKey={activePlan.planKey} />}
                  {activePlan.state === "DISPATCHED" && <button className="button button-secondary" disabled={dispatching} onClick={() => void renewAccess()}>Renew driver access</button>}
                  <div className="plan-actions">
                    <button className="button button-primary" type="button" onClick={() => void dispatch()} disabled={loading || dispatching || !controlsMatchPlan || activePlan.inputRevision !== snapshot.inputRevision || activePlan.status !== "FEASIBLE" || activePlan.mandatoryConflicts.length > 0 || activePlan.plan.stops.length === 0 || activePlan.state !== "DRAFT"}>{dispatching ? "Dispatching…" : activePlan.state === "DISPATCHED" ? "Dispatched" : "Dispatch reviewed version"}</button>
                    {activePlan.state === "DISPATCHED" && !account && !currentDriverAccess && <button className="button button-secondary" type="button" onClick={() => void dispatch()} disabled={dispatching}>Retrieve private driver link</button>}
                    {!account && currentDriverAccess && <button className="button button-secondary" type="button" onClick={() => void copyDriverLink()}>Copy private driver link</button>}
                  </div>
                  {activePlan.state === "DISPATCHED" && !account && !currentDriverAccess && <p className="muted">Retrieve the existing private driver link after a refresh. Its original expiry is retained; expired access requires operational support.</p>}
                  {!account && currentDriverAccess && <aside className="driver-handoff"><h3>Driver handoff</h3><p>Share the private link with the assigned driver. Ask them to check the stop windows, record every outcome while parked, and return to the plant.</p><p>Access expires {new Date(currentDriverAccess.expiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} India time.</p><button type="button" className="text-button" onClick={() => setDriverLinkVisible((value) => !value)}>{driverLinkVisible ? "Hide private link" : "Show private link for manual copy"}</button>{driverLinkVisible && <label className="field"><span>Private driver link · keep off public recordings</span><input readOnly value={driverLink} onFocus={(event) => event.currentTarget.select()} /></label>}</aside>}
                </>
              )}
            </div>
          </section>

          {activePlan && (
            <section className="comparison-panel">
              <div className="section-heading"><div><p className="context-line">Same inputs and constraints</p><h2>Planner comparison</h2></div><span className="data-tag">Matrix: {activePlan.matrixSource}</span></div>
              <table><thead><tr><th>Method</th><th>Expected kg</th><th>Reserved kg</th><th>Distance</th><th>Stops</th></tr></thead><tbody>
                <tr><th>FeedSure</th><td>{formatKg(activePlan.plan.totals.expectedCollectionKg)}</td><td>{formatKg(activePlan.plan.totals.reservedLoadKg)}</td><td>{activePlan.plan.totals.totalKm.toFixed(1)} km</td><td>{activePlan.plan.stops.length}</td></tr>
                <tr><th>Nearest-first</th><td>{formatKg(activePlan.baseline.totals.expectedCollectionKg)}</td><td>{formatKg(activePlan.baseline.totals.reservedLoadKg)}</td><td>{activePlan.baseline.totals.totalKm.toFixed(1)} km</td><td>{activePlan.baseline.stops.length}</td></tr>
              </tbody></table>
              <p className="muted">Ties and losses are shown as returned; no improvement is inferred.</p>
            </section>
          )}

          <section className="supply-panel" id="supply-actions">
            <div className="section-heading"><div><p className="context-line">Authoritative date snapshot</p><h2>Waste suppliers and next actions</h2></div><label className="field compact"><span>Show waste suppliers</span><select value={supplyFilter} onChange={(event) => setSupplyFilter(event.currentTarget.value)}><option value="all">All waste suppliers</option><option value="action">Need attention</option><option value="route">On this route</option></select></label></div>
            <p className="muted">Ready sites are considered automatically. Select Required pickup to ensure a promised site is included; a constraint conflict blocks dispatch.</p>
            {activePlan?.state === "DISPATCHED" && <p className="notice warning" id="route-locked">This trip has already been dispatched. Pickup choices are locked to protect the driver’s saved route. Choose another planning date for a new route; later confirmations do not add stops to this trip.</p>}
            <p className="muted">Plant: {snapshot.depot.lat.toFixed(5)}, {snapshot.depot.lng.toFixed(5)}. The distance limit uses the routing matrix, not a map circle. Check approximate PIN locations in My profile before dispatch.</p>
            <div className="supply-list">
              {snapshot.generators.filter((generator) => supplyFilter === "all" || (supplyFilter === "route"
                ? activePlan?.plan.stops.some((stop) => stop.generatorId === generator.generatorId)
                : generator.unresolvedHazards.length || generator.readinessStatus !== "READY" || activePlan?.excluded.some((item) => item.generatorId === generator.generatorId))).map((generator) => {
                const excluded = activePlan?.excluded.find((item) => item.generatorId === generator.generatorId);
                const hazardous = generator.unresolvedHazards.length > 0;
                const reason = currentExclusion(generator, activePlan, snapshot.inputRevision);
                const historical = activePlan && activePlan.inputRevision !== snapshot.inputRevision;
                const distance = activePlan?.plantDistances?.[generator.generatorId];
                return (
                  <article key={generator.generatorId}>
                    <div className="supply-main">
                      <label className="check-field"><input type="checkbox" aria-label={`Required pickup: ${generator.name}`} aria-describedby={activePlan?.state === "DISPATCHED" ? "route-locked" : undefined} disabled={planning || dispatching || activePlan?.state === "DISPATCHED"} checked={activePlan?.state === "DISPATCHED" ? activePlan.params.mandatoryIds.includes(generator.generatorId) : mandatoryIds.includes(generator.generatorId)} onChange={(event) => { const checked = event.currentTarget.checked; setControlsTouched(true); setMandatoryIds((current) => checked ? [...current, generator.generatorId] : current.filter((id) => id !== generator.generatorId)); }} /><span>Required pickup</span></label>
                      <div><strong>{generator.name}</strong><span>{generator.address}</span></div>
                      <span className={`status-badge readiness-${generator.readinessStatus.toLowerCase()}`}>{generator.readinessStatus}</span>
                      <div><strong>{formatKg(generator.readiness?.confirmedKg)}</strong><span>{generator.readiness?.window ? `${generator.readiness.window.start}–${generator.readiness.window.end}` : "No confirmed window"}</span></div>
                    </div>
                    {reason && <p className="next-action">{reason} · {exclusionAction(reason)}</p>}
                    {historical && excluded && <p className="notice warning">Saved {activePlan.state === "DISPATCHED" ? "dispatched trip" : "draft"} excluded this site: {excluded.reason}. Inputs have changed since that plan. Current readiness is shown above. {activePlan.state === "DISPATCHED" ? "Arrange a later collection; this trip stays frozen." : "Re-plan to use the updated confirmation."}</p>}
                    {distance != null && <p className="muted">Plant-to-site distance in saved plan: {distance.toFixed(1)} km · limit {activePlan?.params.maxRadiusKm} km · {activePlan?.matrixSource === "fallback" ? "estimated fallback, not measured road distance" : activePlan?.matrixSource}. Pickup: {generator.lat.toFixed(5)}, {generator.lng.toFixed(5)}.</p>}
                    {hazardous && <p className="hazard-detail">Unresolved hazard: {generator.unresolvedHazards.map((hazard) => hazard.reason).join("; ")}</p>}
                    {generator.readiness && <PhotoEvidence key={generator.readiness.submissionId} submission={generator.readiness} adminToken={adminToken} />}
                    <HazardReview key={`${date}:${generator.generatorId}:${generator.unresolvedHazards[0]?.hazardId ?? generator.lastHazardReview?.hazardId ?? "none"}`} generator={generator} date={date} token={adminToken} onSaved={() => setRefreshKey((value) => value + 1)} />
                    <div className="row-actions">
                      <button className="text-button" type="button" onClick={() => setPhone({ generatorId: generator.generatorId, status: "READY", kg: generator.readiness?.confirmedKg ? String(generator.readiness.confirmedKg) : "", source: generator.readiness?.weightSource ?? "ESTIMATE", start: generator.readiness?.window?.start ?? generator.pickupWindow.start, end: generator.readiness?.window?.end ?? generator.pickupWindow.end, confirmedBy: "", reason: "" })}>Record phone confirmation</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {phone && (
            <section className="inline-editor" ref={phoneEditor} aria-label="Phone confirmation editor">
              <form onSubmit={(event) => void submitPhone(event)}>
                <div className="section-heading"><div><p className="context-line">Attributable dispatcher call</p><h2>Phone confirmation</h2><p>{snapshot.generators.find((generator) => generator.generatorId === phone.generatorId)?.name} · {formatServiceDate(date)}</p></div><button className="text-button" type="button" onClick={() => setPhone(null)}>Cancel</button></div>
                <div className="control-grid">
                  <label className="field compact"><span>Status</span><select value={phone.status} onChange={(event) => setPhone({ ...phone, status: event.currentTarget.value as PhoneForm["status"] })}><option value="READY">Ready</option><option value="NOT_READY">Not ready</option></select></label>
                  {phone.status === "READY" && <><label className="field compact"><span>Confirmed kg</span><input type="number" min="0.1" value={phone.kg} onChange={(event) => setPhone({ ...phone, kg: event.currentTarget.value })} /></label><label className="field compact"><span>Source</span><select value={phone.source} onChange={(event) => setPhone({ ...phone, source: event.currentTarget.value as WeightSource })}><option value="SCALE">Scale</option><option value="ESTIMATE">Estimate</option></select></label><label className="field compact"><span>Window start</span><input type="time" value={phone.start} onChange={(event) => setPhone({ ...phone, start: event.currentTarget.value })} /></label><label className="field compact"><span>Window end</span><input type="time" value={phone.end} onChange={(event) => setPhone({ ...phone, end: event.currentTarget.value })} /></label></>}
                  <label className="field compact"><span>Confirmed by</span><input value={phone.confirmedBy} onChange={(event) => setPhone({ ...phone, confirmedBy: event.currentTarget.value })} /></label>
                  <label className="field compact"><span>Reason / call note</span><input value={phone.reason} onChange={(event) => setPhone({ ...phone, reason: event.currentTarget.value })} /></label>
                  <button className="button button-primary" type="submit">Save phone confirmation</button>
                </div>
              </form>
            </section>
          )}

          {activePlan?.state === "DISPATCHED" && execution && (
            <section className="reconciliation-panel" id="gate-record">
              <div>
                <p className="context-line">Trip reconciliation</p>
                <h2>{reconciliationLabel(execution.reconciliation.status)}</h2>
                <div className="metric-grid">
                  <div><span>Picked</span><strong>{formatKg(execution.reconciliation.pickedKg)}</strong></div>
                  <div><span>Net received</span><strong>{formatKg(execution.reconciliation.netGateKg)}</strong></div>
                  <div><span>Difference</span><strong>{formatKg(execution.reconciliation.deltaKg)}</strong></div>
                  <div><span>Difference %</span><strong>{formatPercent(execution.reconciliation.deltaPct)}</strong></div>
                </div>
                {execution.reconciliation.provisional && <p className="notice warning">Provisional: at least one pickup or gate value is estimated.</p>}
                {execution.reconciliation.pendingStopIds.length > 0 && <p>Pending outcomes: {execution.reconciliation.pendingStopIds.join(", ")}</p>}
                {execution.reconciliation.gpsFlags.some((flag) => flag.status !== "IN_RANGE") && <p>GPS evidence flags: {execution.reconciliation.gpsFlags.map((flag) => `${flag.generatorId} ${flag.status}`).join(", ")}. These are review cues, not fraud findings.</p>}
              </div>
              <div><h3>Plant owner intake</h3><p>The plant owner records received weight in the separate intake desk.</p><Link className="button button-secondary" to="/owner">Open plant owner desk</Link></div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
