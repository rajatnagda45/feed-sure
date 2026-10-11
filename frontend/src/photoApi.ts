import { accessToken, supabaseEnabled } from "./supabase";
import { ApiError, apiRequest, createIdempotencyKey, ReadinessRecord, PhotoStatus } from "./api";

export interface PhotoRecord extends ReadinessRecord {
  photoRevision?: number;
  analysis?: {
    state: "FAILED" | "COMPLETE";
    mode: "mock" | "aws";
    observations: { items: { type: string; count: number; confidence: number }[];
      image_quality: string; confidence: number; notes: string; hazard: boolean } | null;
    limit: string;
  } | null;
}
export interface PhotoUpload {
  key: string;
  url: string;
  fields: Record<string, string>;
  transport: "local" | "s3" | "supabase";
}

export function getKitchenReadiness(id: string, date: string, token: string, signal?: AbortSignal) {
  return apiRequest<{ submission: PhotoRecord | null; unresolvedHazard: unknown }>(
    `/generators/${encodeURIComponent(id)}/readiness?date=${encodeURIComponent(date)}`,
    { generatorToken: token, signal });
}
export function preparePhoto(id: string, token: string, contentType: string) {
  return apiRequest<{ uploads: PhotoUpload[] }>("/uploads", { method: "POST",
    generatorToken: token, body: JSON.stringify({ generatorId: id, contentType }) });
}
export function attachPhoto(record: PhotoRecord, token: string, photoKey: string | null, key: string) {
  return apiRequest<{ submission: PhotoRecord; inputRevision: number }>(
    `/submissions/${encodeURIComponent(record.submissionId)}/photo`, { method: "POST",
      generatorToken: token, idempotencyKey: key,
      body: JSON.stringify({ photoKey, expectedPhotoRevision: record.photoRevision ?? 0 }) });
}
export function analyzePhoto(record: PhotoRecord, token: string, key: string) {
  return apiRequest<{ submission: PhotoRecord; inputRevision: number }>(
    `/submissions/${encodeURIComponent(record.submissionId)}/screen`, { method: "POST",
      generatorToken: token, idempotencyKey: key,
      body: JSON.stringify({ expectedPhotoRevision: record.photoRevision ?? 0 }) });
}
export function getEvidence(id: string, token: string) {
  return apiRequest<{ url: string; transport: "local" | "s3" | "supabase" }>(
    `/submissions/${encodeURIComponent(id)}/evidence`, { generatorToken: token });
}
export { createIdempotencyKey };
export const photoStatusText: Record<PhotoStatus, string> = {
  NOT_CHECKED: "Not checked — ordinary human pickup check needed.",
  ADVICE: "Check the visible items or retake a clearer image. Readiness remains saved.",
  REVIEW_HAZARD: "Possible hazard — dispatcher must record a human resolution before loading.",
  NO_ISSUE_OBSERVED: "No issue observed on the visible surface. This does not certify the load.",
};

export interface PhotoRequest {
  upload: { onprogress: ((event: ProgressEvent) => void) | null };
  status: number; timeout: number;
  onload: ((event: ProgressEvent) => void) | null; onerror: ((event: ProgressEvent) => void) | null;
  ontimeout: ((event: ProgressEvent) => void) | null; onabort: ((event: ProgressEvent) => void) | null;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: Blob | FormData): void;
}

export async function uploadPhoto(upload: PhotoUpload, photo: Blob, token: string,
  progress: (value: number) => void, factory: () => PhotoRequest = () => new XMLHttpRequest()) {
  const bearer = upload.transport === "local" && supabaseEnabled ? await accessToken() : null;
  return new Promise<void>((resolve, reject) => {
    const xhr = factory();
    xhr.timeout = 30_000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) progress(Math.round(100 * event.loaded / event.total));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { progress(100); resolve(); }
      else reject(new ApiError(xhr.status, "UPLOAD_FAILED", `Photo upload failed (${xhr.status}). Try again.`));
    };
    const fail = () => reject(new Error("Upload interrupted. Readiness is saved; retry the photo."));
    xhr.onerror = fail; xhr.onabort = fail; xhr.ontimeout = fail;
    if (upload.transport === "local") {
      const base = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
      // Never forward a kitchen token to an address supplied by an upload response.
      if (!/^\/local-photos\/submissions\/[a-z0-9-]+\/[a-f0-9]{32}\.(jpg|png)$/.test(upload.url)) {
        reject(new Error("Invalid local photo upload address.")); return;
      }
      xhr.open("POST", `${base.replace(/\/$/, "")}${upload.url}`);
      if (bearer) xhr.setRequestHeader("Authorization", `Bearer ${bearer}`);
      else xhr.setRequestHeader("X-Generator-Token", token);
      xhr.setRequestHeader("Content-Type", photo.type);
      xhr.send(photo);
    } else if (upload.transport === "supabase") {
      // Upload capability is scoped to one object. Never send application credentials.
      xhr.open("PUT", upload.url);
      xhr.setRequestHeader("Content-Type", photo.type);
      xhr.send(photo);
    } else {
      const form = new FormData();
      Object.entries(upload.fields).forEach(([name, value]) => form.append(name, value));
      form.append("file", photo, "waste.jpg");
      xhr.open("POST", upload.url);
      xhr.send(form);
    }
  });
}
