import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MapPoint } from "../workflow";
import { RouteMap } from "./RouteMap";

// SSR verifies the usable missing-config surface, not WebGL or tile loading.
vi.mock("./mapModel", async (original) => ({
  ...await original<typeof import("./mapModel")>(), selectBasemap: () => null,
}));
vi.mock("maplibre-gl", () => ({
  AttributionControl: vi.fn(), GeoJSONSource: vi.fn(), LngLatBounds: vi.fn(), Map: vi.fn(),
  Marker: vi.fn(), NavigationControl: vi.fn(), Popup: vi.fn(), setWorkerUrl: vi.fn(),
}));
const points: MapPoint[] = [
  { id: "plant", name: "CBG plant", lat: 18.5, lng: 73.9, kind: "plant" },
  { id: "stop", name: "Kitchen", lat: 18.6, lng: 73.8, kind: "stop", order: 1, window: { start: "06:00", end: "08:00" } },
  { id: "held", name: "Held kitchen", lat: 18.7, lng: 73.7, kind: "excluded", reason: "HAZARD_REVIEW" },
];
describe("map fallback content", () => {
  it("labels missing geography honestly and retains stops, return, legend and exclusion details", () => {
    const html = renderToStaticMarkup(<><RouteMap points={points} /><ol aria-label="Ordered route"><li>Kitchen route remains usable</li></ol></>);
    expect(html).toContain("Schematic · no geographic basemap");
    expect(html).toContain("including return to plant; not road navigation");
    expect(html).toContain("Window 06:00–08:00");
    expect(html).toContain("Resolve the hazard before loading");
    expect(html).toContain("Map legend");
    expect(html).toContain("Road path unavailable");
    expect(html).not.toContain("<polyline");
    expect(html).toContain("Kitchen route remains usable");
    expect(html).not.toContain("Retry basemap");
    expect(html).not.toContain("Amazon Location Service");
  });
  it("escapes supplier text and retains a useful empty/invalid-location state", () => {
    const html = renderToStaticMarkup(<RouteMap points={[{ ...points[1], name: '<img src=x onerror="attack()">' }, { ...points[2], lat: NaN }]} />);
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("Some locations are invalid");
    expect(renderToStaticMarkup(<RouteMap points={[]} />)).toContain("The route list is available below");
  });
});
