import { useState } from "react";
import { OperationGenerator, recordHazardReview } from "../api";

export function HazardReview({ generator, date, token, onSaved }: {
  generator: OperationGenerator; date: string; token: string; onSaved: () => void;
}) {
  const hazard = generator.unresolvedHazards[0];
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState(generator.lastHazardReview);
  const save = async () => {
    if (busy || !reason.trim() || (hazard && !confirmed)) return;
    setBusy(true); setError(null);
    try {
      const result = await recordHazardReview(generator.generatorId, token, {
        collectionDate: date, action: hazard ? "RESOLVE" : "ENTER", reason: reason.trim(),
        ...(hazard?.hazardId ? { expectedHazardId: hazard.hazardId } : {}),
      });
      setReview(result.hazard.action === "RESOLVE" ? result.hazard : null);
      setReason(""); setConfirmed(false); onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Review could not be saved. Retry.");
    } finally { setBusy(false); }
  };
  return <section className="photo-evidence" aria-label={`Human review for ${generator.name}`}>
    {review && <div className="notice" role="status">
      <strong>Human verified — hazard resolved</strong>
      <p>{review.reason}</p>
      <small>Recorded by {review.actor?.id ?? "dispatcher"}{review.recordedAt ? ` at ${review.recordedAt}` : ""}. This resolves the reviewed flag, not a whole-load safety certification. Re-plan any draft to use the updated review.</small>
    </div>}
    {hazard && <>
      <h3>Human verification required</h3>
      <p>Review the saved photo and confirm the actual waste with the supplier or an on-site check. Keep the hold if the concern remains. An unrelated image should be replaced.</p>
      <label className="check-field"><input type="checkbox" checked={confirmed} disabled={busy}
        onChange={(event) => setConfirmed(event.currentTarget.checked)} />
        <span>I checked the evidence and confirmed this hazard is absent or has been removed.</span></label>
    </>}
    <label className="field"><span>{hazard ? "Verification reason (required)" : "New hazard reason"}</span>
      <input value={reason} disabled={busy} onChange={(event) => setReason(event.currentTarget.value)}
        placeholder={hazard ? "E.g. supplier confirmed the knife is outside the waste bin" : "Describe a concern requiring review"} /></label>
    <button className="button button-secondary" type="button" disabled={busy || !reason.trim() || Boolean(hazard && !confirmed)} onClick={() => void save()}>
      {busy ? "Saving review…" : hazard ? "Mark human verified — resolve hazard" : "Record hazard"}
    </button>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}
