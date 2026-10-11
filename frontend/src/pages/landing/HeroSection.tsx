import { Link } from "react-router-dom";

import { CollectionJourneyScene } from "./CollectionJourneyScene";
import { useReveal } from "./motion";

export function HeroSection() {
  const copyRef = useReveal<HTMLDivElement>({ threshold: 0 });

  return (
    <section className="fs-hero" aria-labelledby="fs-hero-title">
      <div className="fs-hero__copy fs-reveal" ref={copyRef}>
        <p className="fs-eyebrow">
          <span className="fs-eyebrow__dot" aria-hidden="true" />
          Circular food systems · CBG operations
        </p>
        <h1 id="fs-hero-title" className="fs-display">
          <span className="fs-hero__line">From food waste</span>{" "}
          <span className="fs-hero__line">to fuel.</span>{" "}
          <span className="fs-hero__line fs-hero__line--accent">Every pickup accounted for.</span>
        </h1>
        <p className="fs-hero__lede">
          FeedSure connects bulk food-waste suppliers, dispatchers, drivers and CBG plants in one
          operational workflow — from collection readiness to verified plant intake.
        </p>
        <div className="fs-hero__actions">
          <a className="fs-btn fs-btn--primary" href="#workflow">
            Explore the workflow
          </a>
          <Link className="fs-btn fs-btn--ghost" to="/admin">
            Open operations desk
          </Link>
        </div>
        <p className="fs-hero__status">
          <span className="fs-pulse" aria-hidden="true" />
          Collection network · Operational pilot
        </p>
      </div>

      <div className="fs-hero__visual">
        <CollectionJourneyScene />
      </div>
    </section>
  );
}
