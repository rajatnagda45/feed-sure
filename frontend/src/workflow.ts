import {
  GpsEvidence,
  OperationGenerator,
  PickupOutcome,
  PickupRequest,
  PlanEnvelope,
  ReadinessRequest,
  Reconciliation,
  WeightSource,
} from "./api";

export const INDIA_TIME_ZONE = "Asia/Kolkata";

export function serviceDateInIndia(now = new Date(), addDays = 1): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const base = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  base.setUTCDate(base.getUTCDate() + addDays);
  return base.toISOString().slice(0, 10);
}

export function monthForDate(date: string): string {
  return date.slice(0, 7);
}

export interface ReadinessDraft {
  generatorId: string;
  collectionDate: string;
  status: "READY" | "NOT_READY";
  confirmedKg: string;
  weightSource: WeightSource;
  windowStart: string;
  windowEnd: string;
  reason: string;
  lang: "en" | "hi";
  confirmedBy?: string;
}

export function readinessRequest(draft: ReadinessDraft): {
  request?: ReadinessRequest;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.collectionDate)) {
    errors.collectionDate = "Choose a valid collection date.";
  }
  if (draft.status === "NOT_READY") {
    return {
      errors,
      request: Object.keys(errors).length
        ? undefined
        : {
            generatorId: draft.generatorId,
            collectionDate: draft.collectionDate,
            status: "NOT_READY",
            reason: draft.reason.trim() || undefined,
            lang: draft.lang,
          },
    };
  }
  const kg = Number(draft.confirmedKg);
  if (!Number.isFinite(kg) || kg <= 0 || kg > 5000) {
    errors.confirmedKg = "Enter a quantity above 0 and no more than 5,000 kg.";
  }
  if (!/^\d{2}:\d{2}$/.test(draft.windowStart)
    || !/^\d{2}:\d{2}$/.test(draft.windowEnd)
    || draft.windowStart >= draft.windowEnd) {
    errors.window = "Pickup end time must be later than the start time.";
  }
  return {
    errors,
    request: Object.keys(errors).length
      ? undefined
      : {
          generatorId: draft.generatorId,
          collectionDate: draft.collectionDate,
          status: "READY",
          confirmedKg: kg,
          weightSource: draft.weightSource,
          window: { start: draft.windowStart, end: draft.windowEnd },
          lang: draft.lang,
          photoKeys: [],
          ...(draft.confirmedBy ? { confirmedBy: draft.confirmedBy, reason: draft.reason.trim() } : {}),
        },
  };
}

export interface PickupDraft {
  outcome: PickupOutcome;
  kg: string;
  weightSource: WeightSource;
  reason: string;
  remainingKg: string;
  remainingUnknown: boolean;
  correctionReason: string;
}

export function updatePickupDraft<K extends keyof PickupDraft>(draft: PickupDraft, key: K, value: PickupDraft[K]): PickupDraft {
  return { ...draft, [key]: value, ...(key === "remainingUnknown" && value === true ? { remainingKg: "" } : {}) };
}

export function pickupRequest(
  planKey: string,
  generatorId: string,
  expectedRevision: number,
  draft: PickupDraft,
  gps: GpsEvidence | null,
): { request?: PickupRequest; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const positiveOutcome = draft.outcome === "COLLECTED" || draft.outcome === "PARTIAL";
  const kg = positiveOutcome ? Number(draft.kg) : 0;
  if (positiveOutcome && (!Number.isFinite(kg) || kg <= 0 || kg > 5000)) {
    errors.kg = "Enter a collected quantity above 0 and no more than 5,000 kg.";
  }
  if (draft.outcome !== "COLLECTED" && !draft.reason.trim()) {
    errors.reason = "Add a reason for this outcome.";
  }
  let remainingKg: number | null = null;
  if (draft.outcome === "PARTIAL") {
    if (draft.remainingUnknown && draft.remainingKg !== "") {
      errors.remainingKg = "Choose a remaining quantity or mark it unknown, not both.";
    } else if (!draft.remainingUnknown) {
      remainingKg = Number(draft.remainingKg);
      if (!Number.isFinite(remainingKg) || remainingKg <= 0) {
        errors.remainingKg = "Enter the positive quantity left behind or mark it unknown.";
      }
    }
  }
  if (expectedRevision > 0 && !draft.correctionReason.trim()) {
    errors.correctionReason = "Explain why the saved outcome is being corrected.";
  }
  return {
    errors,
    request: Object.keys(errors).length
      ? undefined
      : {
          planKey,
          generatorId,
          outcome: draft.outcome,
          kg,
          weightSource: positiveOutcome ? draft.weightSource : null,
          reason: draft.outcome === "COLLECTED" ? null : draft.reason.trim(),
          remainingKg: draft.outcome === "PARTIAL" ? remainingKg : null,
          remainingUnknown: draft.outcome === "PARTIAL" && draft.remainingUnknown,
          gps,
          expectedRevision,
          ...(expectedRevision > 0 ? { correctionReason: draft.correctionReason.trim() } : {}),
        },
  };
}

export function parseNetGateKg(value: string): number | null {
  const kg = Number(value);
  return value.trim() && Number.isFinite(kg) && kg >= 0 ? kg : null;
}

export function formatKg(value: number | null | undefined): string {
  return value === null || value === undefined ? "N/A" : `${value.toLocaleString("en-IN")} kg`;
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "N/A" : `${value.toFixed(1)}%`;
}

export function reconciliationLabel(value: Reconciliation["status"]): string {
  return {
    PENDING_GATE: "Waiting for gate weight",
    INCOMPLETE: "Pickup outcomes incomplete",
    UNMATCHED_INTAKE: "Intake without recorded pickup",
    NO_LOAD: "No load recorded",
    REVIEW: "Review discrepancy",
    WITHIN_TOLERANCE: "Within alert tolerance",
  }[value];
}

export function exclusionAction(reason: string): string {
  return {
    NOT_READY: "Arrange another collection date.",
    UNCONFIRMED: "Confirm availability.",
    HAZARD_REVIEW: "Resolve the hazard before loading.",
    UNSUPPORTED_MATERIAL: "Verify the accepted material.",
    OUT_OF_RADIUS: "Arrange another pickup.",
    CAPACITY: "Increase capacity or defer this stop.",
    WINDOW: "Change the pickup window.",
    SHIFT: "Adjust the shift or defer this stop.",
    MANDATORY_CONFLICT: "Resolve the commitment conflict.",
    TARGET_REACHED: "Keep in the deferred service queue.",
    NOT_SELECTED_BY_HEURISTIC: "Review for a later trip.",
  }[reason] ?? "Review this exclusion.";
}

export interface MapPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: "plant" | "stop" | "excluded";
  order?: number;
  reason?: string;
  address?: string;
  window?: { start: string; end: string };
  serviceStartAt?: string;
  serviceEndAt?: string;
  confirmedKg?: number;
  expectedCollectionKg?: number;
  reservedLoadKg?: number;
  alert?: string;
  departureAt?: string;
  returnAt?: string;
}

export function planMapPoints(
  plan: PlanEnvelope | null,
  generators: OperationGenerator[],
  depot: { id: string; lat: number; lng: number } | null,
): MapPoint[] {
  if (!depot) return [];
  const points: MapPoint[] = [{ ...depot, name: "CBG plant", kind: "plant", departureAt: plan?.plan.startAt, returnAt: plan?.plan.returnAt }];
  const stopIds = new Set(plan?.plan.stops.map((stop) => stop.generatorId) ?? []);
  for (const [index, stop] of (plan?.plan.stops ?? []).entries()) {
    const current = generators.find((generator) => generator.generatorId === stop.generatorId);
    const alert = current?.unresolvedHazards.length ? "Current hazard hold — contact dispatch before loading"
      : current?.readinessStatus === "NOT_READY" ? (plan?.state === "DISPATCHED" ? "Kitchen cancelled — contact dispatch; route remains frozen" : "Kitchen cancelled — re-plan before dispatch") : undefined;
    points.push({ id: stop.generatorId, name: stop.name, lat: stop.lat, lng: stop.lng, kind: "stop", order: index + 1,
      address: stop.address, window: stop.window, serviceStartAt: stop.serviceStartAt, serviceEndAt: stop.serviceEndAt,
      confirmedKg: stop.confirmedKg, expectedCollectionKg: stop.expectedCollectionKg, reservedLoadKg: stop.reservedLoadKg, alert });
  }
  const excludedById = new Map(plan?.excluded.map((item) => [item.generatorId, item.reason]) ?? []);
  for (const generator of generators) {
    if (stopIds.has(generator.generatorId)) continue;
    points.push({
      id: generator.generatorId,
      name: generator.name,
      lat: generator.lat,
      lng: generator.lng,
      kind: "excluded",
      reason: generator.unresolvedHazards.length ? "HAZARD_REVIEW" : excludedById.get(generator.generatorId) ?? generator.readinessStatus,
      address: generator.address,
      window: generator.readiness?.window ?? undefined,
      confirmedKg: generator.readiness?.confirmedKg ?? undefined,
    });
  }
  return points;
}

export function formatServiceDate(date: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: INDIA_TIME_ZONE })
    .format(new Date(`${date}T00:00:00+05:30`));
}

export function confirmedSupplyKg(generators: OperationGenerator[], eligibleOnly = false): number {
  return generators.reduce((sum, generator) => sum + (generator.readinessStatus === "READY"
    && (!eligibleOnly || (generator.unresolvedHazards.length === 0 && generator.supportedMaterial))
    ? generator.readiness?.confirmedKg ?? 0 : 0), 0);
}

export type GpsAttempt =
  | { state: "captured"; gps: GpsEvidence; message: string }
  | { state: "unavailable" | "denied"; gps: null; message: string };

export function requestGps(
  geolocation: Geolocation | undefined = typeof navigator === "undefined" ? undefined : navigator.geolocation,
  timeoutMs = 6000,
): Promise<GpsAttempt> {
  if (!geolocation) {
    return Promise.resolve({ state: "unavailable", gps: null, message: "Location is unavailable. The outcome can still be saved." });
  }
  return new Promise((resolve) => {
    try {
      geolocation.getCurrentPosition(
      (position) => resolve({
        state: "captured",
        gps: {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyM: position.coords.accuracy,
          deviceAt: new Date(position.timestamp).toISOString(),
        },
        message: `Location captured with ±${Math.round(position.coords.accuracy)} m accuracy.`,
      }),
      (error) => resolve({
        state: error.code === error.PERMISSION_DENIED ? "denied" : "unavailable",
        gps: null,
        message: error.code === error.PERMISSION_DENIED
          ? "Location permission was denied. The outcome can still be saved."
          : "Location could not be captured. The outcome can still be saved.",
      }),
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
      );
    } catch {
      resolve({ state: "unavailable", gps: null, message: "Location could not be captured. The outcome can still be saved." });
    }
  });
}
