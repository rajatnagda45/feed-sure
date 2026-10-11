import { useEffect, useRef, useState } from "react";
import { Lang } from "../api";
import { CameraSession, captureCameraPhoto, freshLocation, PhotoLocation } from "../browserCamera";
import { t } from "../i18n";

interface Props {
  supplierId: string;
  language: Lang;
  onCapture(photo: Blob): Promise<void>;
  onClose(): void;
}

export function BrowserCamera({ supplierId, language, onCapture, onClose }: Props) {
  const copy = t(language);
  const video = useRef<HTMLVideoElement>(null);
  const close = useRef(onClose);
  const activeCapture = useRef(true);
  close.current = onClose;
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"denied" | "missing" | "unavailable" | "insecure" | "capture" | null>(null);
  const [locationError, setLocationError] = useState<number | null>(null);
  const [location, setLocation] = useState<PhotoLocation | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const session = new CameraSession();
    activeCapture.current = true;
    let active = true;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    const hide = () => { if (document.hidden) close.current(); };
    document.addEventListener("visibilitychange", hide);
    void session.start((fix) => { if (active) { setLocation(fix); setLocationError(null); } },
      (code) => { if (active) setLocationError(code); },
      () => { if (active) { setReady(false); setError("unavailable"); } })
      .then(async (stream) => {
        if (!active || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
      }).catch((issue: unknown) => {
        session.stop();
        if (!active) return;
        const name = issue instanceof DOMException ? issue.name : "";
        setError(name === "NotAllowedError" ? "denied" : name === "NotFoundError" ? "missing"
          : name === "NotSupportedError" ? "insecure" : "unavailable");
      });
    return () => {
      active = false;
      activeCapture.current = false;
      session.stop();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);

  const take = async () => {
    if (!video.current || busy) return;
    setBusy(true);
    try {
      const blob = await captureCameraPhoto(video.current, supplierId, location);
      if (!activeCapture.current) return;
      await onCapture(blob);
      if (activeCapture.current) onClose();
    } catch { if (activeCapture.current) setError("capture"); }
    finally { if (activeCapture.current) setBusy(false); }
  };

  const fix = freshLocation(location, now);
  const message = error === "denied" ? copy.cameraDenied : error === "missing" ? copy.cameraMissing
    : error === "insecure" ? copy.cameraSecure : error === "capture" ? copy.cameraCaptureFailed
    : copy.cameraUnavailable;
  const frameReady = () => setReady(Boolean(video.current && video.current.readyState >= 2
    && video.current.videoWidth >= 32 && video.current.videoHeight >= 32));
  return <div className="browser-camera" aria-label={copy.cameraPreview}>
    <video ref={video} autoPlay muted playsInline aria-label={copy.cameraPreview}
      onLoadedData={frameReady} onPlaying={frameReady} onResize={frameReady}
      onError={() => { setReady(false); setError("unavailable"); }} />
    <p role="status">{fix ? `${copy.locationLive}: ${fix.latitude.toFixed(5)}, ${fix.longitude.toFixed(5)} (±${Math.ceil(fix.accuracy)} m)`
      : locationError === 1 ? copy.locationDenied : locationError ? copy.locationUnavailable
      : location ? copy.locationStale : copy.locationWaiting}</p>
    {error && <p className="field-error" role="alert">{message}</p>}
    {!ready && !error && <p role="status">{copy.cameraStarting}</p>}
    <div className="photo-actions">
      <button type="button" className="button button-primary" disabled={!ready || busy}
        onClick={() => void take()}>{busy ? copy.photoPreparing : copy.capturePhoto}</button>
      <button type="button" className="button button-secondary" onClick={onClose}>{copy.closeCamera}</button>
    </div>
  </div>;
}
