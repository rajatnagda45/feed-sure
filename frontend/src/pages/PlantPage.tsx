import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  ApiError,
  GateRequest,
  OperationGenerator,
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
  recordHazardReview,
  saveGate,
  saveReadiness,
} from "../api";
import { RouteMap } from "../components/RouteMap";
import {
  exclusionAction,
  formatKg,
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
  if (error instanceof ApiError) return `${error.message} (${error.code})`;
  return "The request failed. Check the API connection and try again.";
}

export function PlantPage() {
  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem("feedsure:admin") ?? "");
  const [tokenDraft, setTokenDraft] = useState("");
  const [date, setDate] = useState(serviceDateInIndia());
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
  const [hazardReasons, setHazardReasons] = useState<Record<string, string>>({});
  const [driverAccess, setDriverAccess] = useState<{ token: string; expiresAt: string } | null>(null);
  const [gate, setGate] = useState({ netKg: "", source: "SCALE" as WeightSource, reference: "", correctionReason: "" });
  const [gateSaving, setGateSaving] = useState(false);
  const dispatchAttempt = useRef<{ signature: string; key: string } | null>(null);
  const gateAttempt = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    if (!adminToken) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setMessage(null);
    Promise.all([
      getOperations(date, adminToken, controller.signal),
      getLatestPlan(date, adminToken, controller.signal),
    ]).then(async ([operations, latest]) => {
      if (controller.signal.aborted) return;
      setSnapshot(operations);
      if (!controlsTouched) setControls(controlsFrom(operations.defaults));
      setMandatoryIds((current) => current.filter((id) => operations.generators.some((g) => g.generatorId === id)));
      setPlan(latest.plan);
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
    () => planMapPoints(activePlan, snapshot?.generators ?? [], snapshot?.depot ?? null),
    [activePlan, snapshot],
  );
  const statusCounts = snapshot?.generators.reduce<Record<string, number>>((counts, generator) => {
    counts[generator.readinessStatus] = (counts[generator.readinessStatus] ?? 0) + 1;
    if (generator.unresolvedHazards.length) counts.HAZARD = (counts.HAZARD ?? 0) + 1;
    return counts;
  }, {}) ?? {};
  const actualPicked = execution?.pickups.reduce((sum, pickup) => sum + pickup.kg, 0) ?? null;

  const authenticate = (event: FormEvent) => {
    event.preventDefault();
    const value = tokenDraft.trim();
    if (!value) return;
    sessionStorage.setItem("feedsure:admin", value);
    setAdminToken(value);
    setTokenDraft("");
  };

  const clearToken = () => {
    sessionStorage.removeItem("feedsure:admin");
    setAdminToken("");
    setSnapshot(null);
    setPlan(null);
    setDetails(null);
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
    const signature = JSON.stringify(request);
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
      setDriverAccess(response.driverAccess);
      setMessage("Trip dispatched and frozen. Kitchen edits now appear as alerts.");
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

  const copyDriverLink = async () => {
    if (!driverAccess || !activePlan) return;
    const link = `${window.location.origin}/driver/${encodeURIComponent(activePlan.planKey)}?t=${encodeURIComponent(driverAccess.token)}`;
    try {
      await navigator.clipboard.writeText(link);
      setMessage(`Private driver link copied. It expires at ${new Date(driverAccess.expiresAt).toLocaleString()}.`);
    } catch {
      setError("Clipboard access was unavailable. Keep this page open and copy the private link manually from a supported browser.");
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

  const updateHazard = async (generator: OperationGenerator) => {
    if (!adminToken) return;
    const reason = (hazardReasons[generator.generatorId] ?? "").trim();
    if (!reason) {
      setError("Add a reason before entering or resolving a hazard.");
      return;
    }
    const action = generator.unresolvedHazards.length ? "RESOLVE" : "ENTER";
    try {
      await recordHazardReview(generator.generatorId, adminToken, { collectionDate: date, action, reason });
      setHazardReasons((current) => ({ ...current, [generator.generatorId]: "" }));
      setMessage(action === "RESOLVE" ? "Hazard resolved. Re-plan with the new input revision." : "Hazard recorded. The kitchen is held from planning.");
      setRefreshKey((value) => value + 1);
    } catch (reasonValue) {
      setError(displayError(reasonValue));
    }
  };

  const saveGateLog = async (event: FormEvent) => {
    event.preventDefault();
    if (!activePlan || !adminToken) return;
    const netKg = Number(gate.netKg);
    if (!Number.isFinite(netKg) || netKg < 0) {
      setError("Enter a valid net received weight of zero or more.");
      return;
    }
    const existing = execution?.gate;
    if (existing && !gate.correctionReason.trim()) {
      setError("A correction reason is required to replace a saved gate record.");
      return;
    }
    const request: GateRequest = {
      planKey: activePlan.planKey,
      netKg,
      weightSource: gate.source,
      reference: gate.reference.trim() || null,
      expectedRevision: existing?.revision ?? 0,
      ...(existing ? { correctionReason: gate.correctionReason.trim() } : {}),
    };
    const signature = JSON.stringify(request);
    if (!gateAttempt.current || gateAttempt.current.signature !== signature) {
      gateAttempt.current = { signature, key: createIdempotencyKey("gate") };
    }
    setGateSaving(true);
    setError(null);
    try {
      await saveGate(request, adminToken, gateAttempt.current.key);
      gateAttempt.current = null;
      setGate((current) => ({ ...current, correctionReason: "" }));
      setMessage("Net received weight saved. Received does not mean processed.");
      setRefreshKey((value) => value + 1);
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "CONFLICT") {
        gateAttempt.current = null;
        setError("The gate revision changed. Current server values are being refreshed; review them before saving the correction again.");
        setRefreshKey((value) => value + 1);
      } else {
        setError(displayError(reason) + " Retrying unchanged values uses the same gate event ID.");
      }
    } finally {
      setGateSaving(false);
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
          <button className="text-button" type="button" onClick={clearToken}>Lock</button>
        </div>
      </header>

      <section className="operations-toolbar">
        <label className="field compact"><span>Planning date</span><input type="date" value={date} onChange={(event) => { setDate(event.currentTarget.value); setControlsTouched(false); setMandatoryIds([]); }} /></label>
        <button className="button button-secondary" type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}>Refresh data</button>
        {snapshot && <div className="mode-line"><span>Database {snapshot.serviceMode.database}</span><span>Matrix {activePlan?.matrixSource ?? snapshot.serviceMode.matrix}</span><span>Screening {snapshot.serviceMode.screening}</span></div>}
      </section>

      {loading && <p className="loading-line page-pad">Refreshing authoritative operations data…</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice success" aria-live="polite">{message}</p>}
      {details?.alerts.map((alert) => <p className="notice warning" key={alert.code}>{alert.message} The dispatched route remains frozen.</p>)}

      {snapshot && (
        <>
          <section className="status-rail" aria-label="Supply status">
            <div><span>Ready</span><strong>{statusCounts.READY ?? 0}</strong></div>
            <div><span>Not ready</span><strong>{statusCounts.NOT_READY ?? 0}</strong></div>
            <div><span>Unconfirmed</span><strong>{statusCounts.UNCONFIRMED ?? 0}</strong></div>
            <div><span>Hazard holds</span><strong>{statusCounts.HAZARD ?? 0}</strong></div>
            <div><span>Input revision</span><strong>{snapshot.inputRevision}</strong></div>
          </section>

          <section className="planner-controls" aria-labelledby="plan-controls-title">
            <div className="section-heading"><div><p className="context-line">Feasibility inputs</p><h2 id="plan-controls-title">Build a reviewed route</h2></div><p>Defaults come from the server.</p></div>
            <div className="control-grid">
              {([
                ["targetKg", "Target kg"], ["truckCapacityKg", "Truck capacity kg"],
                ["capacityBuffer", "Capacity buffer"], ["serviceMin", "Service min"],
                ["maxRadiusKm", "Maximum radius km"],
              ] as const).map(([key, label]) => (
                <label className="field compact" key={key}><span>{label}</span><input type="number" min="0" step={key === "capacityBuffer" ? "0.01" : "1"} value={controls[key]} onChange={(event) => { setControlsTouched(true); setControls((current) => ({ ...current, [key]: event.currentTarget.value })); }} /></label>
              ))}
              <label className="field compact"><span>Shift start</span><input type="time" value={controls.shiftStart} onChange={(event) => { setControlsTouched(true); setControls((current) => ({ ...current, shiftStart: event.currentTarget.value })); }} /></label>
              <label className="field compact"><span>Shift end</span><input type="time" value={controls.shiftEnd} onChange={(event) => { setControlsTouched(true); setControls((current) => ({ ...current, shiftEnd: event.currentTarget.value })); }} /></label>
              <button className="button button-primary" type="button" onClick={() => void replan()} disabled={planning}>{planning ? "Planning…" : activePlan ? "Re-plan" : "Build plan"}</button>
            </div>
          </section>

          <section className="operations-grid">
            <div className="map-panel"><RouteMap points={points} /></div>
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
                  {activePlan.shortfall.kg > 0 && <p className="shortfall">Short by {formatKg(activePlan.shortfall.kg)}. Constraints: {activePlan.shortfall.reasons.join(", ") || "available confirmed supply"}.</p>}
                  {activePlan.mandatoryConflicts.length > 0 && <p className="notice error">Mandatory conflicts: {activePlan.mandatoryConflicts.map((item) => `${item.generatorId} (${item.reason})`).join(", ")}. Dispatch is blocked.</p>}
                  <ol className="route-list">
                    {activePlan.plan.stops.map((stop) => <li key={stop.generatorId}><span className="stop-number">{activePlan.plan.stops.indexOf(stop) + 1}</span><div><strong>{stop.name}</strong><span>{stop.serviceStartAt}–{stop.serviceEndAt} · window {stop.window.start}–{stop.window.end}</span></div><div><strong>{formatKg(stop.expectedCollectionKg)}</strong><span>{formatKg(stop.reservedLoadKg)} reserved{stop.mandatory ? " · mandatory" : ""}</span></div></li>)}
                  </ol>
                  <div className="plan-actions">
                    <button className="button button-primary" type="button" onClick={() => void dispatch()} disabled={dispatching || activePlan.status !== "FEASIBLE" || activePlan.mandatoryConflicts.length > 0 || activePlan.plan.stops.length === 0 || activePlan.state !== "DRAFT"}>{dispatching ? "Dispatching…" : activePlan.state === "DISPATCHED" ? "Dispatched" : "Dispatch reviewed version"}</button>
                    {driverAccess && <button className="button button-secondary" type="button" onClick={() => void copyDriverLink()}>Copy private driver link</button>}
                  </div>
                  {activePlan.state === "DISPATCHED" && !driverAccess && <p className="muted">Driver access is only returned during authenticated dispatch issuance. Replaced or expired links require dispatcher re-issuance.</p>}
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

          <section className="supply-panel">
            <div className="section-heading"><div><p className="context-line">Authoritative date snapshot</p><h2>Kitchens and next actions</h2></div></div>
            <div className="supply-list">
              {snapshot.generators.map((generator) => {
                const excluded = activePlan?.excluded.find((item) => item.generatorId === generator.generatorId);
                const hazardous = generator.unresolvedHazards.length > 0;
                return (
                  <article key={generator.generatorId}>
                    <div className="supply-main">
                      <label className="check-field"><input type="checkbox" checked={mandatoryIds.includes(generator.generatorId)} onChange={(event) => setMandatoryIds((current) => event.currentTarget.checked ? [...current, generator.generatorId] : current.filter((id) => id !== generator.generatorId))} /><span>Mandatory</span></label>
                      <div><strong>{generator.name}</strong><span>{generator.address}</span></div>
                      <span className={`status-badge readiness-${generator.readinessStatus.toLowerCase()}`}>{generator.readinessStatus}</span>
                      <div><strong>{formatKg(generator.readiness?.confirmedKg)}</strong><span>{generator.readiness?.window ? `${generator.readiness.window.start}–${generator.readiness.window.end}` : "No confirmed window"}</span></div>
                    </div>
                    {(excluded || hazardous) && <p className="next-action">{excluded?.reason ?? "HAZARD_REVIEW"} · {exclusionAction(excluded?.reason ?? "HAZARD_REVIEW")}</p>}
                    <div className="row-actions">
                      <button className="text-button" type="button" onClick={() => setPhone({ generatorId: generator.generatorId, status: "READY", kg: generator.readiness?.confirmedKg ? String(generator.readiness.confirmedKg) : "", source: generator.readiness?.weightSource ?? "ESTIMATE", start: generator.readiness?.window?.start ?? generator.pickupWindow.start, end: generator.readiness?.window?.end ?? generator.pickupWindow.end, confirmedBy: "", reason: "" })}>Record phone confirmation</button>
                      <input aria-label={`Hazard reason for ${generator.name}`} placeholder={hazardous ? "Resolution reason" : "Hazard reason"} value={hazardReasons[generator.generatorId] ?? ""} onChange={(event) => setHazardReasons((current) => ({ ...current, [generator.generatorId]: event.currentTarget.value }))} />
                      <button className="text-button" type="button" onClick={() => void updateHazard(generator)}>{hazardous ? "Resolve hazard" : "Record hazard"}</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {phone && (
            <section className="inline-editor">
              <form onSubmit={(event) => void submitPhone(event)}>
                <div className="section-heading"><div><p className="context-line">Attributable dispatcher call</p><h2>Phone confirmation</h2></div><button className="text-button" type="button" onClick={() => setPhone(null)}>Cancel</button></div>
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
            <section className="reconciliation-panel">
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
              <form className="gate-form" onSubmit={(event) => void saveGateLog(event)}>
                <h3>Record net plant intake</h3>
                <label className="field"><span>Net received kg</span><input type="number" min="0" step="0.1" value={gate.netKg} onChange={(event) => { setGate((current) => ({ ...current, netKg: event.currentTarget.value })); gateAttempt.current = null; }} /></label>
                <label className="field"><span>Weight source</span><select value={gate.source} onChange={(event) => { setGate((current) => ({ ...current, source: event.currentTarget.value as WeightSource })); gateAttempt.current = null; }}><option value="SCALE">Scale</option><option value="ESTIMATE">Estimate</option></select></label>
                <label className="field"><span>Weighbridge reference (optional)</span><input value={gate.reference} onChange={(event) => { setGate((current) => ({ ...current, reference: event.currentTarget.value })); gateAttempt.current = null; }} /></label>
                {execution.gate && <label className="field"><span>Correction reason</span><input value={gate.correctionReason} onChange={(event) => { setGate((current) => ({ ...current, correctionReason: event.currentTarget.value })); gateAttempt.current = null; }} /></label>}
                <button className="button button-primary button-full" type="submit" disabled={gateSaving}>{gateSaving ? "Saving gate record…" : execution.gate ? "Save gate correction" : "Save gate record"}</button>
                <small>Received weight is not a claim that the load was processed.</small>
              </form>
            </section>
          )}
        </>
      )}
    </main>
  );
}
