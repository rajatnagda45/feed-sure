import { Link } from "react-router-dom";

import { useReveal } from "./motion";

export function OperationsPreview() {
  const ref = useReveal<HTMLElement>();
  return (
    <section className="fs-section fs-ops fs-reveal" ref={ref} id="operations" aria-labelledby="fs-ops-title">
      <div className="fs-ops__grid">
        <div className="fs-ops__copy">
          <p className="fs-eyebrow">The operations desk</p>
          <h2 id="fs-ops-title" className="fs-display fs-display--lg">
            Realistic operational density, not a marketing screenshot.
          </h2>
          <p className="fs-section__lede">
            Dispatchers work from supplier readiness, pending confirmations, draft and dispatched routes,
            capacity conflicts, driver outcomes and plant intake discrepancies — on one surface.
          </p>
          <ul className="fs-ops__list">
            <li>Supplier readiness and pending confirmations</li>
            <li>Draft and dispatched routes with capacity checks</li>
            <li>Driver pickup outcomes and gate reconciliation</li>
          </ul>
          <Link className="fs-btn fs-btn--primary" to="/admin">
            Open operations desk
          </Link>
        </div>

        <div className="fs-ops__panel" aria-label="Operations desk preview (illustrative demo data)">
          <div className="fs-panel__chrome">
            <span className="fs-mono">operations · 12 Oct</span>
            <span className="fs-tag fs-tag--muted">Demo data</span>
          </div>
          <div className="fs-panel__metrics">
            {[
              ["Ready", "7"],
              ["Pending", "2"],
              ["Reserved", "430 kg"],
              ["Conflicts", "1"],
            ].map(([label, value]) => (
              <div key={label}>
                <span className="fs-mono fs-panel__metric">{value}</span>
                <span className="fs-panel__metriclabel">{label}</span>
              </div>
            ))}
          </div>
          <table className="fs-panel__table">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Window</th>
                <th>Est.</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Harbour View Canteen</td>
                <td className="fs-mono">06:00</td>
                <td className="fs-mono">120</td>
                <td><span className="fs-chip fs-chip--ok">Ready</span></td>
              </tr>
              <tr>
                <td>Lakeside Hostel Mess</td>
                <td className="fs-mono">06:40</td>
                <td className="fs-mono">90</td>
                <td><span className="fs-chip fs-chip--ok">Ready</span></td>
              </tr>
              <tr>
                <td>Grand Court Hotel</td>
                <td className="fs-mono">07:30</td>
                <td className="fs-mono">150</td>
                <td><span className="fs-chip fs-chip--warn">Over cap</span></td>
              </tr>
              <tr>
                <td>Unity PG Kitchen</td>
                <td className="fs-mono">—</td>
                <td className="fs-mono">70</td>
                <td><span className="fs-chip fs-chip--muted">Unconfirmed</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
