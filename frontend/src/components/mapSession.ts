import type { MapPoint } from "../workflow";
import { mapSignature } from "./mapModel";

export type MapStatus = "loading" | "ready" | "failed";
interface MapPort {
  draw(points: MapPoint[]): void;
  fit(points: MapPoint[]): void;
  destroy(): void;
}
interface MapSessionOptions {
  points: MapPoint[];
  open(onLoad: () => void, onFailure: () => void): MapPort;
  onStatus(status: MapStatus): void;
  timeoutMs?: number;
}

// One session owns one map. Polling changes only the scene; recovery is an
// explicit new session, so a broken provider never causes recreation loops.
export function createMapSession({ points, open, onStatus, timeoutMs = 15000 }: MapSessionOptions) {
  let current = points;
  let signature = mapSignature(points);
  let port: MapPort | undefined;
  let loaded = false;
  let fitted = false;
  let closed = false;
  const release = () => {
    const owned = port;
    port = undefined;
    owned?.destroy();
  };
  const fail = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    // Removal aborts tile requests and releases WebGL resources. No provider
    // error is logged because AWS error URLs may contain rendering keys.
    try { release(); } catch { /* A lost WebGL context may already be released. */ }
    onStatus("failed");
  };
  const fit = () => {
    if (!closed && loaded && port && current.length) {
      port.fit(current);
      fitted = true;
    }
  };
  const draw = () => {
    if (closed || !loaded || !port) return;
    try {
      port.draw(current);
      if (!fitted) fit();
    } catch { fail(); }
  };
  const timer = setTimeout(fail, timeoutMs);
  onStatus("loading");
  try {
    port = open(() => {
      if (closed) return;
      loaded = true;
      clearTimeout(timer);
      draw();
      if (!closed) onStatus("ready");
    }, fail);
    // Also support synchronous load/failure from an adapter.
    if (closed) release();
    else if (loaded) draw();
  } catch { fail(); }
  return {
    update(next: MapPoint[], geometryRevision = "") {
      const nextSignature = mapSignature(next) + geometryRevision;
      current = next;
      if (nextSignature === signature) return;
      signature = nextSignature;
      draw();
    },
    fit() { try { fit(); } catch { fail(); } },
    destroy() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      try { release(); } catch { /* Cleanup must not break the route list. */ }
    },
  };
}
