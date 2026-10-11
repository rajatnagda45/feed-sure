import "./workflow-media.css";

const media = `${import.meta.env.BASE_URL}media/`;

export function KitchenHeroMedia() {
  return (
    <figure className="kitchen-hero-media">
      <img src={`${media}kitchen-ready.webp`} width="1280" height="720"
        alt="Illustration of a kitchen worker separating vegetable preparation scraps into a green collection bin." />
      <figcaption>
        <span>Good collection starts in the kitchen.</span>
        <small>AI-generated illustration</small>
      </figcaption>
      <a className="media-watch-link" href="#collection-film"><span aria-hidden="true">▶</span> Watch the collection journey <span>18 sec</span></a>
    </figure>
  );
}

export function WorkflowMedia() {
  return (
    <section className="workflow-media" id="collection-film" aria-labelledby="collection-film-title">
      <div className="workflow-media-heading">
        <div><p className="context-line">From kitchen to plant</p><h2 id="collection-film-title">One collection. A clear record at every step.</h2></div>
        <p>See how readiness, pickups and plant intake fit together.</p>
      </div>
      <div className="workflow-media-layout">
        <figure className="workflow-film">
          <video controls playsInline preload="none" poster={`${media}collection.webp`}
            width="1280" height="720" aria-label="Kitchen to plant: illustrated collection workflow"
            aria-describedby="film-description">
            <source src={`${media}collection-workflow.mp4`} type="video/mp4" />
            <track kind="captions" src={`${media}collection-workflow.en.vtt`} srcLang="en" label="English" default />
            Your browser cannot play this video. Read the workflow transcript below.
          </video>
          <figcaption id="film-description">18-second illustrated explainer · No audio · AI-generated scenes</figcaption>
          <details className="film-transcript"><summary>Read the video transcript</summary>
            <p>A kitchen worker separates vegetable scraps. The kitchen confirms readiness, estimated kilograms and a pickup window.</p>
            <p>A collection worker moves a closed bin toward a parked truck. The dispatcher reviews a feasible route and dispatches it. The driver records full, partial or missed pickups while parked.</p>
            <p>A collection truck stands on a plant weighbridge. The plant records net intake and compares it with recorded pickups. Kitchens can view their linked collection records. These records do not prove downstream processing.</p>
          </details>
        </figure>
        <ol className="workflow-story">
          <li><span>01</span><div><h3>Confirm what is ready</h3><p>Give the collector an estimated quantity and a window that works for your kitchen.</p></div></li>
          <li><span>02</span><div><h3>Collect with a plan</h3><p>Review the route, dispatch the trip and record what was actually picked up.</p></div></li>
          <li><span>03</span><div><h3>Close the collection record</h3><p>Compare recorded pickup with net gate intake. Keep differences visible for review.</p></div></li>
        </ol>
      </div>
    </section>
  );
}
