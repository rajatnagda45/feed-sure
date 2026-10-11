import { useEffect, useState } from "react";
import { accountRequest } from "../accounts";
type Driver = { id: string; organisation: string; revision: number; planKey: string | null };
export function DriverAssignment({ planKey }: { planKey: string }) {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selected, setSelected] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true; setBusy(true); setError("");
    accountRequest<{ drivers: Driver[] }>("/auth/drivers").then((result) => { if (live) setDrivers(result.drivers); })
      .catch((issue) => { if (live) setError(issue.message); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [revision, planKey]);
  async function assign() {
    const driver = drivers.find((item) => item.id === selected);
    if (!driver || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await accountRequest(`/auth/drivers/${encodeURIComponent(driver.id)}`, { planKey, expectedRevision: driver.revision });
      setNotice("Driver assigned. They can sign in and choose My dashboard. This replaces any previous driver assigned to this trip.");
      setRevision((value) => value + 1);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Could not assign driver. Refresh and retry."); }
    finally { setBusy(false); }
  }
  const assigned = drivers.find((driver) => driver.planKey === planKey);
  return <aside className="driver-handoff"><h3>Assign the driver</h3>
    <p>{assigned ? `Assigned to ${assigned.organisation}.` : "No driver account is assigned to this trip."} An Admin can create and approve driver accounts in Manage accounts.</p>
    <label className="field">Driver account<select value={selected} disabled={busy} onChange={(event) => setSelected(event.currentTarget.value)}><option value="">Choose an active driver</option>
      {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.organisation}{driver.planKey && driver.planKey !== planKey ? " · assigned to another trip" : ""}</option>)}</select></label>
    <p>Assigning a driver replaces that driver's previous trip access.</p>
    <button className="button button-primary" disabled={busy || !selected} onClick={() => void assign()}>Assign driver</button>
    <button className="text-button" disabled={busy} onClick={() => setRevision((value) => value + 1)}>Refresh drivers</button>
    {assigned && <p>Driver sign-in: <a href="/login">{window.location.origin}/login</a></p>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </aside>;
}
