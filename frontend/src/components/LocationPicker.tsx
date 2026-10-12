import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { apiRequest } from "../api";
import { mapRequest, selectBasemap } from "./mapModel";
import { requestGps } from "../workflow";

export type LocationPoint = { lat: number; lng: number; label?: string; pincode?: string; locationAccuracy?: "pincode" | "entrance" };
type Point = LocationPoint;
export function LocationPicker({ address, initialPoint, onChange, allowPinArea = false }: { address: string; initialPoint?: Point; onChange: (point: Point | null) => void; allowPinArea?: boolean }) {
  const [pin, setPin] = useState("");
  const [point, setPoint] = useState<Point | null>(initialPoint ?? null);
  const [results, setResults] = useState<Point[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const callback = useRef(onChange); callback.current = onChange;
  const sequence = useRef(0);
  function choose(next: Point) { setPoint(next); setConfirmed(false); callback.current(null); }
  function useResult(next: Point) {
    choose(next);
    if (allowPinArea && next.locationAccuracy === "pincode") callback.current(next);
  }
  useEffect(() => {
    const initial = sequence.current === 0;
    ++sequence.current; setConfirmed(false); setResults([]); if (!initial) setPoint(null); callback.current(null);
  }, [address, pin]);
  useEffect(() => () => { ++sequence.current; }, []);
  useEffect(() => {
    if (!point) {
      marker.current?.remove(); map.current?.remove();
      marker.current = null; map.current = null;
      return;
    }
    if (!point || !container.current || map.current) return;
    const provider = selectBasemap(import.meta.env.VITE_LOCATION_API_KEY ?? "", import.meta.env.VITE_AWS_REGION ?? "ap-south-1",
      ["localhost", "127.0.0.1"].includes(window.location.hostname));
    if (!provider) { setMapFailed(true); return; }
    try {
      setWorkerUrl(workerUrl);
      const view = new MapLibreMap({ container: container.current, style: provider.style, center: [point.lng, point.lat], zoom: 15, transformRequest: mapRequest });
      map.current = view;
      view.addControl(new NavigationControl());
      marker.current = new Marker({ draggable: true }).setLngLat([point.lng, point.lat]).addTo(view);
      view.on("click", (event) => choose({ lat: event.lngLat.lat, lng: event.lngLat.lng }));
      view.on("error", () => setMapFailed(true));
      marker.current.on("dragend", () => { const p = marker.current!.getLngLat(); choose({ lat: p.lat, lng: p.lng }); });
    } catch { setMapFailed(true); }
  }, [point]);
  useEffect(() => { if (point) { marker.current?.setLngLat([point.lng, point.lat]); map.current?.easeTo({ center: [point.lng, point.lat] }); } }, [point]);
  useEffect(() => () => { marker.current?.remove(); map.current?.remove(); }, []);
  async function search(includeAddress: boolean) {
    if (busy) return;
    if (!/^[1-9]\d{5}$/.test(pin)) { setMessage("Enter a valid six-digit Indian PIN code."); return; }
    const current = ++sequence.current;
    setBusy(true); setMessage("");
    try {
      const query = new URLSearchParams({ pincode: pin, ...(includeAddress ? { address } : {}) });
      const result = await apiRequest<{ locations: Point[] }>(`/locations/find?${query}`, { anonymous: true });
      if (current !== sequence.current) return;
      const locations = result.locations.map((location) => ({ ...location, ...(!includeAddress && allowPinArea ? { pincode: pin, locationAccuracy: "pincode" as const } : {}) }));
      setResults(locations);
      if (locations.length === 1 && !includeAddress && allowPinArea) useResult(locations[0]);
      setMessage(locations.length ? (!includeAddress && allowPinArea ? "PIN-code area found. Save your profile to activate access; exact entrance confirmation can wait." : "Choose your area, then move the pin to your actual pickup entrance.") : "No matching location found. Try PIN code only, or use live location at your site.");
    } catch (issue) { if (current === sequence.current) setMessage(issue instanceof Error ? issue.message : "Search unavailable."); }
    finally { setBusy(false); }
  }
  async function locate() {
    const current = ++sequence.current; setBusy(true);
    const result = await requestGps();
    if (current === sequence.current) {
      setMessage(result.gps ? `Device location accuracy: about ${Math.round(result.gps.accuracyM)} m. Check the pickup entrance before confirming.` : "Location was unavailable or denied. Search using your PIN code and address instead.");
      if (result.gps) choose(result.gps);
    }
    setBusy(false);
  }
  return <section className="location-picker" aria-label="Pickup location">
    <label className="field">PIN code<input inputMode="numeric" autoComplete="postal-code" maxLength={6} value={pin} onChange={(event) => setPin(event.currentTarget.value.replace(/\D/g, ""))} /></label>
    <p>{allowPinArea ? "Find your PIN-code area to activate access without confirming a map pin. You can refine the entrance later." : "Find your area using its PIN code, then confirm the actual pickup entrance. You do not need to know its coordinates."}</p>
    <div className="account-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => void search(false)}>Find PIN code</button>
      <button type="button" className="button button-secondary" disabled={busy || !address.trim()} onClick={() => void search(true)}>Find address</button>
      <button type="button" className="text-button" disabled={busy} onClick={() => void locate()}>Use my live location</button></div>
    <small>Search sends the entered PIN code and, for address search, the address to the configured map provider. Live location is optional; use it while at the site.</small>
    {busy && <p role="status">Finding location…</p>}{message && <p role="status">{message}</p>}
    {results.map((result, index) => <button key={index} className="location-result" type="button" onClick={() => useResult(result)}>{result.label}</button>)}
    {point?.locationAccuracy === "pincode" && allowPinArea && !confirmed && <p role="status">Approximate PIN-code location. This is not a confirmed pickup entrance.</p>}
    {point && <><div ref={container} className="location-map" aria-label="Move the pickup pin" />
      {mapFailed && <p role="alert">Map could not load. Use live location at the entrance, or ask your operator to help confirm the pickup location.</p>}
      <p>Click the map or drag the pin. Keyboard adjustments move it roughly 10 metres:</p>
      <div className="account-actions">{([['North', 0.0001, 0], ['South', -0.0001, 0], ['East', 0, 0.0001], ['West', 0, -0.0001]] as const).map(([label, lat, lng]) => <button type="button" key={label} onClick={() => choose({ lat: point.lat + lat, lng: point.lng + lng })}>{label}</button>)}</div>
      <small>Selected point: {point.lat.toFixed(6)}, {point.lng.toFixed(6)} · Subject to service-area review.</small>
      <label className="location-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => { setConfirmed(event.currentTarget.checked); onChange(event.currentTarget.checked ? { lat: point.lat, lng: point.lng, locationAccuracy: "entrance" } : (allowPinArea && point.locationAccuracy === "pincode" ? point : null)); }} />I confirm this pin marks my pickup entrance, not just the PIN-code area.</label></>}
    <small>Search data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>.</small>
  </section>;
}
