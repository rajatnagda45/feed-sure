import type { ReactNode } from "react";

/**
 * Premium split-screen chrome for the login / register pages, matching the
 * landing page's editorial eco-tech identity: a forest-green brand panel beside
 * the form. Purely presentational — the form logic lives in the page.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="fs fs-auth">
      <aside className="fs-auth__brand" aria-hidden="true">
        <svg className="fs-auth__lines" viewBox="0 0 400 600" preserveAspectRatio="xMidYMid slice" focusable="false">
          <path d="M-20 120 C 120 90 160 260 320 230 S 460 360 420 520" fill="none" />
          <path d="M-40 300 C 100 280 180 420 340 400 S 520 500 460 640" fill="none" />
        </svg>
        <div className="fs-auth__brandinner">
          <span className="fs-wordmark fs-wordmark--light">
            <span className="fs-wordmark__mark">
              <svg viewBox="0 0 24 24" width="16" height="16" role="img" aria-label="">
                <path d="M12 3C7 5 5 9 6 14c3 0 6-1 8-4-1 4-4 6-7 7l1 2c6-1 9-5 9-11 0-2-2-4-5-5Z" fill="currentColor" />
              </svg>
            </span>
            FeedSure <em>CBG</em>
          </span>
          <p className="fs-eyebrow">Circular food systems · CBG operations</p>
          <h2 className="fs-display">From food waste to fuel.</h2>
          <p className="fs-auth__tag">
            Bring readiness, routing, collection and plant intake into one accountable workflow — every
            pickup measured from the kitchen to the gate.
          </p>
          <ul className="fs-auth__steps">
            <li>Ready</li>
            <li>Collected</li>
            <li>Reconcile</li>
          </ul>
          <p className="fs-auth__pilot">
            <span className="fs-pulse" aria-hidden="true" />
            Operational pilot
          </p>
        </div>
      </aside>
      <div className="fs-auth__panel">{children}</div>
    </main>
  );
}
