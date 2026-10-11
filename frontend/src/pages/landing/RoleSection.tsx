import { Link } from "react-router-dom";

import { roles } from "./data";
import { useReveal } from "./motion";

export function RoleSection() {
  const headRef = useReveal<HTMLDivElement>();
  const gridRef = useReveal<HTMLDivElement>();
  return (
    <section className="fs-section fs-roles" id="demo-guide" aria-labelledby="fs-roles-title">
      <div className="fs-section__head fs-reveal" ref={headRef}>
        <p className="fs-eyebrow">Designed for four roles</p>
        <h2 id="fs-roles-title" className="fs-display fs-display--lg">
          Follow a collection from readiness to intake.
        </h2>
        <p className="fs-section__lede">
          Separate interfaces share the same collection records. Each role opens through its own existing
          access flow — no role silently bypasses authentication.
        </p>
      </div>

      <div className="fs-roles__grid fs-reveal fs-stagger" ref={gridRef}>
        {roles.map((role) => (
          <article key={role.name} className={`fs-role fs-role--${role.accent}`}>
            <span className="fs-mono fs-role__num">{role.n}</span>
            <h3>{role.name}</h3>
            <p>{role.body}</p>
            <span className="fs-role__note">{role.note}</span>
            <Link className="fs-role__cta" to={role.cta.to}>
              {role.cta.label}
              <span aria-hidden="true">→</span>
            </Link>
          </article>
        ))}
      </div>

      <details className="fs-roles__disclaimer">
        <summary>What to try in a local demo</summary>
        <ol>
          <li>Build a route and inspect the omitted waste suppliers. The target may remain unmet.</li>
          <li>Record a confirmation or change a window, then re-plan and review the new input revision.</li>
          <li>Dispatch once, record full, partial or skipped outcomes, then compare the recorded pickup with net plant intake.</li>
        </ol>
        <p>
          Ask the demo operator for private access. Synthetic suppliers, a local database and fallback travel
          estimates are identified in the operations desk. Public map tiles do not demonstrate AWS operation.
        </p>
      </details>
    </section>
  );
}
