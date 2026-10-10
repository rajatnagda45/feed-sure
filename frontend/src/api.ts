const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface ErrorPayload {
  error?: { message?: string };
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ErrorPayload;
    throw new ApiError(
      response.status,
      payload.error?.message ?? `FeedSure API request failed with ${response.status}`,
    );
  }

  return (await response.json()) as T;
}

export type UploadSlot = "top" | "tray";

export interface PresignedUpload {
  slot: UploadSlot;
  key: string;
  url: string;
  fields: Record<string, string>;
}

interface UploadResponse {
  uploads: PresignedUpload[];
}

export function requestPhotoUploads(generatorId: string, token: string): Promise<UploadResponse> {
  return apiRequest<UploadResponse>("/uploads", {
    method: "POST",
    body: JSON.stringify({ generatorId, token, contentType: "image/jpeg" }),
  });
}

export type Verdict = "ACCEPT" | "INSPECT" | "HOLD";

export interface ObservationItem {
  type: string;
  count: number;
  confidence: number;
}

export interface SubmissionResponse {
  submissionId: string;
  date: string;
  verdict: Verdict;
  reason: string;
  instruction: string;
  observations: {
    items: ObservationItem[];
    visibleContaminantPct: number;
    hazard: boolean;
    imageQuality: string;
    confidence: number;
    notes: string;
  };
  modelId: string;
  screenedAt: string;
}

export function createSubmission(
  generatorId: string,
  token: string,
  reportedKg: number,
  photoKeys: [string, string],
  lang: "en" | "hi",
): Promise<SubmissionResponse> {
  return apiRequest<SubmissionResponse>("/submissions", {
    method: "POST",
    body: JSON.stringify({ generatorId, token, reportedKg, photoKeys, lang }),
  });
}

export interface UploadRequest {
  upload: { onprogress: ((event: ProgressEvent) => void) | null };
  status: number;
  onload: ((event: ProgressEvent) => void) | null;
  onerror: ((event: ProgressEvent) => void) | null;
  onabort: ((event: ProgressEvent) => void) | null;
  ontimeout: ((event: ProgressEvent) => void) | null;
  open: (method: string, url: string) => void;
  send: (body: FormData) => void;
}

export type UploadRequestFactory = () => UploadRequest;

export function uploadPresignedPost(
  upload: PresignedUpload,
  photo: Blob,
  onProgress: (progress: number) => void,
  requestFactory: UploadRequestFactory = () => new XMLHttpRequest(),
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = requestFactory();
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress((event.loaded / event.total) * 100);
      }
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`Photo upload failed with ${request.status}.`));
      }
    };
    const fail = () => reject(new Error("Photo upload failed."));
    request.onerror = fail;
    request.onabort = fail;
    request.ontimeout = fail;

    const form = new FormData();
    for (const [name, value] of Object.entries(upload.fields)) {
      form.append(name, value);
    }
    form.append("file", photo, `${upload.slot}.jpg`);
    request.open("POST", upload.url);
    request.send(form);
  });
}
