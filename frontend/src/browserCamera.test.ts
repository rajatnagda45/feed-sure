import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraSession, captureCameraPhoto, freshLocation, photoTag, PhotoLocation } from "./browserCamera";

const now = Date.parse("2026-10-11T12:00:00Z");
const fix: PhotoLocation = { latitude: 12.9716, longitude: 77.5946, accuracy: 18.2, timestamp: now };
afterEach(() => vi.unstubAllGlobals());

describe("capture-time location evidence", () => {
  it("retains device time, supplier and GPS accuracy in the image tag", () => {
    expect(photoTag("hotel-a", now, fix)).toEqual([
      "FeedSure | Supplier: hotel-a", "Device capture: 2026-10-11T12:00:00.000Z",
      "GPS: 12.97160, 77.59460 | +/- 19 m",
    ]);
  });
  it.each([
    null, { ...fix, timestamp: now - 30_001 }, { ...fix, timestamp: now + 1 },
    { ...fix, accuracy: -1 }, { ...fix, accuracy: Infinity }, { ...fix, latitude: 91 },
    { ...fix, longitude: NaN }, { ...fix, longitude: 181 },
  ])("never stamps denied, stale, future or invalid GPS as live", (location) => {
    expect(freshLocation(location, now)).toBeNull();
    expect(photoTag("hotel-a", now, location)[2]).toBe("GPS unavailable | Location unknown");
  });
  it("preserves low accuracy rather than implying a geofence pass", () => {
    expect(photoTag("hotel-a", now, { ...fix, accuracy: 2000 })[2]).toContain("+/- 2000 m");
    expect(freshLocation({ ...fix, timestamp: now - 30_000 }, now)).not.toBeNull();
  });
});

function browser(getUserMedia: () => Promise<MediaStream>) {
  const stop = vi.fn();
  const track = { stop, addEventListener: vi.fn() };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  const watchPosition = vi.fn().mockReturnValue(0);
  const clearWatch = vi.fn();
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia }, geolocation: { watchPosition, clearWatch } });
  return { stop, track, stream, watchPosition, clearWatch };
}

describe("browser permission and resource lifecycle", () => {
  it("uses video only, prefers the rear camera and clears stream/GPS even when watch ID is zero", async () => {
    const media = vi.fn(); const api = browser(media); media.mockResolvedValue(api.stream);
    const session = new CameraSession(); const location = vi.fn(); const failed = vi.fn();
    await expect(session.start(location, failed, vi.fn())).resolves.toBe(api.stream);
    expect(media).toHaveBeenCalledWith({ audio: false, video: { facingMode: { ideal: "environment" } } });
    expect(api.watchPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 });
    const [success, error] = api.watchPosition.mock.calls[0];
    success({ coords: fix, timestamp: now }); expect(location).toHaveBeenLastCalledWith(fix);
    error({ code: 1 }); expect(location).toHaveBeenLastCalledWith(null); expect(failed).toHaveBeenCalledWith(1);
    session.stop(); session.stop();
    expect(api.stop).toHaveBeenCalledTimes(1); expect(api.clearWatch).toHaveBeenCalledExactlyOnceWith(0);
    location.mockClear(); success({ coords: fix, timestamp: now }); expect(location).not.toHaveBeenCalled();
  });
  it("releases camera permission granted after cancellation without starting GPS", async () => {
    let grant!: (stream: MediaStream) => void;
    const api = browser(() => new Promise((resolve) => { grant = resolve; }));
    const session = new CameraSession(); const opening = session.start(vi.fn(), vi.fn(), vi.fn());
    session.stop(); grant(api.stream);
    await expect(opening).rejects.toMatchObject({ name: "AbortError" });
    expect(api.stop).toHaveBeenCalledTimes(1); expect(api.watchPosition).not.toHaveBeenCalled();
  });
  it("does not request GPS if camera permission is denied", async () => {
    const api = browser(() => Promise.reject(new DOMException("Denied", "NotAllowedError")));
    await expect(new CameraSession().start(vi.fn(), vi.fn(), vi.fn())).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(api.watchPosition).not.toHaveBeenCalled();
  });
  it("keeps capture available when geolocation is missing", async () => {
    const media = vi.fn(); const api = browser(media); media.mockResolvedValue(api.stream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: media } });
    const failed = vi.fn(); const session = new CameraSession();
    await expect(session.start(vi.fn(), failed, vi.fn())).resolves.toBe(api.stream);
    expect(failed).toHaveBeenCalledWith(2); session.stop();
  });
  it("stops location updates if the camera disconnects", async () => {
    const media = vi.fn(); const api = browser(media); media.mockResolvedValue(api.stream);
    const ended = vi.fn(); const session = new CameraSession();
    await session.start(vi.fn(), vi.fn(), ended);
    api.track.addEventListener.mock.calls[0][1]();
    expect(api.clearWatch).toHaveBeenCalledWith(0); expect(ended).toHaveBeenCalledOnce();
  });
  it("rejects insecure browser contexts before requesting devices", async () => {
    const media = vi.fn(); browser(media); vi.stubGlobal("window", { isSecureContext: false });
    await expect(new CameraSession().start(vi.fn(), vi.fn(), vi.fn())).rejects.toMatchObject({ name: "NotSupportedError" });
    expect(media).not.toHaveBeenCalled();
  });
});

describe("capture to a tagged JPEG", () => {
  it("draws actual video with a separate footer within upload dimension limits", async () => {
    const context = { drawImage: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), fillStyle: "", font: "", textBaseline: "" };
    const blob = new Blob(["jpeg"], { type: "image/jpeg" });
    const canvas = { width: 0, height: 0, getContext: () => context,
      toBlob: vi.fn((callback: BlobCallback) => callback(blob)) };
    vi.stubGlobal("document", { createElement: () => canvas });
    const video = { readyState: 2, videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
    await expect(captureCameraPhoto(video, "hotel-a", fix, now)).resolves.toBe(blob);
    expect(canvas.width).toBeLessThanOrEqual(1280); expect(canvas.height).toBeLessThanOrEqual(1280);
    expect(context.drawImage.mock.calls[0][0]).toBe(video);
    expect(context.fillText.mock.calls.map((call) => call[0])).toEqual(photoTag("hotel-a", now, fix));
    expect(context.fillRect.mock.calls[0][1]).toBe(canvas.height - 96);
    expect(canvas.toBlob.mock.calls[0].slice(1)).toEqual(["image/jpeg", 0.8]);
  });
  it("refuses empty camera frames", async () => {
    await expect(captureCameraPhoto({ readyState: 0, videoWidth: 0, videoHeight: 0 } as HTMLVideoElement,
      "hotel-a", null, now)).rejects.toThrow("not ready");
  });
  it("refuses browser placeholder frames before a real frame arrives", async () => {
    await expect(captureCameraPhoto({ readyState: 2, videoWidth: 2, videoHeight: 2 } as HTMLVideoElement,
      "hotel-a", null, now)).rejects.toThrow("not ready");
  });
});
