import { Suspense, lazy, useEffect, useRef, useState } from "react";

import { prefersReducedMotion } from "./motion";
import { ScenePlaceholder } from "./scene/ScenePlaceholder";
import { StageIndicators } from "./scene/StageIndicators";
import { StaticScene } from "./scene/StaticScene";

const SceneCanvas = lazy(() => import("./scene/SceneCanvas"));

function webglAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")),
    );
  } catch {
    return false;
  }
}

/** Decide once, synchronously, so capable browsers never render the flat SVG
 *  fallback first. Guarded for non-browser (SSR / test) environments. */
function canRender3D(): boolean {
  return typeof window !== "undefined" && !prefersReducedMotion() && webglAvailable();
}

function pointerIsFine(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    !prefersReducedMotion() &&
    window.matchMedia("(pointer: fine)").matches
  );
}

/**
 * The hero's living collection ecosystem. Renders a lazy-loaded React Three
 * Fiber scene; falls back to a code-generated SVG for reduced-motion users,
 * while the 3D chunk loads, and when WebGL is unavailable. Rendering pauses
 * while the hero is offscreen. No raster image is used anywhere.
 */
export function CollectionJourneyScene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(0);
  const [active, setActive] = useState(true);
  // Decided once on first render — no false flash of the SVG fallback.
  const [use3D] = useState(canRender3D);
  const [interactive] = useState(pointerIsFine);

  // Pause the render loop while the hero scrolls out of view.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => setActive(entries[0]?.isIntersecting ?? true),
      { rootMargin: "120px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <figure className="fs-scene" ref={containerRef}>
      <div className="fs-scene__stage">
        {use3D ? (
          <Suspense fallback={<ScenePlaceholder />}>
            <SceneCanvas onStage={setStage} interactive={interactive} active={active} />
          </Suspense>
        ) : (
          <StaticScene />
        )}
      </div>
      <figcaption className="fs-scene__caption">
        <StageIndicators active={stage} />
        <span className="fs-tag fs-tag--muted fs-scene__demotag">Illustrative animation</span>
      </figcaption>
    </figure>
  );
}
