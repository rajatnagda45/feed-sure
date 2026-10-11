import type { RoadRoute } from "../api";

/** Reject malformed paths rather than manufacturing a line between stops. */
export function roadGeometry(route?: RoadRoute): GeoJSON.MultiLineString | null {
  const geometry = route?.geometry;
  if (route?.status !== "ready" || !["osrm", "location"].includes(route.source)
    || geometry?.type !== "MultiLineString" || !Array.isArray(geometry.coordinates)
    || !geometry.coordinates.length) return null;
  let count = 0;
  for (const line of geometry.coordinates) {
    if (!Array.isArray(line) || line.length < 2) return null;
    count += line.length;
    if (count > 6000 || line.some(point => !Array.isArray(point) || point.length !== 2
      || !Number.isFinite(point[0]) || !Number.isFinite(point[1])
      || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90)) return null;
  }
  return geometry;
}
