import { describe, expect, it, vi } from "vitest";

import {
  PresignedUpload,
  UploadRequest,
  uploadPresignedPost,
} from "./api";
import {
  ImageCodec,
  fitWithinDimensions,
  initialUploadState,
  reduceUploadState,
  resizePhoto,
  uploadIsComplete,
} from "./photoUpload";

class FakeUploadRequest implements UploadRequest {
  upload: UploadRequest["upload"] = { onprogress: null };
  status = 0;
  onload: UploadRequest["onload"] = null;
  onerror: UploadRequest["onerror"] = null;
  onabort: UploadRequest["onabort"] = null;
  ontimeout: UploadRequest["ontimeout"] = null;
  method = "";
  url = "";
  body: FormData | null = null;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  send(body: FormData): void {
    this.body = body;
  }
}

const presignedUpload: PresignedUpload = {
  slot: "top",
  key: "submissions/hostel-3/2026-10-09/id-top.jpg",
  url: "https://photos.example.test",
  fields: { key: "submissions/hostel-3/2026-10-09/id-top.jpg", policy: "signed" },
};

describe("photo resizing", () => {
  it("fits landscape and portrait photos without upscaling", () => {
    expect(fitWithinDimensions(4000, 3000)).toEqual({ width: 1280, height: 960 });
    expect(fitWithinDimensions(1200, 2400)).toEqual({ width: 640, height: 1280 });
    expect(fitWithinDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("decodes, resizes, and encodes as an 0.8-quality JPEG", async () => {
    const release = vi.fn();
    const encoded = new Blob([new Uint8Array(2048)], { type: "image/jpeg" });
    const codec: ImageCodec = {
      decode: vi.fn().mockResolvedValue({
        width: 3000,
        height: 2000,
        source: {} as CanvasImageSource,
        release,
      }),
      encode: vi.fn().mockResolvedValue(encoded),
    };

    const result = await resizePhoto(new Blob(["photo"], { type: "image/png" }), codec);

    expect(result).toBe(encoded);
    expect(codec.encode).toHaveBeenCalledWith(expect.anything(), 1280, 853, "image/jpeg", 0.8);
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects compressed output above the signed S3 size limit", async () => {
    const release = vi.fn();
    const codec: ImageCodec = {
      decode: vi.fn().mockResolvedValue({
        width: 1600,
        height: 1200,
        source: {} as CanvasImageSource,
        release,
      }),
      encode: vi.fn().mockResolvedValue(
        new Blob([new Uint8Array(3_500_001)], { type: "image/jpeg" }),
      ),
    };

    await expect(resizePhoto(new Blob(["photo"], { type: "image/jpeg" }), codec)).rejects.toThrow(
      "This photo is too large",
    );
    expect(release).toHaveBeenCalledOnce();
  });
});

describe("direct S3 upload", () => {
  it("posts signed fields and reports upload progress", async () => {
    const request = new FakeUploadRequest();
    const progress = vi.fn();
    const pending = uploadPresignedPost(
      presignedUpload,
      new Blob([new Uint8Array(2048)], { type: "image/jpeg" }),
      progress,
      () => request,
    );

    request.upload.onprogress?.({
      lengthComputable: true,
      loaded: 1,
      total: 2,
    } as ProgressEvent);
    request.status = 204;
    request.onload?.({} as ProgressEvent);

    await expect(pending).resolves.toBeUndefined();
    expect(request.method).toBe("POST");
    expect(request.url).toBe(presignedUpload.url);
    expect(request.body?.get("key")).toBe(presignedUpload.key);
    expect(request.body?.get("policy")).toBe("signed");
    expect(progress).toHaveBeenNthCalledWith(1, 50);
    expect(progress).toHaveBeenLastCalledWith(100);
  });

  it("rejects a non-successful S3 response", async () => {
    const request = new FakeUploadRequest();
    const pending = uploadPresignedPost(
      presignedUpload,
      new Blob([new Uint8Array(2048)], { type: "image/jpeg" }),
      vi.fn(),
      () => request,
    );
    request.status = 403;
    request.onload?.({} as ProgressEvent);

    await expect(pending).rejects.toThrow("Photo upload failed with 403.");
  });

  it("rejects a network failure", async () => {
    const request = new FakeUploadRequest();
    const pending = uploadPresignedPost(
      presignedUpload,
      new Blob([new Uint8Array(2048)], { type: "image/jpeg" }),
      vi.fn(),
      () => request,
    );
    request.onerror?.({} as ProgressEvent);

    await expect(pending).rejects.toThrow("Photo upload failed.");
  });
});

describe("paired upload state", () => {
  it("does not complete until both slots succeed and preserves errors", () => {
    let state = reduceUploadState(initialUploadState(), { type: "start" });
    state = reduceUploadState(state, { type: "progress", slot: "top", progress: 44.6 });
    state = reduceUploadState(state, { type: "success", slot: "top", key: "top-key" });
    expect(uploadIsComplete(state)).toBe(false);

    const failed = reduceUploadState(state, {
      type: "failure",
      slot: "tray",
      message: "Try again.",
    });
    expect(uploadIsComplete(failed)).toBe(false);
    expect(failed.error).toBe("Try again.");

    state = reduceUploadState(state, { type: "success", slot: "tray", key: "tray-key" });
    expect(uploadIsComplete(state)).toBe(true);
    expect(state.top.progress).toBe(100);
    expect(state.tray.progress).toBe(100);
  });
});
