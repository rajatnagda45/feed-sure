import { Link } from "react-router-dom";

export function LandingPage() {
  return (
    <main className="landing-shell">
      <header className="site-header">
        <Link className="brand" to="/" aria-label="FeedSure CBG home">
          <span className="brand-mark" aria-hidden="true">F</span>
          <span>FeedSure CBG</span>
        </Link>
        <span className="data-tag">Simulated data</span>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="context-line">One dependable wet-waste collection route</p>
          <h1 id="hero-title">Know what is usable before the truck leaves.</h1>
          <p className="hero-summary">
            Kitchens check visible contamination with two photos. The plant plans tomorrow’s route
            on expected usable kilograms—not optimistic pickup weight.
          </p>
          <nav className="hero-actions" aria-label="Demo destinations">
            <Link className="button button-primary" to="/g/hostel-3?t=demo">
              Open generator check
            </Link>
            <Link className="button button-secondary" to="/plant">
              Open plant plan
            </Link>
          </nav>
        </div>

        <div className="process-band" aria-label="FeedSure product loop">
          <div><strong>Two photos</strong><span>Visible waste check</span></div>
          <div><strong>Usable kg</strong><span>Quality-adjusted forecast</span></div>
          <div><strong>One route</strong><span>Target and shortfall</span></div>
        </div>
      </section>

      <footer className="site-footer">
        Generator volumes are simulated. Screening is visual triage, not a chemistry measurement.
      </footer>
    </main>
  );
}
