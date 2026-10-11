import { useEffect, useState } from "react";
import { apiRequest, ReadinessRecord } from "../api";
import { PhotoRecord, photoStatusText } from "../photoApi";

export function PhotoEvidence({ submission, adminToken }: { submission: ReadinessRecord; adminToken: string }) {
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const analysis = (submission as PhotoRecord).analysis;
  useEffect(() => {
    setUrl(null); setError(null);
    if (!open || !submission.photoKeys.length) return;
    const controller = new AbortController();
    setLoading(true);
    apiRequest<{ url: string }>(`/submissions/${encodeURIComponent(submission.submissionId)}/evidence`,
      { adminToken, signal: controller.signal }).then((result) => {
        if (controller.signal.aborted) return;
        if (!/^data:image\/(png|jpeg);base64,/.test(result.url) && !/^https:\/\//.test(result.url)) {
          throw new Error("Saved photo address is unavailable.");
        }
        setUrl(result.url);
      }).catch(() => {
        if (!controller.signal.aborted) setError("Could not load the saved photo. Retry or ask the kitchen for evidence before resolving a hazard.");
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, retry, adminToken, submission.submissionId, submission.photoKeys.join("|")]);
  if (!submission.photoKeys.length) return null;
  return <div className="photo-evidence">
    <button type="button" className="text-button" aria-expanded={open} onClick={() => setOpen(!open)}>
      {open ? "Close saved photo" : "Review saved photo"}
    </button>
    {open && <div>
      {loading && <p role="status">Loading private photo evidence…</p>}
      {url && <figure><img src={url} alt="Kitchen’s uploaded waste photo evidence" referrerPolicy="no-referrer"
        onError={() => { setUrl(null); setError("The saved image could not be displayed. Retry to retrieve it again."); }} />
        <figcaption>Uploaded evidence for {submission.collectionDate}. Visible surface only; no whole-load safety certification.</figcaption></figure>}
      {error && <><p className="inline-error" role="alert">{error}</p><button type="button" className="button button-secondary" onClick={() => setRetry(retry + 1)}>Retry saved photo</button></>}
      <p>{photoStatusText[submission.photoStatus]}</p>
      {analysis && <p>{analysis.mode === "mock" ? "Mock observations are configured fixtures unrelated to this image."
        : analysis.state === "FAILED" ? "Analysis failed. A human pickup check is still needed." : analysis.observations?.notes}</p>}
      <p>Inspect the evidence and confirm with the kitchen. Record an explicit reason in the hazard controls below.</p>
    </div>}
  </div>;
}
