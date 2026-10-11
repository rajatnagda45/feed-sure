import { describe, expect, it } from "vitest";
import { isCollectionDate, readinessRequest, ReadinessDraft } from "./workflow";

const draft: ReadinessDraft = {
  generatorId: "site-1", collectionDate: "2026-10-12", status: "READY",
  confirmedKg: "25.5", weightSource: "ESTIMATE", windowStart: "06:00", windowEnd: "09:00",
  reason: "", lang: "en",
};

describe("daily waste collection details", () => {
  it("requires a real calendar date, including for not-ready confirmations", () => {
    for (const collectionDate of ["", "2026-02-29", "2026-04-31", "2026-13-01", "not-a-date"]) {
      expect(isCollectionDate(collectionDate)).toBe(false);
      for (const status of ["READY", "NOT_READY"] as const) {
        const result = readinessRequest({ ...draft, collectionDate, status });
        expect(result.request).toBeUndefined();
        expect(result.errors.collectionDate).toBeTruthy();
      }
    }
    expect(isCollectionDate("2028-02-29")).toBe(true);
  });

  it("rejects impossible, empty and overnight pickup windows", () => {
    for (const [windowStart, windowEnd] of [["06:00", "24:00"], ["06:60", "09:00"], ["", "09:00"], ["23:00", "01:00"], ["09:00", "09:00"]]) {
      const result = readinessRequest({ ...draft, windowStart, windowEnd });
      expect(result.request).toBeUndefined();
      expect(result.errors.window).toBeTruthy();
    }
  });

  it("saves a measured or estimated amount without a photo", () => {
    for (const weightSource of ["ESTIMATE", "SCALE"] as const) {
      const result = readinessRequest({ ...draft, weightSource });
      expect(result.errors).toEqual({});
      expect(result.request).toMatchObject({ confirmedKg: 25.5, weightSource, photoKeys: [] });
    }
  });

  it("omits hidden weight and window values when waste is not ready", () => {
    const result = readinessRequest({ ...draft, status: "NOT_READY", confirmedKg: "NaN",
      windowStart: "", windowEnd: "", reason: "  Site closed  " });
    expect(result.errors).toEqual({});
    expect(result.request).toEqual({ generatorId: "site-1", collectionDate: "2026-10-12",
      status: "NOT_READY", reason: "Site closed", lang: "en" });
  });
});
