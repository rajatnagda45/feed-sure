import { Lang } from "../api";
import { wasteCopy } from "../wasteCopy";

export function WasteGuide({ language }: { language: Lang }) {
  const copy = wasteCopy(language);
  return <aside className="waste-guide" aria-labelledby="waste-guide-title">
    <h2 id="waste-guide-title">{copy.guide}</h2>
    <figure>
      <img src="/images/food-scraps.jpg" width="800" height="600" alt={copy.guideAlt} />
      <figcaption>{copy.example}</figcaption>
    </figure>
    <h3>{copy.guideIntro}</h3>
    <p>{copy.acceptedHint}</p>
    <details className="waste-guide-disclosure">
      <summary>{copy.guideToggle}</summary>
      <figure>
        <img src="/images/keep-plastics-separate.jpg" width="600" height="900" loading="lazy" alt={copy.separateAlt} />
        <figcaption>{copy.example}</figcaption>
      </figure>
      <h3>{copy.separate}</h3><p>{copy.separateHint}</p>
      <p className="waste-hazard-note">{copy.hazard}</p>
    </details>
    <details className="waste-guide-disclosure">
      <summary>{copy.photoGuide}</summary>
      <ol><li>{copy.photoTip1}</li><li>{copy.photoTip2}</li><li>{copy.photoTip3}</li></ol>
    </details>
    <p className="waste-credits">{copy.credits}: <a href="https://www.pexels.com/photo/pile-of-organic-waste-14824327/" target="_blank" rel="noreferrer">Denise Nys</a>, <a href="https://www.pexels.com/photo/photograph-of-plastic-bottles-on-a-white-surface-8286620/" target="_blank" rel="noreferrer">Ron Lach / Pexels</a></p>
  </aside>;
}
