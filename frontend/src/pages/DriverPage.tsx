import { useAccount } from "../auth";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  ApiError,
  DriverTripResponse,
  PickupRequest,
  PlanStop,
  WeightSource,
  createIdempotencyKey,
  getDriverTrip,
  savePickup,
} from "../api";
import { consumeBootstrapToken } from "../session";
import { PickupDraft, formatKg, formatServiceDate, pickupRequest, reconciliationLabel, requestGps, updatePickupDraft } from "../workflow";

const blankDraft = (): PickupDraft => ({
  outcome: "COLLECTED",
  kg: "",
  weightSource: "SCALE",
  reason: "",
  remainingKg: "",
  remainingUnknown: false,
  correctionReason: "",
});

interface PendingAttempt {
  request: PickupRequest;
  key: string;
  signature: string;
}

export function DriverPage() {
  const { account } = useAccount();
  const { planKey = "" } = useParams();
  const [token] = useState(() => account ? "supabase-account" : consumeBootstrapToken("t", `feedsure:driver:${planKey}`));
  const [trip, setTrip] = useState<DriverTripResponse | null>(null);
  const [forms, setForms] = useState<Record<string, PickupDraft>>({});
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(Boolean(token));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const pending = useRef<Record<string, PendingAttempt>>({});
  const saving = useRef(false);

  const load = (signal?: AbortSignal) => {
    if (!token || !planKey) return Promise.resolve();
    setLoading(true);
    setLoadError(null);
    return getDriverTrip(planKey, token, signal).then((response) => {
      if (signal?.aborted) return;
      setTrip(response);
      setForms((current) => {
        const next = { ...current };
        for (const stop of response.plan.plan.stops) {
          if (next[stop.generatorId]) continue;
          const saved = response.pickups.find((pickup) => pickup.generatorId === stop.generatorId);
          next[stop.generatorId] = saved
            ? {
                outcome: saved.outcome,
                kg: saved.kg ? String(saved.kg) : "",
                weightSource: saved.weightSource ?? "SCALE",
                reason: saved.reason ?? "",
                remainingKg: saved.remainingKg ? String(saved.remainingKg) : "",
                remainingUnknown: saved.remainingUnknown,
                correctionReason: "",
              }
            : blankDraft();
        }
        return next;
      });
    }).catch((error) => {
      if (signal?.aborted) return;
      if (error instanceof ApiError && error.code === "UNAUTHORIZED") {
        setLoadError("This private driver link is invalid or expired. Ask the dispatcher for a new link.");
      } else {
        setLoadError(error instanceof ApiError ? `${error.message} (${error.code})` : "Trip could not be loaded.");
      }
    }).finally(() => {
      if (!signal?.aborted) setLoading(false);
    });
  };

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [planKey, token]);

  const updateForm = <K extends keyof PickupDraft>(
    generatorId: string,
    key: K,
    value: PickupDraft[K],
  ) => {
    delete pending.current[generatorId];
    setForms((current) => ({
      ...current,
      [generatorId]: updatePickupDraft(current[generatorId] ?? blankDraft(), key, value),
    }));
    setErrors((current) => ({ ...current, [generatorId]: {} }));
    setMessages((current) => ({ ...current, [generatorId]: "" }));
  };

  const pickedKg = trip?.pickups.reduce((sum, pickup) => sum + pickup.kg, 0) ?? 0;
  const remainingCapacity = Math.max(0, (trip?.plan.params.truckCapacityKg ?? 0) - pickedKg);

  const save = async (event: FormEvent, stop: PlanStop) => {
    event.preventDefault();
    if (!trip || !token || saving.current) return;
    saving.current = true;
    setSavingId(stop.generatorId);
    const draft = forms[stop.generatorId] ?? blankDraft();
    const saved = trip.pickups.find((pickup) => pickup.generatorId === stop.generatorId);
    const existingAttempt = pending.current[stop.generatorId];
    let attempt = existingAttempt;
    if (!attempt) {
      setSavingId(stop.generatorId);
      setMessages((current) => ({ ...current, [stop.generatorId]: "Requesting location for this save…" }));
      const gpsAttempt = await requestGps();
      setMessages((current) => ({ ...current, [stop.generatorId]: gpsAttempt.message }));
      const normalized = pickupRequest(
        trip.plan.planKey,
        stop.generatorId,
        saved?.revision ?? 0,
        draft,
        gpsAttempt.gps,
      );
      setErrors((current) => ({ ...current, [stop.generatorId]: normalized.errors }));
      if (!normalized.request) {
        saving.current = false;
        setSavingId(null);
        return;
      }
      if (normalized.request.kg > remainingCapacity + (saved?.kg ?? 0)) {
        setErrors((current) => ({
          ...current,
          [stop.generatorId]: {
            kg: "This exceeds remaining physical capacity. Record only the quantity collected as PARTIAL and return later.",
          },
        }));
        saving.current = false;
        setSavingId(null);
        return;
      }
      const signature = JSON.stringify(normalized.request);
      attempt = {
        request: normalized.request,
        signature,
        key: createIdempotencyKey(`pickup:${stop.generatorId}`),
      };
      pending.current[stop.generatorId] = attempt;
    }

    setSavingId(stop.generatorId);
    try {
      const response = await savePickup(attempt.request, token, attempt.key);
      delete pending.current[stop.generatorId];
      setTrip((current) => current && {
        ...current,
        pickups: [
          ...current.pickups.filter((pickup) => pickup.generatorId !== stop.generatorId),
          response.pickup,
        ],
        reconciliation: response.reconciliation,
      });
      setForms((current) => ({
        ...current,
        [stop.generatorId]: { ...current[stop.generatorId], correctionReason: "" },
      }));
      setMessages((current) => ({
        ...current,
        [stop.generatorId]: `Saved by server at ${new Date(response.pickup.recordedAt).toLocaleTimeString()} · GPS ${response.pickup.gpsStatus}`,
      }));
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONFLICT") {
        delete pending.current[stop.generatorId];
      }
      const message = error instanceof ApiError
        ? error.code === "CONFLICT"
          ? "The trip or pickup revision changed. Refresh the trip before correcting; this save was not overwritten."
          : error.code === "UNAUTHORIZED"
            ? "Driver access expired. Ask the dispatcher for a new private link."
            : `${error.message} (${error.code}). Retry keeps the same event ID and payload.`
        : "Network save failed. Your form is preserved; retry keeps the same event ID and payload.";
      setMessages((current) => ({ ...current, [stop.generatorId]: message }));
    } finally {
      saving.current = false;
      setSavingId(null);
    }
  };

  if (!token) {
    return <DriverError message="This private driver link is missing its access token." />;
  }

  return (
    <main className="driver-shell">
      <header className="mobile-header">
        <Link className="brand" to="/"><span className="brand-mark">F</span><span>FeedSure driver</span></Link>
        <button className="text-button" type="button" onClick={() => void load()} disabled={loading || savingId !== null}>Refresh</button>
      </header>

      {loading && !trip && <p className="loading-line page-pad">Loading assigned trip…</p>}
      {loadError && <section className="page-error" role="alert"><h2>Trip refresh unavailable</h2><p>{loadError}</p><p>Any loaded trip and unsaved forms remain below.</p></section>}

      {trip && (
        <>
          <section className="driver-summary">
            <p className="context-line">Frozen dispatched trip</p>
            <h1>{formatServiceDate(trip.plan.collectionDate)}</h1>
            <div className="driver-metrics">
              <div><span>Version</span><strong>{trip.plan.version}</strong></div>
              <div><span>Picked</span><strong>{formatKg(pickedKg)}</strong></div>
              <div><span>Capacity left</span><strong>{formatKg(remainingCapacity)}</strong></div>
              <div><span>Outcomes recorded</span><strong>{trip.pickups.length} / {trip.plan.plan.stops.length}</strong></div>
            </div>
            <p className="driver-timing">Plant departure {trip.plan.plan.startAt} · return {trip.plan.plan.returnAt} · shift {trip.plan.params.shiftStart}–{trip.plan.params.shiftEnd} (India time)</p>
            <p>Record outcomes only while parked. Location is requested once when you save and never tracked continuously.</p>
            {trip.plan.simulated && <span className="data-tag">Simulated trip</span>}
          </section>

          {trip.alerts.map((alert) => <p className="notice warning" key={alert.code}>{alert.message} The frozen stops below have not changed.</p>)}

          <section className="driver-guide" aria-label="Trip instructions">
            <h2>Before loading</h2><p>Check the address and window. Inspect the waste in person and contact dispatch about unresolved hazards. A confirmation or photo is not a safety certificate.</p>
            <p>Use <strong>Partial</strong> if only some waste was collected. Use <strong>Visited — not ready</strong> only after a visit; use <strong>Skipped by collector</strong> for a missed stop. Keep physical load within truck capacity.</p>
            <nav className="driver-itinerary" aria-label="Jump to assigned stop">{trip.plan.plan.stops.map((stop, index) => <a href={`#stop-${index + 1}`} key={stop.generatorId}><b>{index + 1}</b><span>{stop.name}</span><small>{trip.pickups.some((pickup) => pickup.generatorId === stop.generatorId) ? "Recorded" : "Pending"}</small></a>)}</nav>
          </section>

          <section className="driver-stops" aria-label="Assigned stops">
            {trip.plan.plan.stops.map((stop, index) => {
              const draft = forms[stop.generatorId] ?? blankDraft();
              const saved = trip.pickups.find((pickup) => pickup.generatorId === stop.generatorId);
              const stopErrors = errors[stop.generatorId] ?? {};
              return (
                <article className="driver-stop" key={stop.generatorId} id={`stop-${index + 1}`}>
                  <header>
                    <span className="stop-number">{index + 1}</span>
                    <div>
                      <h2>{stop.name}</h2>
                      <p>{stop.address}</p>
                      <p>Arrival {stop.arrivalAt} · service {stop.serviceStartAt}–{stop.serviceEndAt}</p><p>Pickup window {stop.window.start}–{stop.window.end}{stop.mandatory ? " · promised pickup" : ""}</p>
                    </div>
                    <div className="driver-stop-quantity"><strong>{formatKg(stop.confirmedKg)} confirmed</strong><span>{stop.weightSource.toLowerCase()} · {formatKg(stop.reservedLoadKg)} reserved</span></div>
                  </header>

                  {saved && (
                    <p className="saved-strip">
                      Saved {saved.outcome.replaceAll("_", " ")} · {formatKg(saved.kg)} · revision {saved.revision}{saved.reason ? ` · ${saved.reason}` : ""}{saved.outcome === "PARTIAL" ? ` · remaining ${saved.remainingUnknown ? "unknown" : formatKg(saved.remainingKg)}` : ""}
                    </p>
                  )}

                  <form className="pickup-form" onSubmit={(event) => void save(event, stop)}>
                    <fieldset className="pickup-fields" disabled={savingId !== null}><legend className="sr-only">Outcome for {stop.name}</legend>
                    <label className="field">
                      <span>Outcome</span>
                      <select value={draft.outcome} onChange={(event) => updateForm(stop.generatorId, "outcome", event.currentTarget.value as PickupDraft["outcome"])}>
                        <option value="COLLECTED">Collected</option>
                        <option value="PARTIAL">Partial</option>
                        <option value="NOT_READY">Visited — not ready</option>
                        <option value="SKIPPED">Skipped by collector</option>
                      </select>
                    </label>

                    {(draft.outcome === "COLLECTED" || draft.outcome === "PARTIAL") && (
                      <div className="form-row">
                        <label className="field"><span>Collected kg</span><input type="number" inputMode="decimal" min="0.1" max="5000" step="0.1" value={draft.kg} onChange={(event) => updateForm(stop.generatorId, "kg", event.currentTarget.value)} /></label>
                        <label className="field"><span>Weight source</span><select value={draft.weightSource} onChange={(event) => updateForm(stop.generatorId, "weightSource", event.currentTarget.value as WeightSource)}><option value="SCALE">Scale</option><option value="ESTIMATE">Estimate</option></select></label>
                      </div>
                    )}

                    {draft.outcome !== "COLLECTED" && (
                      <label className="field"><span>Reason</span><textarea rows={2} value={draft.reason} onChange={(event) => updateForm(stop.generatorId, "reason", event.currentTarget.value)} /></label>
                    )}

                    {draft.outcome === "PARTIAL" && (
                      <div className="remaining-fields">
                        <label className="field"><span>Kg left behind</span><input type="number" inputMode="decimal" min="0.1" step="0.1" disabled={draft.remainingUnknown} value={draft.remainingKg} onChange={(event) => updateForm(stop.generatorId, "remainingKg", event.currentTarget.value)} /></label>
                        <label className="check-field"><input type="checkbox" checked={draft.remainingUnknown} onChange={(event) => updateForm(stop.generatorId, "remainingUnknown", event.currentTarget.checked)} /><span>Remaining quantity unknown</span></label>
                      </div>
                    )}

                    {saved && <label className="field"><span>Correction reason</span><textarea rows={2} value={draft.correctionReason} onChange={(event) => updateForm(stop.generatorId, "correctionReason", event.currentTarget.value)} /></label>}

                    {Object.values(stopErrors).map((message) => <p className="field-error" key={message}>{message}</p>)}
                    {messages[stop.generatorId] && <p className="save-message" aria-live="polite">{messages[stop.generatorId]}</p>}
                    <button className="button button-primary button-full" type="submit" disabled={savingId !== null}>
                      {savingId === stop.generatorId ? "Saving outcome…" : saved ? "Save correction" : "Save outcome"}
                    </button>
                    </fieldset>
                  </form>
                </article>
              );
            })}
          </section>
          <section className="driver-return"><span className="stop-number plant-number">P</span><div><h2>Return to the CBG plant</h2><p>Planned return {trip.plan.plan.returnAt}. Ask the intake operator to record net received waste weight.</p><strong>{reconciliationLabel(trip.reconciliation.status)}</strong><p>{trip.reconciliation.pendingStopIds.length ? `${trip.reconciliation.pendingStopIds.length} stop outcomes still need recording.` : "Every stop has a saved outcome."} {trip.gate ? `Net intake ${formatKg(trip.gate.netKg)}.` : "No gate weight has been recorded yet."}</p><small>Collection and intake records do not prove downstream processing.</small></div></section>
        </>
      )}
    </main>
  );
}

function DriverError({ message }: { message: string }) {
  return (
    <main className="driver-shell">
      <section className="page-error"><p className="context-line">Driver access</p><h1>Trip unavailable</h1><p>{message}</p></section>
    </main>
  );
}
