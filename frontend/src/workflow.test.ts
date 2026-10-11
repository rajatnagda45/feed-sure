import { describe, expect, it, vi } from "vitest";

import { confirmedSupplyKg, formatServiceDate, parseNetGateKg, pickupRequest, planMapPoints, readinessRequest, requestGps, serviceDateInIndia, updatePickupDraft } from "./workflow";
import type { OperationGenerator, PlanEnvelope } from "./api";

describe("contract workflow normalization", () => {
  it("saves READY without photos or AI fields", () => {
    const result = readinessRequest({
      generatorId: "generator#1",
      collectionDate: "2026-10-12",
      status: "READY",
      confirmedKg: "245.5",
      weightSource: "ESTIMATE",
      windowStart: "06:00",
      windowEnd: "08:30",
      reason: "",
      lang: "en",
    });

    expect(result.errors).toEqual({});
    expect(result.request).toMatchObject({
      generatorId: "generator#1",
      status: "READY",
      confirmedKg: 245.5,
      weightSource: "ESTIMATE",
      photoKeys: [],
    });
  });

  it("accepts NOT_READY without quantity and enforces partial remainder semantics", () => {
    expect(readinessRequest({
      generatorId: "g-1", collectionDate: "2026-10-12", status: "NOT_READY",
      confirmedKg: "", weightSource: "ESTIMATE", windowStart: "", windowEnd: "",
      reason: "closed", lang: "hi",
    }).request).toMatchObject({ status: "NOT_READY", reason: "closed" });

    const partial = pickupRequest("2026-10-12#v1", "g-1", 0, {
      outcome: "PARTIAL", kg: "100", weightSource: "SCALE", reason: "Truck full",
      remainingKg: "", remainingUnknown: true, correctionReason: "",
    }, null);
    expect(partial.request).toMatchObject({ outcome: "PARTIAL", kg: 100, remainingKg: null, remainingUnknown: true });
  });

  it("requires a correction reason for a saved pickup revision", () => {
    const result = pickupRequest("plan", "g-1", 2, {
      outcome: "COLLECTED", kg: "90", weightSource: "SCALE", reason: "",
      remainingKg: "", remainingUnknown: false, correctionReason: "",
    }, null);
    expect(result.errors.correctionReason).toBeTruthy();
  });

  it("uses India-local tomorrow instead of the browser timezone", () => {
    expect(serviceDateInIndia(new Date("2026-10-11T19:30:00.000Z"))).toBe("2026-10-13");
  });

  it("allows save to continue when GPS permission is denied", async () => {
    const denied = {
      getCurrentPosition: vi.fn((_success, error) => error({ code: 1, PERMISSION_DENIED: 1 })),
    } as unknown as Geolocation;
    await expect(requestGps(denied)).resolves.toMatchObject({ state: "denied", gps: null });
  });

  it("keeps excluded kitchens visible in the fallback map", () => {
    const points = planMapPoints(null, [{
      generatorId: "g-1", name: "Kitchen", type: "HOSTEL", address: "Pune",
      lat: 18.5, lng: 73.8, pickupWindow: { start: "06:00", end: "08:00" },
      defaultLang: "en", supportedMaterial: true, simulated: true, readiness: null,
      readinessStatus: "UNCONFIRMED", unresolvedHazards: [],
    }], { id: "plant", lat: 18.6, lng: 73.9 });
    expect(points.map((point) => point.kind)).toEqual(["plant", "excluded"]);
  });
});

it("distinguishes missing gate weight from an explicitly recorded zero", () => {
  for (const value of ["", "   ", "-1", "NaN", "Infinity"]) expect(parseNetGateKg(value)).toBeNull();
  expect(parseNetGateKg("0")).toBe(0);
  expect(parseNetGateKg(" 155.5 ")).toBe(155.5);
});

it("reports confirmed supply separately from material/hazard eligibility", () => {
  const suppliers = [
    { readinessStatus: "READY", readiness: { confirmedKg: 100 }, supportedMaterial: true, unresolvedHazards: [] },
    { readinessStatus: "READY", readiness: { confirmedKg: 200 }, supportedMaterial: true, unresolvedHazards: [{ reason: "chemical" }] },
    { readinessStatus: "READY", readiness: { confirmedKg: 300 }, supportedMaterial: false, unresolvedHazards: [] },
    { readinessStatus: "UNCONFIRMED", readiness: null, supportedMaterial: true, unresolvedHazards: [] },
    { readinessStatus: "NOT_READY", readiness: { confirmedKg: 0 }, supportedMaterial: true, unresolvedHazards: [] },
  ] as OperationGenerator[];
  expect(confirmedSupplyKg(suppliers)).toBe(600);
  expect(confirmedSupplyKg(suppliers, true)).toBe(100);
  expect(formatServiceDate("2026-10-12")).toBe("12 October 2026");
});

it("switches a partial pickup from known remainder to unknown without invalid mixed evidence", () => {
  const known = { outcome: "PARTIAL" as const, kg: "100", weightSource: "SCALE" as const, reason: "Capacity reached", remainingKg: "80", remainingUnknown: false, correctionReason: "" };
  expect(pickupRequest("plan", "kitchen", 0, known, null).request?.remainingKg).toBe(80);
  const unknown = updatePickupDraft(known, "remainingUnknown", true);
  expect(pickupRequest("plan", "kitchen", 0, unknown, null)).toMatchObject({ errors: {}, request: { remainingKg: null, remainingUnknown: true } });
  const needsQuantity = updatePickupDraft(unknown, "remainingUnknown", false);
  expect(pickupRequest("plan", "kitchen", 0, needsQuantity, null).errors.remainingKg).toBeTruthy();
  expect(pickupRequest("plan", "kitchen", 0, updatePickupDraft(needsQuantity, "remainingKg", "30"), null).request?.remainingKg).toBe(30);
});

it("keeps pickup saving available when the browser throws a location security error", async () => {
  const blocked = { getCurrentPosition: () => { throw new Error("SecurityError"); } } as unknown as Geolocation;
  const result = await requestGps(blocked);
  expect(result).toMatchObject({ state: "unavailable", gps: null });
  expect(pickupRequest("plan", "kitchen", 0, { outcome: "COLLECTED", kg: "90", weightSource: "SCALE", reason: "", remainingKg: "", remainingUnknown: false, correctionReason: "" }, result.gps).errors).toEqual({});
});

it("keeps frozen stop coordinates, order and quantities while surfacing a current cancellation", () => {
  const frozen = { state: "DISPATCHED", plan: { startAt: "06:00", returnAt: "08:00", stops: [{
    generatorId: "kitchen", name: "Frozen kitchen", lat: 18.6, lng: 73.8,
    address: "Saved address", window: { start: "06:30", end: "07:30" }, serviceStartAt: "07:00", serviceEndAt: "07:10",
    confirmedKg: 100, expectedCollectionKg: 80, reservedLoadKg: 110,
  }] }, excluded: [] } as unknown as PlanEnvelope;
  const cancelled = { generatorId: "kitchen", readinessStatus: "NOT_READY", lat: 19, lng: 74, unresolvedHazards: [] } as unknown as OperationGenerator;
  const points = planMapPoints(frozen, [cancelled], { id: "plant", lat: 18.5, lng: 73.9 });
  expect(points[0]).toMatchObject({ kind: "plant", departureAt: "06:00", returnAt: "08:00" });
  expect(points[1]).toMatchObject({ kind: "stop", order: 1, lat: 18.6, lng: 73.8, address: "Saved address", confirmedKg: 100, expectedCollectionKg: 80, reservedLoadKg: 110 });
  expect(points[1].alert).toContain("route remains frozen");
  expect(points).toHaveLength(2);
  const held = planMapPoints(frozen, [{ ...cancelled, unresolvedHazards: [{ reason: "visible chemical container" }] } as OperationGenerator], { id: "plant", lat: 18.5, lng: 73.9 });
  expect(held[1].alert).toContain("hazard hold");
});
