import { problems } from "./data";
import { useReveal } from "./motion";

export function ProblemSection() {
  const ref = useReveal<HTMLElement>();
  return (
    <section className="fs-section fs-problem fs-reveal" ref={ref} aria-labelledby="fs-problem-title">
      <div className="fs-section__head">
        <p className="fs-eyebrow">The operational problem</p>
        <h2 id="fs-problem-title" className="fs-display fs-display--lg">
          Waste is only a resource when the handoff works.
        </h2>
      </div>
      <ol className="fs-problem__list fs-stagger">
        {problems.map((p) => (
          <li key={p.id} className="fs-problem__item">
            <span className="fs-mono fs-problem__num">{p.id}</span>
            <div>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
