import { describe, expect, it } from "vitest";
import { mapPointLabel, mapRequest, mapSignature, routeCoordinates, selectBasemap, validMapPoints } from "./mapModel";
import type { MapPoint } from "../workflow";

const depot: MapPoint = { id: "plant", name: "Plant", lat: 18.5, lng: 73.9, kind: "plant" };
const one: MapPoint = { id: "one", name: "Kitchen one", lat: 18.6, lng: 73.8, kind: "stop", order: 1 };
const two: MapPoint = { id: "two", name: "Kitchen two", lat: 18.7, lng: 73.7, kind: "stop", order: 2 };
const excluded: MapPoint = { id: "excluded", name: "Kitchen held", lat: 18.8, lng: 73.6, kind: "excluded", reason: "HAZARD_REVIEW" };

describe("geographic map scene", () => {
  it("connects actual stop order and closes return, without routing through exclusions", () => {
    expect(routeCoordinates([depot, two, excluded, one])).toEqual([[73.9, 18.5], [73.8, 18.6], [73.7, 18.7], [73.9, 18.5]]);
    expect(routeCoordinates([depot, excluded])).toEqual([]);
    expect(routeCoordinates([one])).toEqual([]);
  });
  it("refreshes scene for changed order, reasons and windows, but ignores polling object identity", () => {
    const points = [depot, one, two, excluded];
    expect(mapSignature(points)).toBe(mapSignature(points.map((point) => ({ ...point }))));
    expect(mapSignature(points)).not.toBe(mapSignature([depot, { ...one, order: 2 }, { ...two, order: 1 }, excluded]));
    expect(mapSignature(points)).not.toBe(mapSignature([depot, one, two, { ...excluded, reason: "NOT_READY" }]));
    expect(mapSignature([one])).not.toBe(mapSignature([{ ...one, window: { start: "07:00", end: "09:00" } }]));
  });
  it("does not feed malformed coordinates to WebGL", () => {
    expect(validMapPoints([depot, { ...one, lat: NaN }, { ...two, lng: 190 }, { ...excluded, lat: Infinity }])).toEqual([depot]);
  });
  it("includes actionable detail in plain-text accessible marker labels", () => {
    expect(mapPointLabel({ ...one, address: "Kitchen road", window: { start: "06:00", end: "08:00" }, serviceStartAt: "07:00", serviceEndAt: "07:10" })).toContain("Window 06:00–08:00");
    expect(mapPointLabel(depot)).toContain("departure and return");
    expect(mapPointLabel(excluded)).toContain("HAZARD_REVIEW");
  });
});

describe("basemap provenance and privacy", () => {
  it("prefers configured AWS, never silently substitutes OSM", () => {
    expect(selectBasemap("configured-rendering-key", "ap-south-1", true)?.kind).toBe("aws");
    expect(selectBasemap("", "ap-south-1", false)).toBeNull();
    expect(selectBasemap("CHANGE_ME", "ap-south-1", true)?.kind).toBe("osm");
  });
  it("keeps public attribution and requests only origin with default browser caching", () => {
    const provider = selectBasemap("", "ap-south-1", true)!;
    expect(JSON.stringify(provider.style)).toContain("OpenStreetMap contributors");
    expect(mapRequest("https://tile.openstreetmap.org/12/2889/1831.png")).toEqual({ url: "https://tile.openstreetmap.org/12/2889/1831.png", referrerPolicy: "origin" });
    expect(mapRequest("https://maps.geo.ap-south-1.amazonaws.com/style")).toEqual({ url: "https://maps.geo.ap-south-1.amazonaws.com/style" });
  });
});

it("trims configured rendering keys and preserves complete popup context", () => {
  const configured = selectBasemap("  rendering-key  ", "ap-south-1", true)!;
  expect(configured.kind).toBe("aws");
  expect(configured.style).toContain("key=rendering-key&");
  expect(selectBasemap("  CHANGE_ME  ", "ap-south-1", false)).toBeNull();
  const label = mapPointLabel({ ...one, confirmedKg: 100, expectedCollectionKg: 80, reservedLoadKg: 110, alert: "Kitchen cancelled — contact dispatch" });
  expect(label).toContain("100 kg confirmed");
  expect(label).toContain("80 kg expected");
  expect(label).toContain("110 kg reserved");
  expect(label).toContain("Kitchen cancelled");
  expect(mapPointLabel(excluded)).toContain("Resolve the hazard before loading");
  expect(mapPointLabel({ ...depot, departureAt: "06:00", returnAt: "10:00" })).toContain("Departure 06:00 · return 10:00");
});
