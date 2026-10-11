import { fitWithinDimensions, PHOTO_JPEG_QUALITY, PHOTO_MAX_DIMENSION } from "./photoUpload";

export interface PhotoLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

// A fix older than this is unknown, even if the browser reports it as cached.
export const LOCATION_MAX_AGE_MS = 30_000;

export function freshLocation(location: PhotoLocation | null, now: number): PhotoLocation | null {
  if (!location || ![location.latitude, location.longitude, location.accuracy, location.timestamp]
    .every(Number.isFinite) || Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180
    || location.accuracy < 0 || now - location.timestamp < 0
    || now - location.timestamp > LOCATION_MAX_AGE_MS) return null;
  return location;
}

export function photoTag(supplierId: string, capturedAt: number, location: PhotoLocation | null): string[] {
  const fix = freshLocation(location, capturedAt);
  return [
    `FeedSure | Supplier: ${supplierId}`,
    `Device capture: ${new Date(capturedAt).toISOString()}`,
    fix ? `GPS: ${fix.latitude.toFixed(5)}, ${fix.longitude.toFixed(5)} | +/- ${Math.ceil(fix.accuracy)} m`
      : "GPS unavailable | Location unknown",
  ];
}

/** Owns camera and GPS resources, including a permission grant after the view closes. */
export class CameraSession {
  private closed = false;
  private stream: MediaStream | null = null;
  private watchId: number | null = null;
  private geolocation: Geolocation | null = null;

  async start(onLocation: (location: PhotoLocation | null) => void,
    onLocationError: (code: number) => void, onEnded: () => void): Promise<MediaStream> {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new DOMException("Camera needs HTTPS or localhost.", "NotSupportedError");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: { ideal: "environment" } },
    });
    if (this.closed) {
      stream.getTracks().forEach((track) => track.stop());
      throw new DOMException("Camera closed.", "AbortError");
    }
    this.stream = stream;
    stream.getVideoTracks().forEach((track) => track.addEventListener("ended", () => {
      if (!this.closed) { this.stop(); onEnded(); }
    }, { once: true }));
    this.geolocation = navigator.geolocation ?? null;
    if (this.geolocation) {
      try {
        this.watchId = this.geolocation.watchPosition((position) => {
          if (!this.closed) onLocation({ latitude: position.coords.latitude,
            longitude: position.coords.longitude, accuracy: position.coords.accuracy,
            timestamp: position.timestamp });
        }, (issue) => {
          if (!this.closed) { onLocation(null); onLocationError(issue.code); }
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 });
      } catch {
        onLocationError(2);
      }
    } else onLocationError(2);
    return stream;
  }

  stop() {
    this.closed = true;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.watchId !== null) this.geolocation?.clearWatch(this.watchId);
    this.watchId = null;
  }
}

/** Append the capture tag to actual image pixels so existing private evidence storage retains it. */
export async function captureCameraPhoto(video: HTMLVideoElement, supplierId: string,
  location: PhotoLocation | null, capturedAt = Date.now()): Promise<Blob> {
  if (video.readyState < 2 || video.videoWidth < 32 || video.videoHeight < 32) {
    throw new Error("Camera frame is not ready.");
  }
  const footer = 96;
  const size = fitWithinDimensions(video.videoWidth, video.videoHeight, PHOTO_MAX_DIMENSION - footer);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height + footer;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Photo processing is unavailable.");
  context.drawImage(video, 0, 0, size.width, size.height);
  context.fillStyle = "#10261b";
  context.fillRect(0, size.height, size.width, footer);
  context.fillStyle = "#ffffff";
  context.font = `${Math.max(10, Math.min(18, Math.floor(size.width / 40)))}px sans-serif`;
  context.textBaseline = "middle";
  photoTag(supplierId, capturedAt, location).forEach((line, index) => {
    context.fillText(line, 12, size.height + 18 + index * 29, Math.max(1, size.width - 24));
  });
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error("Photo capture failed."));
  }, "image/jpeg", PHOTO_JPEG_QUALITY));
}
