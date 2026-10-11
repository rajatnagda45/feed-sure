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

/** Approximate arc-length positions (0..1) of the key environments. */
export const PICKUP_T = 0.22;
export const PLANT_T = 0.52;

/** Seconds for one full lap of the loop (before the pickup slow-down). */
export const LOOP_SECONDS = 20;

/** Map loop progress (0..1) to the active workflow stage index (0..3). */
export function stageForProgress(p: number): number {
  if (p < 0.1) return 0; // READY — leaving the kitchen
  if (p < PICKUP_T) return 1; // ROUTED — on the road
  if (p < PLANT_T) return 2; // COLLECTED — past the pickup stop
  if (p < 0.68) return 3; // INTAKE RECORDED — arriving at the plant
  return 0; // returning behind the landscape → ready again
}

/** Speed multiplier that eases the truck to a near-stop at the pickup stop. */
export function speedFactor(p: number): number {
  const d = (p - PICKUP_T) / 0.035;
  return 1 - 0.82 * Math.exp(-d * d);
}
