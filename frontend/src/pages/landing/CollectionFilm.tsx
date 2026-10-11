import { useReveal } from "./motion";

const media = `${import.meta.env.BASE_URL}media/`;

const steps = [
  {
    n: "01",
    stage: "Ready",
    title: "Confirm what is ready",
    body: "The kitchen gives an estimated quantity and a pickup window that works for them — before any truck leaves.",
  },
  {
    n: "02",
    stage: "Collected",
    title: "Collect with a plan",
    body: "A dispatcher freezes a feasible route; the driver records full, partial or missed pickups at each stop.",
  },
  {
    n: "03",
    stage: "Reconcile",
    title: "Close the collection record",
    body: "The plant logs net gate intake and compares it with the recorded pickups — differences stay visible for review.",
  },
];

export function CollectionFilm() {
  const headRef = useReveal<HTMLDivElement>();
  const theaterRef = useReveal<HTMLDivElement>({ threshold: 0.25 });
  const storyRef = useReveal<HTMLOListElement>();

  return (
    <section className="fs-section fs-film" id="collection-film" aria-labelledby="fs-film-title">
      <div className="fs-section__head fs-reveal" ref={headRef}>
        <p className="fs-eyebrow">
          <span className="fs-eyebrow__dot" aria-hidden="true" />
          From kitchen to plant · The film
        </p>
        <h2 id="fs-film-title" className="fs-display fs-display--lg">
          One collection. A clear record at every step.
        </h2>
        <p className="fs-section__lede">
          Eighteen seconds, no audio — watch readiness, routed collection and plant intake fall into
          one accountable record.
        </p>
      </div>

      <div className="fs-film__grid">
        <div className="fs-film__main fs-reveal" ref={theaterRef}>
          <figure className="fs-film__theater">
            <div className="fs-film__chrome" aria-hidden="true">
              <span className="fs-film__live">
                <span className="fs-film__livedot" />
                Collection film
              </span>
              <span className="fs-mono fs-film__dur">18s · illustrative</span>
            </div>
            <div className="fs-film__screen">
              <video
                className="fs-film__video"
                controls
                playsInline
                preload="none"
                poster={`${media}collection.webp`}
                width={1280}
                height={720}
                aria-label="Kitchen to plant: illustrated collection workflow"
                aria-describedby="fs-film-desc"
              >
                <source src={`${media}collection-workflow.mp4`} type="video/mp4" />
                <track
                  kind="captions"
                  src={`${media}collection-workflow.en.vtt`}
                  srcLang="en"
                  label="English"
                  default
                />
                Your browser cannot play this video. Read the workflow transcript below.
              </video>
            </div>
          </figure>
          <p id="fs-film-desc" className="fs-film__meta">
            18-second illustrated explainer · No audio · AI-generated scenes, not pilot footage.
          </p>
          <details className="fs-film__transcript">
            <summary>Read the video transcript</summary>
            <p>
              A kitchen worker separates vegetable scraps. The kitchen confirms readiness, estimated
              kilograms and a pickup window.
            </p>
            <p>
              A collection worker moves a closed bin toward a parked truck. The dispatcher reviews a
              feasible route and dispatches it. The driver records full, partial or missed pickups while
              parked.
            </p>
            <p>
              A collection truck stands on a plant weighbridge. The plant records net intake and compares
              it with recorded pickups. Kitchens can view their linked collection records. These records
              do not prove downstream processing.
            </p>
          </details>
        </div>

        <ol className="fs-film__story fs-reveal fs-stagger" ref={storyRef}>
          {steps.map((step) => (
            <li key={step.n} className="fs-film__step">
              <div className="fs-film__stephead">
                <span className="fs-mono fs-film__num">{step.n}</span>
                <span className="fs-film__stage">{step.stage}</span>
              </div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
