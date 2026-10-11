import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { analyzePhoto, attachPhoto, getEvidence, PhotoRecord, PhotoRequest,
  PhotoUpload, preparePhoto, uploadPhoto } from "./photoApi";

class Request implements PhotoRequest {
  upload: PhotoRequest["upload"] = { onprogress: null };
  status = 0; timeout = 0;
  onload: PhotoRequest["onload"] = null; onerror: PhotoRequest["onerror"] = null;
  ontimeout: PhotoRequest["ontimeout"] = null; onabort: PhotoRequest["onabort"] = null;
  method = ""; url = ""; body: Blob | FormData | null = null;
  headers: Record<string, string> = {};
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(key: string, value: string) { this.headers[key] = value; }
  send(body: Blob | FormData) { this.body = body; }
}

const upload: PhotoUpload = { key: `submissions/kitchen/${"a".repeat(32)}.jpg`,
  url: `/local-photos/submissions/kitchen/${"a".repeat(32)}.jpg`, fields: {}, transport: "local" };
const blob = new Blob([new Uint8Array(2048)], { type: "image/jpeg" });
const event = {} as ProgressEvent;

afterEach(() => vi.unstubAllGlobals());

describe("authenticated optional photo client", () => {
  it("uses apiRequest headers, encoded submission IDs and stable caller keys", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ uploads: [upload] }) });
    vi.stubGlobal("fetch", fetch);
    const record = { submissionId: "kitchen#2026-10-11#abc", photoRevision: 2 } as PhotoRecord;
    await preparePhoto("kitchen", "private-token", "image/jpeg");
    await attachPhoto(record, "private-token", upload.key, "retry-key");
    await analyzePhoto(record, "private-token", "screen-retry");
    await getEvidence(record.submissionId, "private-token");
    const [url, init] = fetch.mock.calls[1];
    expect(url).toContain("kitchen%232026-10-11%23abc/photo");
    expect(init.headers.get("X-Generator-Token")).toBe("private-token");
    expect(init.headers.get("Idempotency-Key")).toBe("retry-key");
    expect(JSON.parse(init.body)).toEqual({ photoKey: upload.key, expectedPhotoRevision: 2 });
    expect(fetch.mock.calls[2][1].headers.get("Idempotency-Key")).toBe("screen-retry");
    expect(fetch.mock.calls[3][1].headers.get("X-Generator-Token")).toBe("private-token");
  });

  it("posts actual local bytes with authentication and bounded progress", async () => {
    const request = new Request(); const progress = vi.fn();
    const pending = uploadPhoto(upload, blob, "private-token", progress, () => request);
    request.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 } as ProgressEvent);
    request.status = 204; request.onload?.(event);
    await expect(pending).resolves.toBeUndefined();
    expect(request.body).toBe(blob);
    expect(request.headers).toEqual({ "X-Generator-Token": "private-token", "Content-Type": "image/jpeg" });
    expect(request.timeout).toBe(30_000);
    expect(progress.mock.calls).toEqual([[50], [100]]);
  });

  it("does not send private kitchen tokens to S3", async () => {
    const request = new Request();
    const pending = uploadPhoto({ ...upload, transport: "s3", url: "https://private-bucket.example/",
      fields: { key: upload.key, policy: "signed", "Content-Type": "image/jpeg" } },
      blob, "private-token", vi.fn(), () => request);
    expect(request.headers).toEqual({});
    expect((request.body as FormData).get("key")).toBe(upload.key);
    expect((request.body as FormData).get("file")).toBeInstanceOf(Blob);
    request.status = 204; request.onload?.(event);
    await pending;
  });

  it.each([403, 409, 500])("reports HTTP upload failure %i for retry", async (status) => {
    const request = new Request();
    const pending = uploadPhoto(upload, blob, "token", vi.fn(), () => request);
    request.status = status; request.onload?.(event);
    await expect(pending).rejects.toMatchObject({ status, code: "UPLOAD_FAILED" });
  });

  it.each(["onerror", "ontimeout", "onabort"] as const)("preserves a retryable failure on %s", async (cause) => {
    const request = new Request();
    const pending = uploadPhoto(upload, blob, "token", vi.fn(), () => request);
    request[cause]?.(event);
    await expect(pending).rejects.toThrow("Readiness is saved; retry the photo");
  });

  it("rejects local token exfiltration paths before sending", async () => {
    const request = new Request();
    await expect(uploadPhoto({ ...upload, url: "//evil.example/photo" }, blob, "secret", vi.fn(), () => request)).rejects.toThrow("Invalid local");
    expect(request.body).toBeNull(); expect(request.headers).toEqual({});
  });

  it("propagates photo API authorization errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401,
      json: async () => ({ error: { code: "UNAUTHORIZED", message: "Own kitchen only" } }) }));
    await expect(getEvidence("other#id", "token")).rejects.toBeInstanceOf(ApiError);
  });
});
