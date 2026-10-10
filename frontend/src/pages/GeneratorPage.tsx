import { ChangeEvent, FormEvent, useEffect, useReducer, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import {
  ApiError,
  PresignedUpload,
  SubmissionResponse,
  createSubmission,
  requestPhotoUploads,
  uploadPresignedPost,
} from "../api";
import { VerdictScreen } from "../components/VerdictScreen";
import {
  PhotoSlot,
  combinedProgress,
  initialUploadState,
  reduceUploadState,
  resizePhoto,
} from "../photoUpload";

type FlowStep = "weight" | PhotoSlot | "ready" | "uploading" | "screening" | "verdict" | "done";

interface CapturedPhoto {
  blob: Blob;
  previewUrl: string;
}

const guidance: Record<PhotoSlot, { context: string; title: string; body: string }> = {
  top: {
    context: "Photo 1 of 2",
    title: "Photograph the bin from above",
    body: "Hold the phone over the bin so the full surface of the waste is visible.",
  },
  tray: {
    context: "Photo 2 of 2",
    title: "Spread a sample on a tray",
    body: "Take a close photo of one spread-out handful so small wrappers are visible.",
  },
};

function progressStep(step: FlowStep): number {
  if (step === "weight") return 1;
  if (step === "top") return 2;
  if (step === "tray") return 3;
  if (step === "ready" || step === "uploading" || step === "screening") return 4;
  return 5;
}

export function GeneratorPage() {
  const { id = "unknown" } = useParams();
  const location = useLocation();
  const token = new URLSearchParams(location.search).get("t") ?? "";
  const [step, setStep] = useState<FlowStep>("weight");
  const [reportedKg, setReportedKg] = useState("");
  const [language, setLanguage] = useState<"en" | "hi">("en");
  const [photos, setPhotos] = useState<Partial<Record<PhotoSlot, CapturedPhoto>>>({});
  const [draft, setDraft] = useState<CapturedPhoto | null>(null);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<SubmissionResponse | null>(null);
  const [stillChecking, setStillChecking] = useState(false);
  const [uploadState, dispatchUpload] = useReducer(reduceUploadState, undefined, initialUploadState);
  const previewUrls = useRef(new Set<string>());

  const numericWeight = Number(reportedKg);
  const validWeight = reportedKg !== "" && Number.isFinite(numericWeight)
    && numericWeight >= 0 && numericWeight <= 5000;

  useEffect(
    () => () => {
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const revokePreview = (photo: CapturedPhoto | null | undefined) => {
    if (!photo) return;
    URL.revokeObjectURL(photo.previewUrl);
    previewUrls.current.delete(photo.previewUrl);
  };

  const choosePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setProcessing(true);
    setMessage(null);
    try {
      const blob = await resizePhoto(file);
      revokePreview(draft);
      const previewUrl = URL.createObjectURL(blob);
      previewUrls.current.add(previewUrl);
      setDraft({ blob, previewUrl });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This photo could not be prepared.");
    } finally {
      setProcessing(false);
    }
  };

  const useDraft = () => {
    if (!draft || (step !== "top" && step !== "tray")) return;
    const slot = step;
    revokePreview(photos[slot]);
    setPhotos((current) => ({ ...current, [slot]: draft }));
    setDraft(null);
    setMessage(null);
    setStep(slot === "top" ? "tray" : "ready");
  };

  const discardDraft = () => {
    revokePreview(draft);
    setDraft(null);
    setMessage(null);
  };

  const retake = (slot: PhotoSlot) => {
    const existing = photos[slot];
    setPhotos((current) => ({ ...current, [slot]: undefined }));
    setDraft(existing ?? null);
    setMessage(null);
    dispatchUpload({ type: "reset" });
    setStep(slot);
  };

  const uploadOne = async (upload: PresignedUpload, photo: CapturedPhoto) => {
    await uploadPresignedPost(upload, photo.blob, (progress) => {
      dispatchUpload({ type: "progress", slot: upload.slot, progress });
    });
    dispatchUpload({ type: "success", slot: upload.slot, key: upload.key });
  };

  const uploadPhotos = async () => {
    if (!photos.top || !photos.tray || !token || !validWeight) return;
    let photosUploaded = false;
    setStep("uploading");
    setMessage(null);
    dispatchUpload({ type: "start" });
    try {
      const response = await requestPhotoUploads(id, token);
      const topUpload = response.uploads.find((upload) => upload.slot === "top");
      const trayUpload = response.uploads.find((upload) => upload.slot === "tray");
      if (!topUpload || !trayUpload) throw new Error("Upload details were incomplete.");
      const uploads = await Promise.allSettled([
        uploadOne(topUpload, photos.top),
        uploadOne(trayUpload, photos.tray),
      ]);
      const failedIndex = uploads.findIndex((upload) => upload.status === "rejected");
      if (failedIndex >= 0) {
        const failedSlot: PhotoSlot = failedIndex === 0 ? "top" : "tray";
        dispatchUpload({
          type: "failure",
          slot: failedSlot,
          message: "Photo didn't upload. Check your internet and tap Try again.",
        });
        throw new Error("Photo upload failed.");
      }

      photosUploaded = true;
      setStep("screening");
      const checkingTimer = window.setTimeout(() => setStillChecking(true), 20_000);
      try {
        const submission = await createSubmission(
          id,
          token,
          numericWeight,
          [topUpload.key, trayUpload.key],
          language,
        );
        setResult(submission);
        setStep("verdict");
      } finally {
        window.clearTimeout(checkingTimer);
        setStillChecking(false);
      }
    } catch (error) {
      const badLink = error instanceof ApiError && (error.status === 401 || error.status === 404);
      setMessage(
        badLink
          ? "This link isn't valid. Ask the plant for your FeedSure link."
          : photosUploaded
            ? "The photos uploaded, but could not be checked. Tap Try again."
            : "Photo didn't upload. Check your internet and tap Try again.",
      );
      setStep("ready");
    }
  };

  const continueFromWeight = (event: FormEvent) => {
    event.preventDefault();
    if (validWeight) setStep("top");
  };

  const adjustWeight = (delta: number) => {
    const current = validWeight ? numericWeight : 0;
    setReportedKg(String(Math.max(0, Math.min(5000, current + delta))));
  };

  const photographAgain = () => {
    for (const photo of Object.values(photos)) revokePreview(photo);
    revokePreview(draft);
    setPhotos({});
    setDraft(null);
    setResult(null);
    setMessage(null);
    dispatchUpload({ type: "reset" });
    setStep("top");
  };

  const currentStep = progressStep(step);

  if (!token) {
    return (
      <main className="generator-shell">
        <header className="mobile-header">
          <Link className="brand" to="/">
            <span className="brand-mark" aria-hidden="true">F</span>
            <span>FeedSure</span>
          </Link>
        </header>
        <section className="generator-step generator-error" aria-labelledby="generator-title">
          <p className="context-line">Link problem</p>
          <h1 id="generator-title">This link isn&apos;t valid</h1>
          <p>Ask the plant for your FeedSure link.</p>
        </section>
      </main>
    );
  }

  if (step === "verdict" && result) {
    return (
      <main className="generator-shell verdict-shell">
        <VerdictScreen
          result={result}
          onDone={() => setStep("done")}
          onPhotographAgain={photographAgain}
        />
      </main>
    );
  }

  return (
    <main className="generator-shell">
      <header className="mobile-header">
        <Link className="brand" to="/">
          <span className="brand-mark" aria-hidden="true">F</span>
          <span>FeedSure</span>
        </Link>
        <button
          className="language-switch"
          type="button"
          onClick={() => setLanguage((current) => (current === "en" ? "hi" : "en"))}
          aria-label="Change language"
        >
          {language === "en" ? "EN / हिन्दी" : "हिन्दी / EN"}
        </button>
      </header>

      <section className="generator-step" aria-labelledby="generator-title">
        <div className="step-progress" aria-label={`Step ${currentStep} of 5`}>
          {[1, 2, 3, 4, 5].map((number) => (
            <span className={number <= currentStep ? "step-progress-active" : ""} key={number} />
          ))}
        </div>

        {step === "weight" && (
          <form className="weight-step" onSubmit={continueFromWeight}>
            <p className="context-line">Today&apos;s pickup</p>
            <h1 id="generator-title">How many kilograms today?</h1>
            <p>An approximate weight is fine.</p>
            <label className="weight-field">
              <span>Waste weight</span>
              <span className="weight-input-row">
                <input
                  type="number"
                  min="0"
                  max="5000"
                  step="1"
                  inputMode="numeric"
                  value={reportedKg}
                  onChange={(event) => setReportedKg(event.currentTarget.value)}
                  required
                />
                <strong>kg</strong>
              </span>
            </label>
            <div className="weight-adjustments">
              <button type="button" onClick={() => adjustWeight(-10)}>−10 kg</button>
              <button type="button" onClick={() => adjustWeight(10)}>+10 kg</button>
            </div>
            <button className="button button-primary button-full" type="submit" disabled={!validWeight}>
              Next
            </button>
          </form>
        )}

        {(step === "top" || step === "tray") && (
          <>
            <p className="context-line">{guidance[step].context}</p>
            <h1 id="generator-title">{guidance[step].title}</h1>
            <p>{guidance[step].body}</p>
            <p className="privacy-note">Photograph only the waste. Don&apos;t include people.</p>

            {draft ? (
              <div className="photo-review">
                <img src={draft.previewUrl} alt={`${step} view of waste`} />
                <div className="photo-actions">
                  <button className="button button-secondary" type="button" onClick={discardDraft}>
                    Retake
                  </button>
                  <button className="button button-primary" type="button" onClick={useDraft}>
                    Use this photo
                  </button>
                </div>
              </div>
            ) : (
              <label className="capture-button" aria-disabled={processing}>
                <span>{processing ? "Preparing photo…" : "Take or choose photo"}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  capture="environment"
                  disabled={processing}
                  onChange={choosePhoto}
                />
              </label>
            )}
          </>
        )}

        {(step === "ready" || step === "uploading") && photos.top && photos.tray && (
          <>
            <p className="context-line">Both photos ready</p>
            <h1 id="generator-title">
              {step === "uploading" ? "Uploading your photos" : "Check both photos"}
            </h1>
            <div className="photo-pair">
              {(["top", "tray"] as const).map((slot) => (
                <figure key={slot}>
                  <img src={photos[slot]?.previewUrl} alt={`${slot} view of waste`} />
                  <figcaption>{slot === "top" ? "Top view" : "Tray view"}</figcaption>
                  {step === "ready" && (
                    <button type="button" onClick={() => retake(slot)}>Retake</button>
                  )}
                </figure>
              ))}
            </div>
            {step === "uploading" ? (
              <div className="upload-progress" aria-live="polite">
                <div>
                  <span>Uploading</span>
                  <strong>{combinedProgress(uploadState)}%</strong>
                </div>
                <progress max="100" value={combinedProgress(uploadState)} />
              </div>
            ) : (
              <button className="button button-primary button-full" type="button" onClick={uploadPhotos}>
                {message ? "Try again" : "Upload and check photos"}
              </button>
            )}
          </>
        )}

        {step === "screening" && (
          <div className="checking-state" aria-live="polite">
            <span className="checking-mark" aria-hidden="true" />
            <p className="context-line">Photos uploaded</p>
            <h1 id="generator-title">
              {stillChecking ? "Still checking your photos…" : "Checking your photos…"}
            </h1>
            <p>Keep this page open. This normally takes a few seconds.</p>
          </div>
        )}

        {step === "done" && (
          <div className="upload-complete" aria-live="polite">
            <span className="complete-mark" aria-hidden="true">✓</span>
            <p className="context-line">Finished</p>
            <h1 id="generator-title">Ready for pickup tomorrow</h1>
            <p>You can close this page now.</p>
          </div>
        )}

        {message && <p className="inline-error" role="alert">{message}</p>}
      </section>
    </main>
  );
}
