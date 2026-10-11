const STAGES = ["Ready", "Routed", "Collected", "Intake recorded"];

export function StageIndicators({ active }: { active: number }) {
  return (
    <div className="fs-scene__stages" aria-hidden="true">
      <div className="fs-scene__track">
        <span
          className="fs-scene__fill"
          style={{ width: `${(active / (STAGES.length - 1)) * 100}%` }}
        />
      </div>
      <ol>
        {STAGES.map((label, i) => (
          <li key={label} className={i === active ? "is-active" : i < active ? "is-done" : ""}>
            <span className="fs-scene__dot" />
            {label}
          </li>
        ))}
      </ol>
    </div>
  );
}
