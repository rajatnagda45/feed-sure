import { Link } from "react-router-dom";

export function PlantPage() {
  return (
    <main className="plant-shell">
      <header className="plant-header">
        <Link className="brand" to="/">
          <span className="brand-mark" aria-hidden="true">F</span>
          <span>FeedSure · Plant plan</span>
        </Link>
        <span className="data-tag">Simulated data</span>
      </header>

      <section className="plant-toolbar" aria-label="Planning controls placeholder">
        <div><span>Target</span><strong>1,700 kg</strong></div>
        <div><span>Truck</span><strong>2,000 kg</strong></div>
        <button className="button button-primary" type="button" disabled>Re-plan in M4</button>
      </section>

      <section className="dashboard-placeholder" aria-labelledby="dashboard-title">
        <div className="map-placeholder" role="img" aria-label="Map placeholder for the Harohalli pilot">
          <span className="plant-pin">◆</span>
          <span className="route-line" />
          <span className="stop-pin stop-one">1</span>
          <span className="stop-pin stop-two">2</span>
          <p>Route map arrives in M5</p>
        </div>
        <div className="plan-placeholder">
          <p className="context-line">Tomorrow’s intake</p>
          <h1 id="dashboard-title">Planning surface ready</h1>
          <p>
            Expected usable kg, route order, baseline comparison, and shortfall reasons will appear
            here as later milestones are completed.
          </p>
          <p className="coordinate-note">
            Harohalli plant coordinates are approximate — verify before demo.
          </p>
        </div>
      </section>
    </main>
  );
}
