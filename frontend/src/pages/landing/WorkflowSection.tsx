import type { CSSProperties, ReactNode } from "react";

import { planStops, workflow } from "./data";
import { useReveal } from "./motion";

function ReadyMock() {
  const s = workflow[0].sample!;
  return (
    <dl className="fs-mock fs-mock--record">
      <div>
        <dt>Supplier</dt>
        <dd>{s.supplier}</dd>
      </div>
      <div>
        <dt>Waste category</dt>
        <dd>{s.category}</dd>
      </div>
      <div>
        <dt>Estimated quantity</dt>
        <dd className="fs-mono">{s.quantity}</dd>
      </div>
      <div>
        <dt>Pickup window</dt>
        <dd className="fs-mono">{s.window}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>
          <span className="fs-chip fs-chip--ok">{s.status}</span>
        </dd>
      </div>
    </dl>
  );
}

function PlanMock() {
  return (
    <div className="fs-mock fs-mock--plan">
      <div className="fs-mock__planhead">
        <span className="fs-mono">ROUTE · 4 stops</span>
        <span className="fs-chip fs-chip--ok">Feasible</span>
      </div>
      <ol className="fs-planroute">
        {planStops.map((stop) => (
          <li key={stop.n}>
            <span className="fs-planroute__n fs-mono">{stop.n}</span>
            <span className="fs-planroute__name">{stop.name}</span>
            <span className="fs-mono fs-planroute__load">{stop.load}</span>
            <span className="fs-mono fs-planroute__win">{stop.window}</span>
          </li>
        ))}
      </ol>
      <div className="fs-mock__summary">
        <span>
          Reserved load <b className="fs-mono">430 / 500 kg</b>
        </span>
        <span>
          Return by <b className="fs-mono">09:30</b>
        </span>
      </div>
    </div>
  );
}

function CollectMock() {
  const outcomes = workflow[2].outcomes!;
  return (
    <div className="fs-mock fs-mock--collect">
      {outcomes.map((o) => (
        <div key={o.label} className="fs-collectrow">
          <span className={`fs-chip fs-chip--${o.tone}`}>{o.label}</span>
          <span className="fs-mono">{o.value}</span>
        </div>
      ))}
      <p className="fs-mock__note">Full, partial and skipped outcomes are recorded per stop with notes.</p>
    </div>
  );
}

function ReconcileMock() {
  return (
    <div className="fs-mock fs-mock--reconcile">
      <div className="fs-reconcilerow fs-reconcilerow--head fs-mono">
        <span>Stop</span>
        <span>Coll.</span>
        <span>Recv.</span>
      </div>
      <div className="fs-reconcilerow">
        <span>Grand Court Hotel</span>
        <span className="fs-mono">150</span>
        <span className="fs-mono fs-delta">141 ▾</span>
      </div>
      <div className="fs-reconcilerow">
        <span>Harbour View Canteen</span>
        <span className="fs-mono">118</span>
        <span className="fs-mono">116</span>
      </div>
      <p className="fs-mock__note">Collected waste and plant-received net weight are distinct quantities.</p>
    </div>
  );
}

const mocks = [<ReadyMock />, <PlanMock />, <CollectMock />, <ReconcileMock />];

export function WorkflowSection() {
  const headRef = useReveal<HTMLDivElement>();
  return (
    <section className="fs-section fs-workflow" id="workflow" aria-labelledby="fs-workflow-title">
      <div className="fs-section__head fs-reveal" ref={headRef}>
        <p className="fs-eyebrow">One connected workflow</p>
        <h2 id="fs-workflow-title" className="fs-display fs-display--lg">
          Four stages, one accountable trip.
        </h2>
        <p className="fs-section__lede">
          Each stage hands off to the next with its own record — so readiness, routing, collection and
          intake stay linked rather than living in separate spreadsheets.
        </p>
      </div>

      <div className="fs-workflow__track" role="list">
        {workflow.map((stage, i) => (
          <WorkflowStage key={stage.key} index={i} stage={stage} mock={mocks[i]} />
        ))}
      </div>
    </section>
  );
}

function WorkflowStage({
  index,
  stage,
  mock,
}: {
  index: number;
  stage: (typeof workflow)[number];
  mock: ReactNode;
}) {
  const ref = useReveal<HTMLDivElement>({ threshold: 0.25 });
  return (
    <article
      className="fs-stage fs-reveal"
      ref={ref}
      role="listitem"
      style={{ "--i": index } as CSSProperties}
    >
      <div className="fs-stage__bar" aria-hidden="true">
        <span className="fs-stage__node fs-mono">{stage.step}</span>
      </div>
      <div className="fs-stage__body">
        <header>
          <h3>{stage.name}</h3>
          <p className="fs-stage__role">{stage.role}</p>
        </header>
        <p className="fs-stage__summary">{stage.summary}</p>
        <div className="fs-stage__mock">{mock}</div>
      </div>
    </article>
  );
}
