import { ChangeEvent, useEffect, useRef, useState } from "react";
import { ApiError, Lang } from "../api";
import { t } from "../i18n";
import { analyzePhoto, attachPhoto, createIdempotencyKey, getEvidence, getKitchenReadiness,
  PhotoRecord, PhotoUpload, photoStatusText, preparePhoto, uploadPhoto } from "../photoApi";
import { resizePhoto } from "../photoUpload";
import "./optionalPhoto.css";

interface Props {
  generatorId: string; token: string; language: Lang; submission: PhotoRecord | null;
  onSaved(record: PhotoRecord): void;
}
type Pending = { record: PhotoRecord; key: string; photoKey: string | null; action: "attach" | "screen" };

export function OptionalPhoto({ generatorId, token, language, submission, onSaved }: Props) {
  const copy = t(language);
  const camera = useRef<HTMLInputElement>(null);
  const chooser = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hazard, setHazard] = useState(false);
  const upload = useRef<PhotoUpload | null>(null);
  const pending = useRef<Pending | null>(null);
  const uploaded = useRef(false);
  const previousSubmission = useRef(submission?.submissionId);

  useEffect(() => {
    if (previousSubmission.current && previousSubmission.current !== submission?.submissionId) {
      setPhoto(null); pending.current = null; upload.current = null; uploaded.current = false;
      setError(null); setProgress(0);
    }
    previousSubmission.current = submission?.submissionId;
  }, [submission?.submissionId]);

  useEffect(() => {
    if (!photo) { setPreview(null); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    setEvidence(null); setHazard(false);
    if (!submission) return;
    let live = true;
    if (submission.photoKeys.length) {
      getEvidence(submission.submissionId, token).then((result) => {
        if (live) setEvidence(result.url);
      }).catch(() => { if (live) setError("Saved photo unavailable. Readiness is still saved."); });
    }
    getKitchenReadiness(generatorId, submission.collectionDate, token).then((result) => {
      if (live) setHazard(Boolean(result.unresolvedHazard));
    }).catch(() => {});
    return () => { live = false; };
  }, [generatorId, token, submission]);

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setBusy(true); setError(null); setPhase(copy.photoPreparing);
    try {
      const resized = await resizePhoto(file);
      setPhoto(resized); upload.current = null; uploaded.current = false;
      pending.current = null; setProgress(0);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Invalid image."); }
    finally { setBusy(false); setPhase(""); }
  };

  const runMutation = async (action: "attach" | "screen", photoKey: string | null = null) => {
    if (!submission) return;
    const previous = pending.current;
    const work = previous?.action === action && previous.photoKey === photoKey
      && previous.record.submissionId === submission.submissionId ? previous
      : { record: submission, photoKey, action, key: createIdempotencyKey(`photo-${action}`) };
    pending.current = work;
    const result = action === "screen" ? await analyzePhoto(work.record, token, work.key)
      : await attachPhoto(work.record, token, work.photoKey, work.key);
    pending.current = null;
    onSaved(result.submission);
    return result.submission;
  };

  const operate = async (action: "upload" | "screen" | "remove") => {
    if (!submission) return;
    setBusy(true); setError(null);
    try {
      if (action === "upload" && photo) {
        setPhase(copy.photoUploading);
        if (!upload.current) upload.current = (await preparePhoto(generatorId, token, photo.type)).uploads[0];
        if (!uploaded.current) {
          await uploadPhoto(upload.current, photo, token, setProgress);
          uploaded.current = true;
        }
        setPhase(copy.photoLinking);
        await runMutation("attach", upload.current.key);
        setPhoto(null); upload.current = null; uploaded.current = false;
      } else if (action === "screen") {
        setPhase(copy.photoAnalyzing);
        await runMutation("screen");
      } else if (action === "remove") {
        setPhase(copy.photoLinking);
        await runMutation("attach", null);
        setPhoto(null); upload.current = null; uploaded.current = false;
      }
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Photo request failed. Retry.");
      if (issue instanceof ApiError && issue.code === "UPLOAD_FAILED"
        && [403, 404, 409].includes(issue.status)) {
        upload.current = null; uploaded.current = false;
      }
      // A known revision conflict needs fresh state and a new key, not indefinite stale retries.
      if (issue instanceof ApiError && issue.status === 409) {
        upload.current = null;
        uploaded.current = false;
        pending.current = null;
        const fresh = await getKitchenReadiness(generatorId, submission.collectionDate, token).catch(() => null);
        if (fresh?.submission) onSaved(fresh.submission);
      }
    } finally { setBusy(false); setPhase(""); }
  };

  const reloadEvidence = async () => {
    if (!submission) return;
    setBusy(true); setError(null);
    try { setEvidence((await getEvidence(submission.submissionId, token)).url); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "Saved photo unavailable."); }
    finally { setBusy(false); }
  };

  return <section className="optional-photo" aria-labelledby="photo-title">
    <h2 id="photo-title">{copy.photoTitle}</h2>
    <p>{copy.photoOptional}</p>
    <p className="photo-privacy">{copy.photoPrivacy}</p>
    <input ref={camera} type="file" accept="image/jpeg,image/png" capture="environment"
      onChange={choose} hidden aria-label={copy.takePhoto} />
    <input ref={chooser} type="file" accept="image/jpeg,image/png" onChange={choose}
      hidden aria-label={copy.chooseImage} />
    <div className="photo-actions">
      <button type="button" className="button button-secondary" disabled={busy} onClick={() => camera.current?.click()}>{preview ? copy.retakePhoto : copy.takePhoto}</button>
      <button type="button" className="button button-secondary" disabled={busy} onClick={() => chooser.current?.click()}>{copy.chooseImage}</button>
    </div>
    {(preview || evidence) && <figure><img src={preview ?? evidence ?? ""} alt={preview ? "Selected waste photo preview" : "Saved supplier waste photo"} /><figcaption>{preview ? copy.photoPreview : copy.photoSaved}</figcaption></figure>}
    {preview && <div className="photo-actions">
      <button type="button" className="button button-primary" disabled={busy || !submission} onClick={() => void operate("upload")}>{error ? copy.retry : copy.uploadPhoto}</button>
      <button type="button" className="button button-secondary" disabled={busy} onClick={() => { setPhoto(null); pending.current = null; upload.current = null; uploaded.current = false; setError(null); }}>{copy.removePhoto}</button>
    </div>}
    {!submission && <p>{copy.photoSaveFirst}</p>}
    {submission?.photoKeys.length ? <div className="photo-actions">
      {!evidence && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void reloadEvidence()}>{copy.retryEvidence}</button>}
      <button type="button" className="button button-primary" disabled={busy || Boolean(preview)} onClick={() => void operate("screen")}>{copy.analyzePhoto}</button>
      <button type="button" className="button button-secondary" disabled={busy} onClick={() => void operate("remove")}>{copy.removeSavedPhoto}</button>
    </div> : null}
    {busy && <div role="status"><p>{phase}</p>{phase === copy.photoUploading && <progress max={100} value={progress}>{progress}%</progress>}</div>}
    {error && <p className="field-error" role="alert">{error}</p>}
    {submission && <div className="photo-result" aria-live="polite">
      {hazard && <strong className="photo-hazard">Unresolved hazard: human dispatcher review is still required, even if a photo is removed or analysis fails.</strong>}
      <p>{photoStatusText[submission.photoStatus]}</p>
      {submission.analysis && <>
        <strong>{submission.analysis.mode === "mock" ? "MOCK MODEL — configured fixture, not analysis of this photo" : "Amazon Bedrock visible-item assistance"}</strong>
        <p>{submission.analysis.state === "FAILED" ? "Analysis failed after one retry. Readiness is saved." : submission.analysis.observations?.notes}</p>
        {submission.analysis.mode === "aws" && <ul>{submission.analysis.observations?.items.map((item, index) => <li key={index}>{item.type.replaceAll("_", " ")} · {item.count} visible</li>)}</ul>}
      </>}
      <small>{copy.photoLimits}</small>
    </div>}
  </section>;
}
