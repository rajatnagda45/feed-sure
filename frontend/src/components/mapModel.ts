import type { RequestParameters, StyleSpecification } from "maplibre-gl";
import { exclusionAction, formatKg, type MapPoint } from "../workflow";

export type Basemap = { kind: "aws" | "osm"; label: string; style: string | StyleSpecification };

// Public OSM tiles are deliberately limited to an interactive loopback demo.
// AWS configuration always wins; a failed AWS request never silently changes provider.
export function selectBasemap(key: string, region: string, localDemo: boolean): Basemap | null {
  const renderingKey = key.trim();
  if (renderingKey && renderingKey !== "CHANGE_ME") return {
    kind: "aws", label: "Amazon Location Service",
    style: `https://maps.geo.${region}.amazonaws.com/v2/styles/Standard/descriptor?key=${encodeURIComponent(renderingKey)}&color-scheme=Light`,
  };
  if (!localDemo) return null;
  return {
    kind: "osm", label: "OpenStreetMap · local demo",
    style: {
      version: 8,
      sources: { basemap: {
        type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256, maxzoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
      } },
      layers: [{ id: "basemap", type: "raster", source: "basemap" }],
    },
  };
}

export function mapRequest(url: string): RequestParameters {
  // Send only the origin to OSM, satisfying its Referer policy without disclosing
  // private bootstrap paths/query tokens. Preserve normal browser HTTP caching.
  return url.startsWith("https://tile.openstreetmap.org/")
    ? { url, referrerPolicy: "origin" }
    : { url };
}

export function validMapPoints(points: MapPoint[]): MapPoint[] {
  return points.filter(({ lat, lng }) => Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180);
}

export function mapSignature(points: MapPoint[]): string {
  return JSON.stringify(points);
}

export function routeCoordinates(points: MapPoint[]): [number, number][] {
  const depot = points.find((point) => point.kind === "plant");
  const stops = points.filter((point) => point.kind === "stop")
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!depot || stops.length === 0) return [];
  return [depot, ...stops, depot].map((point) => [point.lng, point.lat]);
}

export function mapPointLabel(point: MapPoint): string {
  return [
    point.kind === "plant" ? `${point.name} · departure and return` : point.name,
    point.kind === "stop" ? `Stop ${point.order}` : undefined,
    point.departureAt ? `Departure ${point.departureAt} · return ${point.returnAt}` : undefined,
    point.address, point.window ? `Window ${point.window.start}–${point.window.end}` : undefined,
    point.serviceStartAt ? `Service ${point.serviceStartAt}–${point.serviceEndAt}` : undefined,
    point.confirmedKg !== undefined ? `${formatKg(point.confirmedKg)} confirmed` : undefined,
    point.expectedCollectionKg !== undefined ? `${formatKg(point.expectedCollectionKg)} expected` : undefined,
    point.reservedLoadKg !== undefined ? `${formatKg(point.reservedLoadKg)} reserved` : undefined,
    point.alert,
    point.reason ? `${point.reason} — ${exclusionAction(point.reason)}` : undefined,
  ].filter(Boolean).join(" · ");
}
