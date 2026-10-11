/** Quiet neutral placeholder shown only while the 3D chunk downloads, so the
 *  flat SVG scene never flashes before the live scene appears. It just hints at
 *  the miniature's ground and settles into the canvas once it is ready. */
export function ScenePlaceholder() {
  return <div className="fs-scene__loading" aria-hidden="true" />;
}
