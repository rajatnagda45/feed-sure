import { normalizeLanguage } from "../language";
import { useAccount } from "../auth";
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
import { WasteGuide } from "../components/WasteGuide";
import { wasteCopy } from "../wasteCopy";
import { getKitchenReadiness } from "../photoApi";
import { consumeBootstrapToken } from "../session";
import { ReadinessDraft, formatServiceDate, isCollectionDate, monthForDate, readinessRequest, serviceDateInIndia } from "../workflow";

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
  const { account } = useAccount();
  const { id = "" } = useParams();
  const storageKey = `feedsure:generator:${id}`;
  const [token] = useState(() => account ? "supabase-account" : consumeBootstrapToken("t", storageKey));
  const [profile, setProfile] = useState<GeneratorProfile | null>(null);
  const [receipts, setReceipts] = useState<GeneratorReceipt[]>([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [recordsRefreshKey, setRecordsRefreshKey] = useState(0);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [readinessLoading, setReadinessLoading] = useState(false);
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
    if (!isCollectionDate(draft.collectionDate)) {
      setReadinessLoading(false);
      setReadinessError(null);
      return;
    }
    const controller = new AbortController();
    const generation = saveGeneration.current;
    setReadinessLoading(true);
    setReadinessError(null);
    setSaved(null);
    getKitchenReadiness(id, draft.collectionDate, token, controller.signal).then((result) => {
      if (controller.signal.aborted || generation !== saveGeneration.current) return;
      setSaved(result.submission);
      setEditing(!result.submission);
    }).catch(() => {
      if (!controller.signal.aborted) setReadinessError("Could not retrieve the saved confirmation. Retry before entering another confirmation.");
    }).finally(() => { if (!controller.signal.aborted) setReadinessLoading(false); });
    return () => controller.abort();
  }, [id, token, draft.collectionDate, refreshKey]);

  useEffect(() => {
    if (!token || !id) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    getGenerator(id, token, controller.signal).then((generatorResponse) => {
      const generator = generatorResponse.generator;
      if (controller.signal.aborted) return;
      setProfile(generator);
      setLanguage(normalizeLanguage(generator.defaultLang));
      setDraft((current) => ({
        ...current,
        lang: normalizeLanguage(generator.defaultLang),
        windowStart: generator.pickupWindow.start,
        windowEnd: generator.pickupWindow.end,
      }));
    }).catch((error) => {
      if (!controller.signal.aborted) setLoadError(errorMessage(error));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [id, token]);

  useEffect(() => {
    if (!token || !id) return;
    if (!isCollectionDate(draft.collectionDate)) {
      setRecordsLoading(false);
      return;
    }
    const controller = new AbortController();
    setRecordsError(null);
    setRecordsLoading(true);
    getGeneratorReceipts(id, token, monthForDate(draft.collectionDate), controller.signal)
      .then((response) => { if (!controller.signal.aborted) setReceipts(response.records); })
      .catch(() => { if (!controller.signal.aborted) setRecordsError("Collection records could not be refreshed. Retry to see the latest trip status."); })
      .finally(() => { if (!controller.signal.aborted) setRecordsLoading(false); });
    return () => controller.abort();
  }, [id, token, draft.collectionDate, recordsRefreshKey]);

  const copy = t(language);
  const words = wasteCopy(language);
  const preview = readinessRequest({ ...draft, lang: language });
  const updateDraft = <K extends keyof ReadinessDraft>(key: K, value: ReadinessDraft[K]) => {
    if (key === "collectionDate" && value === draft.collectionDate) return;
    if (key === "collectionDate") {
      setSaved(null);
      setEditing(true);
    }
    setDraft((current) => ({ ...current, [key]: value,
      ...(key === "collectionDate" ? { confirmedKg: "", reason: "" } : {}) }));
    setErrors((current) => ({ ...current, [key]: "", window: "" }));
    setSaveError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = readinessRequest({ ...draft, generatorId: id, lang: language });
    setErrors(normalized.errors);
    if (!normalized.request || !token) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
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
          <p>Ask the dispatcher for your FeedSure waste supplier link.</p>
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
          disabled={saving}
          onClick={() => {
            const next = language === "en" ? "hi" : "en";
            setLanguage(next);
            updateDraft("lang", next);
          }}
        >
          {language === "en" ? "EN / हिन्दी" : "हिन्दी / EN"}
        </button>
      </header>

      <section className="generator-step waste-step" lang={language} aria-busy={loading}>
        {loading && <p className="loading-line">Loading waste supplier details…</p>}
        {loadError && <><p className="inline-error" role="alert">{loadError}</p><button className="button button-secondary" type="button" onClick={() => window.location.reload()}>Retry waste supplier access</button></>}

        {!loading && profile && (
          <>
            <h1>{words.title}</h1>
            <p className="waste-intro">{words.intro}</p>
            <p className="service-note">
              <strong>{isCollectionDate(draft.collectionDate) ? formatServiceDate(draft.collectionDate) : "—"}</strong> ({words.indiaTime}). {profile.simulated ? words.simulated : words.reported}
            </p>

            <nav className="waste-flow" aria-label={words.title}>
              <a href="#collection-details"><span aria-hidden="true">1</span>{words.details}</a>
              <span><span aria-hidden="true">2</span>{words.optionalPhoto}</span>
              <a href="#records-title"><span aria-hidden="true">3</span>{words.record}</a>
            </nav>
            <div className="waste-layout">
            <div className="waste-workspace" id="collection-details">
            <div className="waste-site"><strong>{words.site}: {profile.name}</strong><p>{profile.address}</p><small>{words.siteHint}</small>
              {profile.locationSource && <details className="waste-site-source">
                <summary>{words.locationReference}</summary>
                <a href={profile.locationSource.url} target="_blank" rel="noreferrer">OpenStreetMap</a>{" · "}
                <a href={profile.locationSource.copyrightUrl} target="_blank" rel="noreferrer">{profile.locationSource.attribution} · ODbL</a>
                <p>{words.locationDisclaimer}</p>
              </details>}
            </div>
            <fieldset className="waste-date" disabled={saving}>
              <legend>{copy.date}</legend>
              <div className="waste-date-controls">
                <div className="segmented">
                  {([0, 1] as const).map((offset) => <button key={offset} type="button"
                    className={draft.collectionDate === serviceDateInIndia(new Date(), offset) ? "selected" : ""}
                    aria-pressed={draft.collectionDate === serviceDateInIndia(new Date(), offset)}
                    onClick={() => updateDraft("collectionDate", serviceDateInIndia(new Date(), offset))}>
                    {offset === 0 ? words.today : words.tomorrow}</button>)}
                </div>
                <input type="date" aria-label={copy.date} value={draft.collectionDate}
                  onChange={(event) => updateDraft("collectionDate", event.currentTarget.value)}
                  aria-invalid={Boolean(errors.collectionDate)} aria-describedby="date-help" />
              </div>
              <small id="date-help">{errors.collectionDate ? words.dateError : words.dateHint}</small>
            </fieldset>
            {readinessLoading ? <p role="status">Checking saved readiness…</p> : readinessError ? <div><p className="inline-error" role="alert">{readinessError}</p><button className="button button-secondary" type="button" onClick={() => setRefreshKey((key) => key + 1)}>Retry saved readiness</button></div> : saved && !editing ? (
              <section className="saved-readiness" aria-live="polite">
                <span className="complete-mark" aria-hidden="true">✓</span>
                <div>
                  <h2>{words.saved}</h2>
                  <p>
                    {saved.collectionDate} · {saved.status === "READY"
                      ? `${saved.confirmedKg} kg · ${saved.window?.start}–${saved.window?.end}`
                      : copy.notReady}
                  </p>
                  {saved.weightSource && <p>{words.recordedSource}: {saved.weightSource === "SCALE" ? copy.scale : copy.estimate}. {words.savedTime}: {new Date(saved.recordedAt).toLocaleString(language === "hi" ? "hi-IN" : "en-IN", { timeZone: "Asia/Kolkata" })}.</p>}
                  {saved.status === "NOT_READY" && saved.reason && <p>{words.savedReason}: {saved.reason}</p>}
                  {saved.late && <p>Saved after the normal cutoff; the dispatcher can still review it.</p>}
                  <h3 className="waste-next-title">{words.next}</h3>
                  <p>{saved.status === "READY" ? words.nextReady : words.nextNotReady}</p>
                  <p className="muted">{words.dispatched}</p>
                </div>
                <button className="button button-secondary" type="button" onClick={() => {
                  setDraft((current) => ({ ...current, status: saved.status,
                    confirmedKg: String(saved.confirmedKg), weightSource: saved.weightSource ?? "ESTIMATE",
                    windowStart: saved.window?.start ?? current.windowStart,
                    windowEnd: saved.window?.end ?? current.windowEnd, reason: saved.reason ?? "" }));
                  setEditing(true);
                }}>
                  {words.edit}
                </button>
              </section>
            ) : (
              <form className="readiness-form" onSubmit={submit} noValidate>
                <fieldset className="readiness-fields" disabled={saving}>
                <legend className="visually-hidden">{words.details}</legend>

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
                  <small>{words.readyHint}</small>
                </fieldset>

                {draft.status === "READY" ? (
                  <>
                    <label className="field">
                      <span>{words.amount} <small>({words.quantity})</small></span>
                      <span className="unit-input">
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0.1"
                          max="5000"
                          step="0.1"
                          placeholder="0"
                          aria-describedby="quantity-help quantity-error"
                          value={draft.confirmedKg}
                          onChange={(event) => updateDraft("confirmedKg", event.currentTarget.value)}
                          aria-invalid={Boolean(errors.confirmedKg)}
                        />
                        <strong>kg</strong>
                      </span>
                      <small id="quantity-error" className="field-error">{errors.confirmedKg ? words.quantityError : ""}</small>
                      <small id="quantity-help">{words.quantityHint}</small>
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
                            {source === "SCALE" ? words.scale : words.estimate}
                          </button>
                        ))}
                      </div>
                      <small>{words.sourceHint}</small>
                    </fieldset>

                    <fieldset className="choice-field">
                      <legend>{words.time}</legend>
                      <div className="time-fields">
                        <label><span>{words.from}</span><input type="time" value={draft.windowStart} aria-invalid={Boolean(errors.window)} aria-describedby="window-help window-error" onChange={(event) => updateDraft("windowStart", event.currentTarget.value)} /></label>
                        <label><span>{words.until}</span><input type="time" value={draft.windowEnd} aria-invalid={Boolean(errors.window)} aria-describedby="window-help window-error" onChange={(event) => updateDraft("windowEnd", event.currentTarget.value)} /></label>
                      </div>
                      <small id="window-help">{words.timeHint}</small>
                      <small id="window-error" className="field-error">{errors.window ? words.windowError : ""}</small>
                    </fieldset>
                  </>
                ) : (
                  <label className="field">
                    <span>{copy.reason}</span>
                    <small>{words.notReadyHint}</small>
                    <textarea
                      rows={3}
                      value={draft.reason}
                      onChange={(event) => updateDraft("reason", event.currentTarget.value)}
                      placeholder={words.reasonPlaceholder}
                    />
                  </label>
                )}
                <div className="waste-review" aria-live="polite">
                  <strong>{words.review}</strong>
                  <p>{draft.status === "NOT_READY" ? `${draft.collectionDate} · ${copy.notReady}`
                    : preview.request ? `${draft.collectionDate} · ${draft.confirmedKg} kg (${draft.weightSource === "SCALE" ? copy.scale : copy.estimate}) · ${draft.windowStart}–${draft.windowEnd}`
                    : words.missing}</p>
                </div>
                {saveError && <p className="inline-error" role="alert">{saveError}</p>}
                <button className="button button-primary button-full" type="submit" disabled={saving}>
                  {saving ? copy.saving : saveError ? copy.retry : words.save}
                </button>
                <small className="waste-save-hint">{words.saveHint}</small>
                </fieldset>
              </form>
            )}

            {saved && !editing && !readinessLoading && !readinessError && saved.status === "READY" && <>
            <a className="waste-skip" href="#records-title">{saved.photoKeys.length ? words.record : words.skip}</a>
            <OptionalPhoto key={saved.submissionId} generatorId={id} token={token} language={language}
              submission={saved} onSaved={(record) => setSaved((current) =>
                current?.submissionId === saved?.submissionId ? record : current)} />
            </>}
            </div>
            <WasteGuide language={language} />
            </div>

            <section className="records-section" aria-labelledby="records-title">
              <div className="section-heading">
                <div>
                  <p className="context-line">Your collection records</p>
                  <h2 id="records-title">{copy.records}</h2>
                </div>
                <span className="data-tag">{profile.simulated ? "Simulated data" : "Operational record"}</span>
                <button className="text-button" type="button" disabled={saving || recordsLoading} onClick={() => setRecordsRefreshKey((key) => key + 1)}>{recordsLoading ? "Refreshing records…" : "Refresh records"}</button>
              </div>
              {recordsError && <p className="inline-error" role="alert">{recordsError}</p>}
              {recordsLoading && <p role="status">Loading collection records…</p>}
              {!recordsLoading && !recordsError && receipts.length === 0 ? (
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
