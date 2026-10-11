import { describe, expect, it, vi } from "vitest";

import { pickupRequest, planMapPoints, readinessRequest, requestGps, serviceDateInIndia } from "./workflow";

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
