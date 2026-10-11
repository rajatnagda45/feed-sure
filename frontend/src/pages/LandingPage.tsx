import { Link } from "react-router-dom";

export function LandingPage() {
  return (
    <main className="landing-shell">
      <header className="site-header">
        <Link className="brand" to="/" aria-label="FeedSure CBG home">
          <span className="brand-mark" aria-hidden="true">F</span>
          <span>FeedSure CBG</span>
        </Link>
        <span className="data-tag">Operational pilot</span>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="context-line">One accountable collection loop</p>
          <h1 id="hero-title">Know what is ready before the truck leaves.</h1>
          <p className="hero-summary">
            Kitchens confirm tomorrow&apos;s supply, dispatchers build a feasible route, and the
            driver records what was actually collected. Plant intake closes the loop.
          </p>
          <nav className="hero-actions" aria-label="FeedSure destinations">
            <Link className="button button-primary" to="/plant">Open operations desk</Link>
          </nav>
          <p className="private-link-note">
            Kitchen and driver screens open only from private, scoped links issued by operations.
          </p>
        </div>

        <div className="process-band" aria-label="FeedSure product loop">
          <div><strong>Ready</strong><span>Kitchen confirms quantity and window</span></div>
          <div><strong>Collect</strong><span>Driver records full or partial pickup</span></div>
          <div><strong>Reconcile</strong><span>Plant compares pickup with gate intake</span></div>
        </div>
      </section>

      <footer className="site-footer">
        Demo environments are labelled when generator data is simulated. Pickup and gate records
        describe collection and intake, not downstream processing.
      </footer>
    </main>
  );
}
