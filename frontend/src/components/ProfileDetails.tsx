import { FormEvent, useState } from "react";
import { Account, accountRequest } from "../accounts";
import { LocationPicker, LocationPoint } from "./LocationPicker";

export function ProfileDetails({ account, onSaved }: { account: Account; onSaved: (account: Account) => void }) {
  const [fields, setFields] = useState({ organisation: account.organisation, contact: account.contact, address: account.address });
  const [type, setType] = useState(account.profile?.type ?? "hotel");
  const [capacity, setCapacity] = useState(String(account.capacityKg ?? ""));
  const hasLocation = Number.isFinite(account.profile?.lat) && Number.isFinite(account.profile?.lng);
  const [editingLocation, setEditingLocation] = useState(!hasLocation);
  const [point, setPoint] = useState<LocationPoint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kitchen = account.role === "kitchen";
  const addressChanged = fields.address !== account.address;
  const needsConfirmation = kitchen && (editingLocation || addressChanged || !hasLocation) && !point;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (needsConfirmation && account.status === "ACTIVE") {
      setError("Confirm your pickup entrance before saving this location change."); return;
    }
    setBusy(true);
    try {
      const profile = kitchen && (point || (hasLocation && !addressChanged && !editingLocation))
        ? { ...(point ? {lat: point.lat, lng: point.lng, ...(point.locationAccuracy ? {locationAccuracy: point.locationAccuracy} : {}), ...(point.pincode ? {pincode: point.pincode} : {})} : account.profile!), type } : undefined;
      const result = await accountRequest<Account>("/auth/account", {
        action: "update", expectedRevision: account.revision,
        organisation: fields.organisation.trim(), contact: fields.contact.trim(), address: fields.address.trim(),
        ...(profile ? { profile } : {}),
        ...(["cbg", "owner"].includes(account.role) ? { capacityKg: Number(capacity) } : {}),
      });
      onSaved(result);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Could not save. Your entries are still here; retry when connected."); }
    finally { setBusy(false); }
  }
  return <section aria-label="Profile details"><h2>Site and contact details</h2>
    <p>Saving complete profile details activates your access automatically. Changes update future collection plans; dispatched trips and past receipts keep their recorded details.</p>
    <form onSubmit={(event) => void save(event)}><fieldset className="login-fields" disabled={busy}>
      {(Object.keys(fields) as (keyof typeof fields)[]).map((key) => <label className="field" key={key}>
        <span>{key === "organisation" ? "Organisation / site name" : key === "contact" ? "Contact name and phone or email" : kitchen ? "Pickup address" : "Plant / organisation address"}</span>
        <input required maxLength={200} autoComplete={key === "address" ? "street-address" : key === "organisation" ? "organization" : "off"}
          value={fields[key]} onChange={(event) => setFields({ ...fields, [key]: event.currentTarget.value })} />
      </label>)}
      {kitchen && <><h3>Pickup location</h3>
        <p role="status">{hasLocation && !addressChanged && !editingLocation ? (account.profile?.locationAccuracy === "pincode" ? `Approximate PIN-code area (${account.profile.pincode}). Refine the entrance when ready.` : "Pickup entrance confirmed.") : "Find your PIN-code area or confirm an entrance to activate collection access."}</p>
        {(editingLocation || addressChanged) ? <LocationPicker allowPinArea address={fields.address} initialPoint={hasLocation && !addressChanged ? {lat: account.profile!.lat!, lng: account.profile!.lng!} : undefined} onChange={setPoint} />
          : <button className="button button-secondary" type="button" onClick={() => setEditingLocation(true)}>Update pickup location</button>}
        <label className="field"><span>Generator type</span><select value={type} onChange={(event) => setType(event.currentTarget.value)}>
          <option value="hotel">Hotel</option><option value="hostel_mess">Hostel / mess</option><option value="pg">PG</option><option value="restaurant">Restaurant</option><option value="canteen">Canteen</option>
        </select></label>
        {needsConfirmation && account.status === "PENDING" && <p>Find your PIN-code area, then save to activate access. Exact map-pin confirmation is optional.</p>}
      </>}
      {["cbg", "owner"].includes(account.role) && <label className="field"><span>Plant intake capacity (kg/day)</span><input type="number" required min="0.01" max="1000000000" step="any" value={capacity} onChange={(event) => setCapacity(event.currentTarget.value)} /></label>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <button className="button button-primary" type="submit">{busy ? "Saving profile…" : "Save profile"}</button>
    </fieldset></form>
  </section>;
}
