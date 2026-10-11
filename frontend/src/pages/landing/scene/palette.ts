/** FeedSure editorial eco-tech palette, shared across the 3D scene and the
 *  SVG fallback. Kept free of any `three` import so the fallback (and the
 *  eagerly-loaded parts of the hero) never pull the 3D engine into the main
 *  bundle — the Three.js scene stays in its own lazy chunk. */
export const PALETTE = {
  ivory: "#F7F6EF",
  forest: "#153F32",
  deep: "#0D2E25",
  sage: "#8EA895",
  lime: "#D0F45A",
  road: "#39463d",
  roadEdge: "#2c3630",
  truck: "#2f7d4f",
  truckDark: "#1f5636",
  metal: "#c6ccc2",
  metalDark: "#9aa89c",
  warm: "#ffcf94",
  water: "#aec6c0",
} as const;
