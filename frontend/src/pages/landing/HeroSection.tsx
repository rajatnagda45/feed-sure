import type { CSSProperties } from "react";
import { Link } from "react-router-dom";

import { useCountUp, useReveal } from "./motion";

const varStyle = (i: number) => ({ "--i": i }) as CSSProperties;

export function HeroSection() {
  const copyRef = useReveal<HTMLDivElement>({ threshold: 0 });
  const visualRef = useReveal<HTMLDivElement>({ threshold: 0.25 });
  const { ref: kgRef, display: kg } = useCountUp(180);

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

      <div className="fs-hero__visual fs-reveal" ref={visualRef} aria-hidden="true">
        <div className="fs-journey">
          <div className="fs-journey__head">
            <span className="fs-mono fs-journey__id">TRIP-0412</span>
            <span className="fs-tag">Illustrative demo</span>
          </div>

          <svg className="fs-route" viewBox="0 0 320 220" role="presentation" focusable="false">
            <defs>
              <marker id="fs-arrow" markerWidth="7" markerHeight="7" refX="4" refY="3.5" orient="auto">
                <path d="M0 0L7 3.5L0 7Z" fill="var(--fs-forest)" />
              </marker>
            </defs>

            {/* Grid backdrop */}
            <g className="fs-route__grid">
              {[44, 88, 132, 176].map((y) => (
                <line key={`h${y}`} x1="0" y1={y} x2="320" y2={y} />
              ))}
              {[64, 128, 192, 256].map((x) => (
                <line key={`v${x}`} x1={x} y1="0" x2={x} y2="220" />
              ))}
            </g>

            {/* Animated collection path: supplier → route → plant */}
            <path
              className="fs-route__path"
              d="M44 46 C 110 46, 120 120, 180 128 S 250 180, 286 176"
              fill="none"
              markerEnd="url(#fs-arrow)"
            />

            {/* Waypoint markers appear sequentially */}
            <g className="fs-route__way" style={varStyle(0)}>
              <circle cx="112" cy="70" r="3.5" />
            </g>
            <g className="fs-route__way" style={varStyle(1)}>
              <circle cx="180" cy="128" r="3.5" />
            </g>
            <g className="fs-route__way" style={varStyle(2)}>
              <circle cx="238" cy="162" r="3.5" />
            </g>

            {/* Origin: supplier / kitchen */}
            <g className="fs-node fs-node--supplier">
              <rect x="20" y="28" width="36" height="36" rx="9" />
              <path
                className="fs-node__glyph"
                d="M30 50v-8a8 8 0 0 1 16 0v8M34 50h8"
                fill="none"
                strokeWidth="2.2"
              />
            </g>

            {/* Destination: CBG plant */}
            <g className="fs-node fs-node--plant">
              <rect x="266" y="158" width="38" height="38" rx="9" />
              <path
                className="fs-node__glyph"
                d="M276 186v-14l6 4v-6l6 4v-6l6 4v14Z"
                fill="none"
                strokeWidth="2"
              />
            </g>

            {/* Vehicle travelling the route */}
            <g className="fs-vehicle">
              <rect x="-9" y="-6" width="18" height="12" rx="3" />
              <circle cx="-4" cy="7" r="2.1" className="fs-vehicle__wheel" />
              <circle cx="4" cy="7" r="2.1" className="fs-vehicle__wheel" />
            </g>
          </svg>

          <ol className="fs-journey__steps">
            <li className="fs-journey__step" style={varStyle(0)}>
              <span className="fs-dot" aria-hidden="true" />
              Ready
            </li>
            <li className="fs-journey__step" style={varStyle(1)}>
              <span className="fs-dot" aria-hidden="true" />
              Collected
            </li>
            <li className="fs-journey__step" style={varStyle(2)}>
              <span className="fs-dot" aria-hidden="true" />
              Intake recorded
            </li>
          </ol>

          <div className="fs-journey__readout">
            <div>
              <span className="fs-mono fs-journey__kg">
                <span ref={kgRef}>{kg}</span> kg
              </span>
              <span className="fs-journey__kglabel">Expected across 4 stops</span>
            </div>
            <span className="fs-tag fs-tag--muted">Illustrative demo data</span>
          </div>
        </div>
      </div>
    </section>
  );
}
