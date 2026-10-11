import { Link } from "react-router-dom";

import { useReveal } from "./motion";

export function FinalCTA() {
  const ref = useReveal<HTMLElement>();
  return (
    <section className="fs-section fs-final fs-reveal" ref={ref} aria-labelledby="fs-final-title">
      <div className="fs-final__inner">
        <h2 id="fs-final-title" className="fs-display fs-display--xl">
          Make every collection count.
        </h2>
        <p className="fs-final__lede">
          Bring readiness, routing, collection and plant intake into one accountable workflow.
        </p>
        <div className="fs-final__actions">
          <Link className="fs-btn fs-btn--lime" to="/admin">
            Open operations desk
          </Link>
          <a className="fs-btn fs-btn--outline" href="#workflow">
            Explore the collection workflow
          </a>
        </div>
      </div>

      <footer className="fs-footer">
        <span className="fs-wordmark fs-wordmark--light">
          <span className="fs-wordmark__mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" role="img" aria-label="">
              <path d="M12 3C7 5 5 9 6 14c3 0 6-1 8-4-1 4-4 6-7 7l1 2c6-1 9-5 9-11 0-2-2-4-5-5Z" fill="currentColor" />
            </svg>
          </span>
          FeedSure <em>CBG</em>
        </span>
        <p>
          Demo environments are labelled when supplier data is simulated. Pickup and gate records describe
          collection and intake, not downstream processing.
        </p>
      </footer>
    </section>
  );
}
