import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { IntakeTrip } from "./api";
import { IntakeTripPanel, PlantOwnerPage } from "./pages/PlantOwnerPage";

afterEach(() => vi.unstubAllGlobals());

it("opens owner access without borrowing the dispatcher session", () => {
  const getItem = vi.fn().mockReturnValue(null);
  vi.stubGlobal("sessionStorage", { getItem });
  const html = renderToStaticMarkup(createElement(StaticRouter, { location: "/owner" }, createElement(PlantOwnerPage)));
  expect(getItem).toHaveBeenCalledWith("feedsure:plant-owner");
  expect(getItem).not.toHaveBeenCalledWith("feedsure:admin");
  expect(html).toContain("Plant owner token");
  expect(html).toContain("Open plant intake");
});

const trip: IntakeTrip = {
  planKey: "2026-10-11#trip", collectionDate: "2026-10-11", dispatchedAt: "2026-10-11T01:00:00Z",
  returnAt: "10:00", simulated: true, pickups: [], gate: null,
  reconciliation: { status: "PENDING_GATE", pickedKg: 0, netGateKg: null, deltaKg: null, deltaPct: null,
    provisional: false, pendingStopIds: ["hotel-a"], gpsFlags: [] },
};

it("shows missing weights and unresolved pickups without inventing intake totals", () => {
  const html = renderToStaticMarkup(createElement(IntakeTripPanel, { trip, token: "test-only", refresh: vi.fn(), onSaving: vi.fn() }));
  expect(html).toContain("Pickup outcomes still pending: hotel-a");
  expect(html).toContain("Simulated supplier data");
  expect(html).toContain("Save net intake");
  expect(html).not.toContain("Correction reason");
  expect(html).not.toContain("Dispatch reviewed version");
  expect(html).not.toContain("test-only");
});

it("prefills the recorded gate value and requires an attributable correction", () => {
  const saved = { ...trip, gate: {
    planKey: trip.planKey, netKg: 155, weightSource: "SCALE" as const, reference: "scale-1",
    expectedRevision: 0, schemaVersion: 3 as const, revision: 1, recordedAt: "2026-10-11T05:00:00Z",
    actor: { type: "PLANT_OWNER" as const, id: "plant-owner" }, simulated: true,
  } };
  const html = renderToStaticMarkup(createElement(IntakeTripPanel, { trip: saved, token: "test-only", refresh: vi.fn(), onSaving: vi.fn() }));
  expect(html).toContain('value="155"');
  expect(html).toContain("Correction reason");
  expect(html).toContain("Save correction");
  expect(html).toContain("Gate record revision 1");
  expect(html).toContain("Plant owner");
});
