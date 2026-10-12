import { useRef, useState } from "react";
import { apiRequest, createIdempotencyKey } from "../api";
import { PhotoRecord } from "../photoApi";

export function WasteVerification({ record, token, onSaved }: {
  record: PhotoRecord; token: string; onSaved: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(record.photoReview);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const unrelated = record.analysis?.observations?.image_quality === "not_waste";
  const save = async (decision: "VERIFIED" | "REJECTED") => {
    if (busy || !checked || !reason.trim()) return;
    const body = JSON.stringify({ decision, reason: reason.trim(), evidenceChecked: true,
      expectedPhotoRevision: record.photoRevision ?? 0 });
    if (attempt.current?.body !== body) attempt.current = { body, key: createIdempotencyKey("photo-review") };
    setBusy(true); setError(null);
    try {
      const result = await apiRequest<{ submission: PhotoRecord }>(`/submissions/${encodeURIComponent(record.submissionId)}/review`,
        { method: "POST", adminToken: token, body, idempotencyKey: attempt.current.key });
      setSaved(result.submission.photoReview); attempt.current = null; onSaved();
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Review could not be saved. Retry."); }
    finally { setBusy(false); }
  };
  return <section aria-label="Waste photo verification">
    <h3>Human waste-photo check</h3>
    <p>Check the actual food waste with the supplier or on site. Review this photo for unrelated content, visible contamination and hazards. This records a human check, not whole-load safety.</p>
    {saved && <p role="status"><strong>{saved.decision === "VERIFIED" ? "Human-verified waste photo" : "Rejected photo — replacement needed"}</strong><br />{saved.reason}<br />Recorded by {saved.actor.id} at {saved.recordedAt}.</p>}
    <label className="check-field"><input type="checkbox" checked={checked} disabled={busy} onChange={(event) => setChecked(event.currentTarget.checked)} /><span>I reviewed this photo and checked the actual waste with the supplier or on site.</span></label>
    <label className="field"><span>Review reason (required)</span><input value={reason} disabled={busy} onChange={(event) => setReason(event.currentTarget.value)} placeholder="E.g. food scraps confirmed on site; no visible foreign items" /></label>
    <div className="photo-actions"><button type="button" className="button button-primary" disabled={busy || !checked || !reason.trim() || unrelated} onClick={() => void save("VERIFIED")}>Confirm waste-photo check</button><button type="button" className="button button-secondary" disabled={busy || !checked || !reason.trim()} onClick={() => void save("REJECTED")}>Reject photo — request replacement</button></div>
    {unrelated && <p role="alert">Replace this unrelated image before confirming a waste-photo check.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
