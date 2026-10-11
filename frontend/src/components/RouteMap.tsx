import { useEffect, useMemo, useRef, useState } from "react";
import { AttributionControl, GeoJSONSource, LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, Popup, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { MapPoint } from "../workflow";
import { mapPointLabel, mapRequest, mapSignature, selectBasemap, validMapPoints } from "./mapModel";
import type { RoadRoute } from "../api";
import { roadGeometry } from "./roadGeometry";
import { createMapSession, type MapStatus } from "./mapSession";

// MapLibre v6 needs an explicit bundled worker URL under Vite.
setWorkerUrl(workerUrl);

const loopback = typeof window !== "undefined" && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
const provider = selectBasemap(import.meta.env.VITE_LOCATION_API_KEY ?? "", import.meta.env.VITE_AWS_REGION ?? "ap-south-1",
  loopback && (import.meta.env.VITE_LOCAL_DEMO_BASEMAP ?? (import.meta.env.DEV ? "osm" : "off")) === "osm");

interface RouteMapProps { points: MapPoint[]; roadRoute?: RoadRoute }

function Schematic({ points }: RouteMapProps) {
  if (!points.length) return <div className="map-empty">The route list is available below.</div>;
  const minLng = Math.min(...points.map((point) => point.lng));
  const minLat = Math.min(...points.map((point) => point.lat));
  const width = Math.max(...points.map((point) => point.lng)) - minLng;
  const height = Math.max(...points.map((point) => point.lat)) - minLat;
  const position = (lng: number, lat: number) => ({
    x: width ? 8 + ((lng - minLng) / width) * 84 : 50,
    y: height ? 92 - ((lat - minLat) / height) * 84 : 50,
  });
  return <div className="schematic-wrap">
    <svg className="schematic-map" viewBox="0 0 100 100" role="img" aria-label="Schematic stops including return to plant; not road navigation">
      {points.map((point) => {
        const { x, y } = position(point.lng, point.lat);
        return <g key={point.id} transform={`translate(${x} ${y})`}>
          <circle r="4" className={`schematic-${point.kind}`} />
          <text textAnchor="middle" dominantBaseline="central">{point.kind === "plant" ? "P" : point.kind === "excluded" ? "×" : point.order}</text>
          <title>{mapPointLabel(point)}</title>
        </g>;
      })}
    </svg>
    <p>Stop positions only. Use the ordered list for the trip and return to plant.</p>
  </div>;
}

export function RouteMap({ points, roadRoute }: RouteMapProps) {
  const scene = useMemo(() => validMapPoints(points), [points]);
  const signature = mapSignature(scene);
  const mapView = useRef<MapLibreMap | null>(null);
  const latest = useRef(scene);
  latest.current = scene;
  const geometry = useMemo(() => roadGeometry(roadRoute), [roadRoute]);
  const geometrySignature = JSON.stringify(geometry);
  const latestGeometry = useRef(geometry);
  latestGeometry.current = geometry;
  const container = useRef<HTMLDivElement>(null);
  const session = useRef<ReturnType<typeof createMapSession> | null>(null);
  const [status, setStatus] = useState<MapStatus>(provider ? "loading" : "failed");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!provider || !container.current) return;
    const element = container.current;
    const owned = createMapSession({
      points: latest.current,
      onStatus: setStatus,
      open(onLoad, onFailure) {
        const first = latest.current[0];
        const instance = new MapLibreMap({
          container: element, style: provider.style,
          ...(first ? { center: [first.lng, first.lat] as [number, number] } : {}), zoom: 11,
          attributionControl: false, transformRequest: mapRequest,
          // Keep fetch-based raster loading and normal HTTP expiry headers.
          refreshExpiredTiles: true,
        });
        mapView.current = instance;
        let markers: Marker[] = [];
        let observer: ResizeObserver | undefined;
        const destroy = () => {
          observer?.disconnect();
          markers.forEach((marker) => marker.remove());
          markers = [];
          instance.remove();
          mapView.current = null;
        };
        try {
          instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
          instance.addControl(new AttributionControl({ compact: false }), "bottom-right");
          instance.on("load", onLoad);
          instance.on("error", onFailure);
          instance.on("webglcontextlost", onFailure);
          observer = new ResizeObserver(() => instance.resize());
          observer.observe(element);
          return {
            draw(current) {
              const route = latestGeometry.current;
              const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: route ? [{
                type: "Feature", properties: {}, geometry: route,
              }] : [] };
              const source = instance.getSource("collection-route") as GeoJSONSource | undefined;
              if (source) source.setData(data);
              else {
                instance.addSource("collection-route", { type: "geojson", data });
                instance.addLayer({ id: "collection-route", type: "line", source: "collection-route",
                  layout: { "line-cap": "round", "line-join": "round" },
                  paint: { "line-color": "#285a91", "line-width": 4 } });
              }
              markers.forEach((marker) => marker.remove());
              markers = [];
              for (const point of current) {
                const markerElement = document.createElement("button");
                markerElement.type = "button";
                markerElement.className = "map-marker map-marker-" + point.kind;
                markerElement.textContent = point.kind === "plant" ? "P" : point.kind === "excluded" ? "×" : String(point.order);
                markerElement.setAttribute("aria-label", mapPointLabel(point));
                // Plain text prevents supplier addresses/reasons from becoming HTML.
                const marker = new Marker({ element: markerElement }).setLngLat([point.lng, point.lat])
                  .setPopup(new Popup({ offset: 22 }).setText(mapPointLabel(point)));
                markers.push(marker);
                marker.addTo(instance);
              }
            },
            fit(current) {
              const first = current[0];
              const bounds = current.reduce((bounds, point) => bounds.extend([point.lng, point.lat]),
                new LngLatBounds([first.lng, first.lat], [first.lng, first.lat]));
              latestGeometry.current?.coordinates.forEach(line => line.forEach(point => bounds.extend([point[0], point[1]])));
              instance.fitBounds(bounds, { padding: 56, maxZoom: 14, duration: 0 });
            },
            destroy,
          };
        } catch {
          destroy();
          throw new Error("Map initialization failed");
        }
      },
    });
    session.current = owned;
    return () => { owned.destroy(); session.current = null; };
  }, [attempt]);

  useEffect(() => { session.current?.update(latest.current, geometrySignature); }, [signature, geometrySignature]);

  const fitRoute = () => session.current?.fit();

  return <div className="route-map">
    <div className="map-heading">
      <div><strong>Collection area</strong><span>{status === "failed" ? "Schematic · no geographic basemap" : provider?.label ?? "No basemap configured"}</span></div>
      {status === "ready" && <button className="text-button" type="button" onClick={fitRoute}>Fit route</button>}
    </div>
    {status === "ready" && <label className="field">Find a stop on the map<select defaultValue="" onChange={(event) => {
      const point = scene.find((item) => item.id === event.currentTarget.value);
      if (point) mapView.current?.flyTo({ center: [point.lng, point.lat], zoom: 17 });
    }}><option value="">Choose a stop to separate nearby markers</option>{scene.map((point) => <option key={point.id} value={point.id}>{point.kind === "stop" ? `${point.order}. ` : ""}{point.name}</option>)}</select></label>}
    <div className={`map-frame${status === "failed" ? " map-failed" : ""}`}>
      <div ref={container} className="map-canvas" aria-label="Collection area map" aria-hidden={status === "failed"} />
      {status === "loading" && <p className="map-notice" aria-live="polite">Loading geographic basemap…</p>}
      {status === "failed" && <div className="map-fallback">
        <div className="map-notice" role="status">
          <span>{provider ? `${provider.label} could not load (network or WebGL).` : "Configure AWS map access or enable the loopback demo basemap."} The ordered route remains available.</span>
          {provider && <button className="text-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Retry basemap</button>}
        </div>
        <Schematic points={scene} />
      </div>}
    </div>
    <div className="map-legend" aria-label="Map legend">
      <span><b className="legend-plant">P</b> Plant / return</span><span><b className="legend-stop">1</b> Ordered stop</span><span><b className="legend-excluded">×</b> Outside route</span>{geometry && status === "ready" && <span><b className="legend-line" style={{ borderTopStyle: "solid" }} aria-hidden="true" /> Road route</span>}
    </div>
    <p className="map-explanation">{geometry
      ? `Road path in planned stop order, including return to plant. ${roadRoute?.source === "osrm" ? "OSRM driving profile; truck restrictions and live traffic are not verified." : "Amazon Location truck routing."}`
      : "Road path unavailable. Stops are shown without connecting lines. Re-plan with road routing enabled; fallback distances are estimates."} Select a marker for windows and exclusions.</p>
    {provider?.kind === "osm" && <p className="map-policy">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>. Public demo tiles; best-effort availability. <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Report a map issue</a></p>}
    {scene.length !== points.length && <p className="map-policy">Some locations are invalid. Refer to the ordered stop list.</p>}
  </div>;
}
