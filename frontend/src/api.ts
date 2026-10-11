import { accessToken } from "./supabase";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

export type ErrorCode = "INVALID_INPUT" | "UNAUTHORIZED" | "NOT_FOUND" | "CONFLICT"
  | "UPSTREAM_FAILED" | "DEPENDENCY_NOT_READY" | string;

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ErrorPayload {
  error?: { code?: ErrorCode; message?: string; details?: unknown };
}

export interface RequestOptions extends RequestInit {
  anonymous?: boolean;
  adminToken?: string;
  plantToken?: string;
  generatorToken?: string;
  driverToken?: string;
  idempotencyKey?: string;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { anonymous, adminToken, plantToken, generatorToken, driverToken, idempotencyKey, ...init } = options;
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const bearer = anonymous ? null : await accessToken();
  if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  if (!bearer && adminToken) headers.set("X-Admin-Token", adminToken);
  if (!bearer && plantToken) headers.set("X-Plant-Token", plantToken);
  if (!bearer && generatorToken) headers.set("X-Generator-Token", generatorToken);
  if (!bearer && driverToken) headers.set("X-Driver-Token", driverToken);
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ErrorPayload;
    throw new ApiError(
      response.status,
      payload.error?.code ?? `HTTP_${response.status}`,
      payload.error?.message ?? `FeedSure API request failed with ${response.status}.`,
      payload.error?.details,
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
    body: JSON.stringify({ generatorId, contentType: "image/jpeg" }),
    generatorToken: token,
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

// FeedSure v3 contract types. Legacy photo helpers above remain isolated for deferred P1 work.
export type Lang = "en" | "hi";
export type ReadinessStatus = "READY" | "NOT_READY" | "UNCONFIRMED";
export type WeightSource = "SCALE" | "ESTIMATE";
export type PhotoStatus = "NOT_CHECKED" | "ADVICE" | "REVIEW_HAZARD" | "NO_ISSUE_OBSERVED";
export type PlanStatus = "FEASIBLE" | "MANDATORY_CONFLICT";
export type PlanState = "DRAFT" | "DISPATCHED" | "CLOSED";
export type PickupOutcome = "COLLECTED" | "PARTIAL" | "NOT_READY" | "SKIPPED";
export type GpsStatus = "UNKNOWN" | "IN_RANGE" | "OUT_OF_RANGE";
export type ReconciliationStatus =
  | "PENDING_GATE"
  | "INCOMPLETE"
  | "UNMATCHED_INTAKE"
  | "NO_LOAD"
  | "REVIEW"
  | "WITHIN_TOLERANCE";

export interface TimeWindow {
  start: string;
  end: string;
}

export interface Actor {
  type: "GENERATOR" | "ADMIN" | "DRIVER" | "PLANT_OWNER";
  id: string;
}

export interface GeneratorProfile {
  generatorId: string;
  name: string;
  type: string;
  address: string;
  lat: number;
  lng: number;
  pickupWindow: TimeWindow;
  defaultLang: Lang;
  supportedMaterial: boolean;
  simulated: boolean;
  locationSource?: {
    provider: string;
    url: string;
    coordinateKind: "node" | "feature_center";
    attribution: string;
    copyrightUrl: string;
  };
}

export interface ReadinessRequest {
  generatorId: string;
  collectionDate: string;
  status: "READY" | "NOT_READY";
  confirmedKg?: number;
  weightSource?: WeightSource;
  window?: TimeWindow;
  lang?: Lang;
  reason?: string;
  photoKeys?: string[];
  confirmedBy?: string;
}

export interface ReadinessRecord {
  generatorId: string;
  collectionDate: string;
  status: "READY" | "NOT_READY";
  confirmedKg: number;
  weightSource: WeightSource | null;
  window: TimeWindow | null;
  lang: Lang;
  photoKeys: string[];
  schemaVersion: 3;
  submissionId: string;
  recordedAt: string;
  actor: Actor;
  confirmedBy: string | null;
  reason: string | null;
  simulated: boolean;
  late: boolean;
  photoStatus: PhotoStatus;
  inputRevision: number;
}

export interface HazardRecord {
  action: "ENTER" | "RESOLVE";
  reason: string;
  generatorId: string;
  schemaVersion: 3;
  simulated: boolean;
  recordedAt?: string;
}

export interface OperationGenerator extends GeneratorProfile {
  readiness: ReadinessRecord | null;
  readinessStatus: ReadinessStatus;
  unresolvedHazards: HazardRecord[];
}

export interface PlannerParams {
  targetKg: number;
  truckCapacityKg: number;
  capacityBuffer: number;
  readinessPrior: number;
  shiftStart: string;
  shiftEnd: string;
  serviceMin: number;
  maxRadiusKm: number;
  mandatoryIds: string[];
}

export interface ServiceMode {
  database: "aws" | "local";
  screening: "not_used" | "aws" | "mock";
  matrix: "location" | "fallback" | "fixture";
}

export interface OperationsSnapshot {
  schemaVersion: 3;
  collectionDate: string;
  inputRevision: number;
  generators: OperationGenerator[];
  depot: { id: "plant"; lat: number; lng: number };
  defaults: PlannerParams;
  serviceMode: ServiceMode;
  simulated: boolean;
}

export interface PlanStop {
  generatorId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  window: TimeWindow;
  submissionId: string;
  confirmedKg: number;
  weightSource: WeightSource;
  expectedCollectionKg: number;
  reservedLoadKg: number;
  mandatory: boolean;
  arrivalAt: string;
  serviceStartAt: string;
  serviceEndAt: string;
  simulated: boolean;
}

export interface RouteTotals {
  expectedCollectionKg: number;
  reservedLoadKg: number;
  totalKm: number;
  totalMin: number;
  serviceMin: number;
  waitingMin: number;
}

export interface PlanRoute {
  stops: PlanStop[];
  startAt: string;
  returnAt: string;
  totals: RouteTotals;
}

export type ExclusionReason =
  | "NOT_READY"
  | "UNCONFIRMED"
  | "HAZARD_REVIEW"
  | "UNSUPPORTED_MATERIAL"
  | "OUT_OF_RADIUS"
  | "CAPACITY"
  | "WINDOW"
  | "SHIFT"
  | "MANDATORY_CONFLICT"
  | "TARGET_REACHED"
  | "NOT_SELECTED_BY_HEURISTIC";

export interface PlanEnvelope {
  schemaVersion: 3;
  collectionDate: string;
  inputRevision: number;
  status: PlanStatus;
  params: PlannerParams;
  plan: PlanRoute;
  baseline: PlanRoute;
  excluded: { generatorId: string; reason: ExclusionReason }[];
  shortfall: { kg: number; reasons: ExclusionReason[] };
  mandatoryConflicts: { generatorId: string; reason: ExclusionReason }[];
  matrixSource: "location" | "fallback" | "fixture";
  simulated: boolean;
  assumptions: { readinessPrior: number; volumeRatio: number; capacityBuffer: number };
  planKey: string;
  planId: string;
  version: number;
  state: PlanState;
  createdAt: string;
  dispatchedAt: string | null;
  inputIds: string[];
  inputs?: { depot: { id: string; lat: number; lng: number }; generators: OperationGenerator[] };
  serviceMode: ServiceMode;
}

export interface GpsEvidence {
  lat: number;
  lng: number;
  accuracyM: number;
  deviceAt: string;
}

export interface PickupRequest {
  planKey: string;
  generatorId: string;
  outcome: PickupOutcome;
  kg: number;
  weightSource: WeightSource | null;
  reason: string | null;
  remainingKg: number | null;
  remainingUnknown: boolean;
  gps: GpsEvidence | null;
  expectedRevision: number;
  correctionReason?: string;
}

export interface PickupRecord extends PickupRequest {
  schemaVersion: 3;
  revision: number;
  recordedAt: string;
  actor: Actor;
  simulated: boolean;
  gpsStatus: GpsStatus;
  distanceM: number | null;
  gpsExpiresAt: number | null;
}

export interface GateRequest {
  planKey: string;
  netKg: number;
  weightSource: WeightSource;
  reference: string | null;
  expectedRevision: number;
  correctionReason?: string;
  grossKg?: number;
  tareKg?: number;
}

export interface GateRecord extends GateRequest {
  schemaVersion: 3;
  revision: number;
  recordedAt: string;
  actor: Actor;
  simulated: boolean;
}

export interface Reconciliation {
  status: ReconciliationStatus;
  pickedKg: number;
  netGateKg: number | null;
  deltaKg: number | null;
  deltaPct: number | null;
  provisional: boolean;
  pendingStopIds: string[];
  gpsFlags: { generatorId: string; status: GpsStatus }[];
}

export interface AlertRecord {
  code: string;
  inputRevision?: number;
  message: string;
}

export interface PlanDetailsResponse {
  plan: PlanEnvelope;
  execution: { pickups: PickupRecord[]; gate: GateRecord | null; reconciliation: Reconciliation };
  alerts: AlertRecord[];
}

export interface DriverTripResponse {
  plan: PlanEnvelope;
  pickups: PickupRecord[];
  gate: GateRecord | null;
  reconciliation: Reconciliation;
  alerts: AlertRecord[];
}

export interface GeneratorReceipt {
  pickup: PickupRecord;
  planKey: string;
  collectionDate: string;
  gateStatus: ReconciliationStatus;
  gateRecorded: boolean;
  provisional: boolean;
}

export interface IntakeTrip {
  planKey: string;
  collectionDate: string;
  dispatchedAt: string;
  returnAt: string;
  simulated: boolean;
  pickups: (Pick<PickupRecord, "generatorId" | "outcome" | "kg" | "weightSource" | "recordedAt"> & { name: string })[];
  gate: GateRecord | null;
  reconciliation: Reconciliation;
}

export interface IntakeResponse {
  schemaVersion: 3;
  collectionDate: string;
  database: "local" | "aws";
  trips: IntakeTrip[];
}

export function getPlantIntake(date: string, plantToken: string, signal?: AbortSignal) {
  return apiRequest<IntakeResponse>(`/intake?date=${encodeURIComponent(date)}`, { plantToken, signal });
}

export function savePlantGate(request: GateRequest, plantToken: string, idempotencyKey: string) {
  return apiRequest<{ gate: GateRecord; reconciliation: Reconciliation }>("/gate-logs", {
    method: "POST", plantToken, idempotencyKey, body: JSON.stringify(request),
  });
}

export function createIdempotencyKey(scope: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${scope}:${random}`.slice(0, 128);
}

export function getGenerator(generatorId: string, token: string, signal?: AbortSignal) {
  return apiRequest<{ generator: GeneratorProfile }>(
    `/generators/${encodeURIComponent(generatorId)}`,
    { generatorToken: token, signal },
  );
}

export function saveReadiness(
  request: ReadinessRequest,
  auth: { generatorToken?: string; adminToken?: string },
) {
  return apiRequest<{ submission: ReadinessRecord; inputRevision: number }>("/submissions", {
    method: "POST",
    body: JSON.stringify(request),
    ...auth,
  });
}

export function getGeneratorReceipts(
  generatorId: string,
  token: string,
  month?: string,
  signal?: AbortSignal,
) {
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  return apiRequest<{ generatorId: string; records: GeneratorReceipt[]; schemaVersion: 3 }>(
    `/generators/${encodeURIComponent(generatorId)}/receipts${query}`,
    { generatorToken: token, signal },
  );
}

export function getOperations(date: string, token: string, signal?: AbortSignal) {
  return apiRequest<OperationsSnapshot>(`/operations?date=${encodeURIComponent(date)}`, {
    adminToken: token,
    signal,
  });
}

export function recordHazardReview(
  generatorId: string,
  token: string,
  request: { collectionDate: string; action: "ENTER" | "RESOLVE"; reason: string },
) {
  return apiRequest<{ hazard: HazardRecord; inputRevision: number }>(
    `/generators/${encodeURIComponent(generatorId)}/hazard-reviews`,
    { method: "POST", body: JSON.stringify(request), adminToken: token },
  );
}

export function createPlan(token: string, request: Partial<PlannerParams> & { collectionDate: string }) {
  return apiRequest<PlanEnvelope>("/plans", {
    method: "POST",
    body: JSON.stringify(request),
    adminToken: token,
  });
}

export function getLatestPlan(date: string, token: string, signal?: AbortSignal) {
  return apiRequest<{ plan: PlanEnvelope | null }>(`/plans/${encodeURIComponent(date)}`, {
    adminToken: token,
    signal,
  });
}

export function getPlanDetails(planKey: string, token: string, signal?: AbortSignal) {
  return apiRequest<PlanDetailsResponse>(
    `/plans/${encodeURIComponent(planKey)}/details`,
    { adminToken: token, signal },
  );
}

export function dispatchPlan(
  planKey: string,
  token: string,
  request: { expectedVersion: number; expectedInputRevision: number },
  idempotencyKey: string,
) {
  return apiRequest<{
    plan: PlanEnvelope;
    driverAccess: { token: string; expiresAt: string };
  }>(`/plans/${encodeURIComponent(planKey)}/dispatch`, {
    method: "POST",
    body: JSON.stringify(request),
    adminToken: token,
    idempotencyKey,
  });
}

export function getDriverTrip(planKey: string, token: string, signal?: AbortSignal) {
  return apiRequest<DriverTripResponse>(
    `/plans/${encodeURIComponent(planKey)}/driver`,
    { driverToken: token, signal },
  );
}

export function savePickup(
  request: PickupRequest,
  token: string,
  idempotencyKey: string,
) {
  return apiRequest<{ pickup: PickupRecord; reconciliation: Reconciliation }>("/pickups", {
    method: "POST",
    body: JSON.stringify(request),
    driverToken: token,
    idempotencyKey,
  });
}

export function saveGate(request: GateRequest, token: string, idempotencyKey: string) {
  return apiRequest<{ gate: GateRecord; reconciliation: Reconciliation }>("/gate-logs", {
    method: "POST",
    body: JSON.stringify(request),
    adminToken: token,
    idempotencyKey,
  });
}
