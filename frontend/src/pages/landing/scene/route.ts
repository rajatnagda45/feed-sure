import { CatmullRomCurve3, Vector3 } from "three";

export { PALETTE } from "./palette";

/** Control points for the closed collection loop (x, y, z). The journey runs
 *  kitchen → pickup → plant along the front arc, then loops back behind. */
export const ROUTE_POINTS: [number, number, number][] = [
  [-6.3, 0.04, 3.4],
  [-3.2, 0.04, 3.1],
  [-0.6, 0.04, 2.1], // pickup stop
  [2.2, 0.04, 0.7],
  [4.5, 0.04, -1.4],
  [6.0, 0.04, -3.1], // CBG plant
  [4.3, 0.04, -4.7],
  [0.2, 0.04, -4.3],
  [-4.0, 0.04, -3.0],
  [-7.0, 0.04, -0.3],
];

export const curve = new CatmullRomCurve3(
  ROUTE_POINTS.map((p) => new Vector3(p[0], p[1], p[2])),
  true,
  "catmullrom",
  0.5,
);

/** Single source of truth for where each environment sits in the world. The
 *  building components read these, and their position on the road is derived
 *  (not hardcoded) by projecting them onto the curve below. */
export const STOPS = {
  kitchen: new Vector3(-6.4, 0, 3.6),
  pickup: new Vector3(-0.6, 0, 2.1),
  plant: new Vector3(6.0, 0, -3.1),
} as const;

/** Arc-length position (0..1) on the loop nearest to a world point. */
function nearestT(point: Vector3, samples = 1000): number {
  const probe = new Vector3();
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    curve.getPointAt(t, probe);
    const d = probe.distanceToSquared(point);
    if (d < bestD) {
      bestD = d;
      bestT = t;
    }
  }
  return bestT;
}

/** Derived from geometry — these follow the road automatically if the layout
 *  or control points change. */
export const KITCHEN_T = nearestT(STOPS.kitchen);
export const PICKUP_T = nearestT(STOPS.pickup);
export const PLANT_T = nearestT(STOPS.plant);

/** Seconds for one unimpeded lap; real lap time is a little longer because the
 *  truck eases down at the stops. */
export const LOOP_SECONDS = 24;

/** A short dwell window around the kitchen, sized from the first road segment. */
const READY_WINDOW = Math.min(0.08, (PICKUP_T - KITCHEN_T) * 0.4);

/** Circular distance between two loop positions (0..0.5). */
function loopGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
}

/**
 * Active workflow stage derived from the truck's actual position relative to
 * each environment — not fixed thresholds. READY near the kitchen, ROUTED on
 * the way to the pickup, COLLECTED after the pickup, INTAKE RECORDED after the
 * plant until it returns.
 */
export function stageForProgress(p: number): number {
  if (loopGap(p, KITCHEN_T) <= READY_WINDOW) return 0; // READY — at the kitchen
  if (p > PLANT_T || p < KITCHEN_T) return 3; // INTAKE RECORDED — plant → return
  if (p >= PICKUP_T) return 2; // COLLECTED — past the pickup stop
  return 1; // ROUTED — kitchen → pickup
}

/**
 * Speed multiplier that eases the truck down as it reaches the pickup stop and
 * the plant (loading / weighing), then lets it run on the open road. Centred on
 * the geometry-derived stop positions, so it stays aligned if the road changes.
 */
export function speedFactor(p: number): number {
  const dip = (centre: number, width: number, depth: number) =>
    1 - depth * Math.exp(-((loopGap(p, centre) / width) ** 2));
  return Math.min(dip(PICKUP_T, 0.03, 0.85), dip(PLANT_T, 0.035, 0.7));
}
