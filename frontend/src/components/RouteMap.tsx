import { useEffect, useMemo, useRef, useState } from "react";
import {
  LngLatBounds,
  LngLatBoundsLike,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
} from "maplibre-gl";

import { MapPoint } from "../workflow";

const region = import.meta.env.VITE_AWS_REGION ?? "ap-south-1";
const apiKey = import.meta.env.VITE_LOCATION_API_KEY ?? "";
const configured = Boolean(apiKey && apiKey !== "CHANGE_ME");

interface RouteMapProps {
  points: MapPoint[];
}

function Schematic({ points }: RouteMapProps) {
  if (points.length === 0) {
    return <div className="map-empty">Plan a route to see its stops.</div>;
  }
  const lngs = points.map((point) => point.lng);
  const lats = points.map((point) => point.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const position = (point: MapPoint) => ({
    x: 8 + ((point.lng - minLng) / Math.max(maxLng - minLng, 0.001)) * 84,
    y: 92 - ((point.lat - minLat) / Math.max(maxLat - minLat, 0.001)) * 84,
  });
  const route = points.filter((point) => point.kind !== "excluded");
  const polyline = route.map((point) => {
    const { x, y } = position(point);
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="schematic-wrap">
      <svg className="schematic-map" viewBox="0 0 100 100" role="img" aria-label="Schematic route map">
        {polyline && <polyline points={polyline} fill="none" stroke="currentColor" strokeWidth="1.2" />}
        {points.map((point) => {
          const { x, y } = position(point);
          return (
            <g key={point.id} transform={`translate(${x} ${y})`}>
              <circle r="4" className={`schematic-${point.kind}`} />
              <text textAnchor="middle" dominantBaseline="central">
                {point.kind === "plant" ? "◆" : point.kind === "excluded" ? "×" : point.order}
              </text>
              <title>{point.name}{point.reason ? `: ${point.reason}` : ""}</title>
            </g>
          );
        })}
      </svg>
      <p>Schematic straight-line view — not road navigation.</p>
    </div>
  );
}

export function RouteMap({ points }: RouteMapProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const [unavailable, setUnavailable] = useState(!configured);
  const signature = useMemo(
    () => points.map((point) => `${point.id}:${point.lat}:${point.lng}:${point.kind}`).join("|"),
    [points],
  );

  useEffect(() => {
    if (!configured || !container.current || points.length === 0) return;
    let active = true;
    try {
      const instance = new MapLibreMap({
        container: container.current,
        style: `https://maps.geo.${region}.amazonaws.com/v2/styles/Standard/descriptor?key=${apiKey}&color-scheme=Light`,
        center: [points[0].lng, points[0].lat],
        zoom: 11,
        attributionControl: false,
      });
      map.current = instance;
      instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
      instance.on("load", () => {
        if (!active) return;
        const route = points.filter((point) => point.kind !== "excluded");
        if (route.length > 1) {
          instance.addSource("route", {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: route.map((point) => [point.lng, point.lat]) },
            },
          });
          instance.addLayer({
            id: "route",
            type: "line",
            source: "route",
            paint: { "line-color": "#1f4e99", "line-width": 3, "line-dasharray": [2, 1.5] },
          });
        }
        markers.current = points.map((point) => {
          const element = document.createElement("div");
          element.className = `map-marker map-marker-${point.kind}`;
          element.textContent = point.kind === "plant" ? "◆" : point.kind === "excluded" ? "×" : String(point.order);
          element.setAttribute("aria-label", point.name);
          return new Marker({ element })
            .setLngLat([point.lng, point.lat])
            .setPopup(new Popup({ offset: 18 }).setText(
              point.reason ? `${point.name}: ${point.reason}` : point.name,
            ))
            .addTo(instance);
        });
        const bounds = points.reduce(
          (value, point) => value.extend([point.lng, point.lat]),
          new LngLatBounds([points[0].lng, points[0].lat], [points[0].lng, points[0].lat]),
        );
        instance.fitBounds(bounds as LngLatBoundsLike, { padding: 52, maxZoom: 14, duration: 0 });
      });
      instance.on("error", () => {
        if (!active) return;
        setUnavailable(true);
        markers.current.forEach((marker) => marker.remove());
        markers.current = [];
        queueMicrotask(() => {
          if (map.current === instance) {
            instance.remove();
            map.current = null;
          }
        });
      });
    } catch {
      setUnavailable(true);
    }
    return () => {
      active = false;
      markers.current.forEach((marker) => marker.remove());
      markers.current = [];
      map.current?.remove();
      map.current = null;
    };
  }, [signature]);

  if (unavailable) {
    return (
      <div className="map-fallback">
        <p className="map-notice">Map tiles unavailable. The route list remains authoritative.</p>
        <Schematic points={points} />
      </div>
    );
  }

  return (
    <div className="map-frame">
      <div ref={container} className="map-canvas" aria-label="Collection route map" />
      <p className="map-caption">Numbered stops with schematic straight-line connections.</p>
    </div>
  );
}
