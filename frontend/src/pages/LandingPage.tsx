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
          <p className="context-line">Kitchen waste to CBG plant</p>
          <h1 id="hero-title">Know what is ready before the truck leaves.</h1>
          <p className="hero-summary">
            Kitchens confirm tomorrow&apos;s supply, dispatchers build a feasible route, and the
            driver records what was actually collected. Plant intake closes the loop.
          </p>
          <nav className="hero-actions" aria-label="FeedSure destinations">
            <Link className="button button-primary" to="/plant">Open operations desk</Link>
            <a className="button button-secondary" href="#demo-guide">Explore the demo</a>
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

      <section className="demo-guide" id="demo-guide" aria-labelledby="demo-guide-title">
        <div className="section-heading"><div><p className="context-line">Three roles, one trip</p><h2 id="demo-guide-title">Follow a collection from readiness to intake</h2></div></div>
        <div className="demo-roles">
          <article><h3>Kitchen supervisor</h3><p>Open the kitchen&apos;s private link from the demo operator. Choose the collection date, ready state, quantity and pickup window. Your collection record stays with your kitchen.</p><span className="access-note">Requires a kitchen-specific link</span></article>
          <article><h3>Dispatcher</h3><p>Open the operations desk with the runtime admin token. Review cancellations, unconfirmed kitchens and capacity conflicts. Build and review a draft before freezing the trip.</p><Link className="text-button" to="/plant">Open dispatcher access</Link></article>
          <article><h3>Driver and plant</h3><p>After dispatch, copy the private driver link from the handoff panel. Save stop outcomes while parked, then record net received weight at the desk to reconcile the trip.</p><span className="access-note">Driver link is issued after dispatch</span></article>
        </div>
        <details className="demo-scenario"><summary>What to try in a local demo</summary><ol><li>Build a route and inspect the omitted kitchens. The target may remain unmet.</li><li>Record a phone confirmation or change a window, then re-plan. Review the new input revision.</li><li>Dispatch once, record collected, partial or skipped outcomes, and compare recorded pickup with net plant intake.</li></ol><p>Ask the demo operator for private access. Synthetic suppliers, local database and fallback travel estimates are identified in the operations desk. Public map tiles do not demonstrate AWS operation.</p></details>
      </section>

      <footer className="site-footer">
        Demo environments are labelled when generator data is simulated. Pickup and gate records
        describe collection and intake, not downstream processing.
      </footer>
    </main>
  );
}
