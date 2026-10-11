import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  ApiError,
  GeneratorProfile,
  GeneratorReceipt,
  Lang,
  ReadinessRecord,
  getGenerator,
  getGeneratorReceipts,
  saveReadiness,
} from "../api";
import { t } from "../i18n";
import { OptionalPhoto } from "../components/OptionalPhoto";
import { getKitchenReadiness } from "../photoApi";
import { consumeBootstrapToken } from "../session";
import { ReadinessDraft, monthForDate, readinessRequest, serviceDateInIndia } from "../workflow";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "UNAUTHORIZED" || error.code === "NOT_FOUND") {
      return "This private link is invalid or expired. Ask the dispatcher for a new link.";
    }
    return `${error.message} (${error.code})`;
  }
  return "The request could not be completed. Check the connection and try again.";
}

export function GeneratorPage() {
  const { id = "" } = useParams();
  const storageKey = `feedsure:generator:${id}`;
  const [token] = useState(() => consumeBootstrapToken("t", storageKey));
  const [profile, setProfile] = useState<GeneratorProfile | null>(null);
  const [receipts, setReceipts] = useState<GeneratorReceipt[]>([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [language, setLanguage] = useState<Lang>("en");
  const [draft, setDraft] = useState<ReadinessDraft>({
    generatorId: id,
    collectionDate: serviceDateInIndia(),
    status: "READY",
    confirmedKg: "",
    weightSource: "ESTIMATE",
    windowStart: "06:00",
    windowEnd: "09:00",
    reason: "",
    lang: "en",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<ReadinessRecord | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editing, setEditing] = useState(true);
  const saveGeneration = useRef(0);

  useEffect(() => {
    if (!token || !id) return;
    const controller = new AbortController();
    const generation = saveGeneration.current;
    setSaved(null);
    getKitchenReadiness(id, draft.collectionDate, token, controller.signal).then((result) => {
      if (controller.signal.aborted || generation !== saveGeneration.current) return;
      setSaved(result.submission);
      setEditing(!result.submission);
    }).catch(() => {});
    return () => controller.abort();
  }, [id, token, draft.collectionDate]);

  useEffect(() => {
    if (!token || !id) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    Promise.all([
      getGenerator(id, token, controller.signal),
      getGeneratorReceipts(id, token, monthForDate(draft.collectionDate), controller.signal),
    ]).then(([generatorResponse, receiptResponse]) => {
      const generator = generatorResponse.generator;
      setProfile(generator);
      setLanguage(generator.defaultLang);
      setDraft((current) => ({
        ...current,
        lang: generator.defaultLang,
        windowStart: generator.pickupWindow.start,
        windowEnd: generator.pickupWindow.end,
      }));
      setReceipts(receiptResponse.records);
    }).catch((error) => {
      if (!controller.signal.aborted) setLoadError(errorMessage(error));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [id, token]);

  const copy = t(language);
  const updateDraft = <K extends keyof ReadinessDraft>(key: K, value: ReadinessDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "", window: "" }));
    setSaveError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = readinessRequest({ ...draft, generatorId: id, lang: language });
    setErrors(normalized.errors);
    if (!normalized.request || !token) return;
    setSaving(true);
    saveGeneration.current += 1;
    setSaveError(null);
    try {
      const response = await saveReadiness(normalized.request, { generatorToken: token });
      setSaved(response.submission);
      setEditing(false);
      getGeneratorReceipts(id, token, monthForDate(draft.collectionDate))
        .then((receiptResponse) => setReceipts(receiptResponse.records)).catch(() => {});
    } catch (error) {
      setSaveError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (!token) {
    return (
      <main className="generator-shell">
        <header className="mobile-header"><Brand /></header>
        <section className="generator-step generator-error">
          <p className="context-line">Private link required</p>
          <h1>This link is not valid</h1>
          <p>Ask the dispatcher for your FeedSure kitchen link.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="generator-shell">
      <header className="mobile-header">
        <Brand />
        <button
          className="language-switch"
          type="button"
          onClick={() => {
            const next = language === "en" ? "hi" : "en";
            setLanguage(next);
            updateDraft("lang", next);
          }}
        >
          {language === "en" ? "EN / हिन्दी" : "हिन्दी / EN"}
        </button>
      </header>

      <section className="generator-step" aria-busy={loading}>
        {loading && <p className="loading-line">Loading kitchen details…</p>}
        {loadError && <p className="inline-error" role="alert">{loadError}</p>}

        {!loading && profile && (
          <>
            <p className="context-line">{profile.name}</p>
            <h1>{copy.readyQuestion}</h1>
            <p className="service-note">
              For {draft.collectionDate} in India time. Generator quantities are
              {profile.simulated ? " simulated for this demo." : " supplied by this kitchen."}
            </p>

            {saved && !editing ? (
              <section className="saved-readiness" aria-live="polite">
                <span className="complete-mark" aria-hidden="true">✓</span>
                <div>
                  <h2>{copy.saved}</h2>
                  <p>
                    {saved.collectionDate} · {saved.status === "READY"
                      ? `${saved.confirmedKg} kg · ${saved.window?.start}–${saved.window?.end}`
                      : copy.notReady}
                  </p>
                  {saved.late && <p>Saved after the normal cutoff; the dispatcher can still review it.</p>}
                  <p className="muted">
                    If a trip is already dispatched, this update creates a dispatcher alert and does
                    not automatically change the driver route.
                  </p>
                </div>
                <button className="button button-secondary" type="button" onClick={() => {
                  setDraft((current) => ({ ...current, status: saved.status,
                    confirmedKg: String(saved.confirmedKg), weightSource: saved.weightSource ?? "ESTIMATE",
                    windowStart: saved.window?.start ?? current.windowStart,
                    windowEnd: saved.window?.end ?? current.windowEnd, reason: saved.reason ?? "" }));
                  setEditing(true);
                }}>
                  {copy.edit}
                </button>
              </section>
            ) : (
              <form className="readiness-form" onSubmit={submit} noValidate>
                <label className="field">
                  <span>{copy.date}</span>
                  <input
                    type="date"
                    value={draft.collectionDate}
                    onChange={(event) => updateDraft("collectionDate", event.currentTarget.value)}
                    aria-invalid={Boolean(errors.collectionDate)}
                  />
                  {errors.collectionDate && <small className="field-error">{errors.collectionDate}</small>}
                </label>

                <fieldset className="choice-field">
                  <legend>{copy.readyQuestion}</legend>
                  <div className="segmented">
                    {(["READY", "NOT_READY"] as const).map((status) => (
                      <button
                        key={status}
                        className={draft.status === status ? "selected" : ""}
                        type="button"
                        aria-pressed={draft.status === status}
                        onClick={() => updateDraft("status", status)}
                      >
                        {status === "READY" ? copy.ready : copy.notReady}
                      </button>
                    ))}
                  </div>
                </fieldset>

                {draft.status === "READY" ? (
                  <>
                    <label className="field">
                      <span>{copy.quantity}</span>
                      <span className="unit-input">
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0.1"
                          max="5000"
                          step="0.1"
                          value={draft.confirmedKg}
                          onChange={(event) => updateDraft("confirmedKg", event.currentTarget.value)}
                          aria-invalid={Boolean(errors.confirmedKg)}
                        />
                        <strong>kg</strong>
                      </span>
                      {errors.confirmedKg && <small className="field-error">{errors.confirmedKg}</small>}
                      <small>Editable guidance only; enter the kitchen’s current estimate or scale reading.</small>
                    </label>

                    <fieldset className="choice-field">
                      <legend>{copy.source}</legend>
                      <div className="segmented">
                        {(["SCALE", "ESTIMATE"] as const).map((source) => (
                          <button
                            key={source}
                            className={draft.weightSource === source ? "selected" : ""}
                            type="button"
                            aria-pressed={draft.weightSource === source}
                            onClick={() => updateDraft("weightSource", source)}
                          >
                            {source === "SCALE" ? copy.scale : copy.estimate}
                          </button>
                        ))}
                      </div>
                    </fieldset>

                    <fieldset className="choice-field">
                      <legend>{copy.window}</legend>
                      <div className="time-fields">
                        <label><span>Start</span><input type="time" value={draft.windowStart} onChange={(event) => updateDraft("windowStart", event.currentTarget.value)} /></label>
                        <label><span>End</span><input type="time" value={draft.windowEnd} onChange={(event) => updateDraft("windowEnd", event.currentTarget.value)} /></label>
                      </div>
                      {errors.window && <small className="field-error">{errors.window}</small>}
                    </fieldset>
                  </>
                ) : (
                  <label className="field">
                    <span>{copy.reason}</span>
                    <textarea
                      rows={3}
                      value={draft.reason}
                      onChange={(event) => updateDraft("reason", event.currentTarget.value)}
                      placeholder="Kitchen closed, no waste today…"
                    />
                  </label>
                )}


                {saveError && <p className="inline-error" role="alert">{saveError}</p>}
                <button className="button button-primary button-full" type="submit" disabled={saving}>
                  {saving ? copy.saving : saveError ? copy.retry : copy.save}
                </button>
              </form>
            )}

            <OptionalPhoto generatorId={id} token={token} language={language}
              submission={editing ? null : saved} onSaved={(record) => setSaved((current) =>
                current?.submissionId === saved?.submissionId ? record : current)} />

            <section className="records-section" aria-labelledby="records-title">
              <div className="section-heading">
                <div>
                  <p className="context-line">Own kitchen only</p>
                  <h2 id="records-title">{copy.records}</h2>
                </div>
                <span className="data-tag">{profile.simulated ? "Simulated data" : "Operational record"}</span>
              </div>
              {receipts.length === 0 ? (
                <p className="empty-state">{copy.noRecords}</p>
              ) : (
                <div className="record-list">
                  {receipts.map((record) => (
                    <article key={`${record.planKey}:${record.pickup.revision}`}>
                      <div>
                        <strong>{record.collectionDate}</strong>
                        <span>{record.pickup.outcome}</span>
                      </div>
                      <p>{record.pickup.kg} kg · {record.pickup.weightSource ?? "No weight source"}</p>
                      <p>
                        Trip gate: {record.gateRecorded ? record.gateStatus.replaceAll("_", " ") : "not recorded"}
                        {record.provisional ? " · provisional" : ""}
                      </p>
                      <small>This is a pickup and trip-level gate record, not a processing certificate.</small>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </section>
    </main>
  );
}

function Brand() {
  return (
    <Link className="brand" to="/">
      <span className="brand-mark" aria-hidden="true">F</span>
      <span>FeedSure</span>
    </Link>
  );
}
