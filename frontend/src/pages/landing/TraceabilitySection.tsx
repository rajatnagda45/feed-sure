import { reconciliation } from "./data";
import { useReveal } from "./motion";

export function TraceabilitySection() {
  const ref = useReveal<HTMLElement>();
  return (
    <section
      className="fs-section fs-trace fs-reveal"
      ref={ref}
      id="reconcile"
      aria-labelledby="fs-trace-title"
    >
      <div className="fs-section__head">
        <p className="fs-eyebrow">Accountability &amp; traceability</p>
        <h2 id="fs-trace-title" className="fs-display fs-display--lg">
          The pickup is not the finish line.
        </h2>
        <p className="fs-section__lede">
          Supplier confirmation, driver collection and plant gate intake form one traceable sequence. A
          recorded pickup never automatically proves plant intake.
        </p>
      </div>

      <div className="fs-ledger" aria-label="Reconciliation ledger (illustrative demo data)">
        <div className="fs-ledger__row fs-ledger__row--head fs-mono">
          <span>Supplier</span>
          <span>Confirmed</span>
          <span>Collected</span>
          <span>Received</span>
          <span>Discrepancy</span>
        </div>
        {reconciliation.map((r) => {
          const diff = r.received - r.collected;
          const tone = r.collected === 0 ? "muted" : diff < 0 ? "warn" : "ok";
          const label =
            r.collected === 0 ? "Skipped" : diff === 0 ? "Matched" : `${diff} kg`;
          return (
            <div key={r.supplier} className="fs-ledger__row">
              <span className="fs-ledger__name">{r.supplier}</span>
              <span className="fs-mono">{r.expected}</span>
              <span className="fs-mono">{r.collected}</span>
              <span className="fs-mono">{r.received}</span>
              <span>
                <span className={`fs-chip fs-chip--${tone}`}>{label}</span>
              </span>
            </div>
          );
        })}
        <p className="fs-ledger__note fs-tag fs-tag--muted">Illustrative demo data · kg</p>
      </div>
    </section>
  );
}
