import { expect, it } from "vitest";
import type { RoadRoute } from "../api";
import { roadGeometry } from "./roadGeometry";

const route: RoadRoute = { status: "ready", source: "osrm", geometry: {
  type: "MultiLineString", coordinates: [[[77.4, 12.6], [77.45, 12.62], [77.5, 12.7]]],
} };
it("keeps road bends instead of replacing them with stop-to-stop vectors", () => {
  expect(roadGeometry(route)).toEqual(route.geometry);
});
it("rejects missing, estimated and malformed geometry", () => {
  expect(roadGeometry()).toBeNull();
  expect(roadGeometry({ ...route, status: "unavailable" })).toBeNull();
  expect(roadGeometry({ ...route, source: "fallback" })).toBeNull();
  for (const coordinates of [[], [[]], [[[77, 12]]], [[[77, NaN], [77, 12]]], [[[181, 12], [77, 12]]]]) {
    expect(roadGeometry({ ...route, geometry: { type: "MultiLineString", coordinates } })).toBeNull();
  }
});
