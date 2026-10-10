import { ObservationItem, SubmissionResponse, Verdict } from "../api";

interface VerdictScreenProps {
  result: SubmissionResponse;
  onDone: () => void;
  onPhotographAgain: () => void;
}

const verdictCopy: Record<Verdict, { icon: string; label: string }> = {
  ACCEPT: { icon: "✓", label: "Accept" },
  INSPECT: { icon: "!", label: "Inspect" },
  HOLD: { icon: "×", label: "Hold" },
};

const itemLabels: Record<string, [string, string]> = {
  plastic_bag: ["plastic bag", "plastic bags"],
  plastic_wrapper: ["plastic wrapper", "plastic wrappers"],
  plastic_container: ["plastic container", "plastic containers"],
  foil: ["piece of foil", "pieces of foil"],
  cutlery_disposable: ["disposable utensil", "disposable utensils"],
  cutlery_metal: ["metal utensil", "metal utensils"],
  glass: ["piece of glass", "pieces of glass"],
  sharp_metal: ["sharp metal item", "sharp metal items"],
  metal_can: ["metal can", "metal cans"],
  paper_cup: ["paper cup", "paper cups"],
  tissue_or_napkin_pack: ["tissue or napkin pack", "tissue or napkin packs"],
  cardboard: ["piece of cardboard", "pieces of cardboard"],
  rubber_or_glove: ["rubber item or glove", "rubber items or gloves"],
  battery: ["battery", "batteries"],
  syringe_or_medical_waste: ["medical-waste item", "medical-waste items"],
  other_non_food: ["non-food item", "non-food items"],
};

export function formatObservedItem(item: ObservationItem): string {
  const labels = itemLabels[item.type] ?? itemLabels.other_non_food;
  return `${item.count} ${item.count === 1 ? labels[0] : labels[1]}`;
}

export function VerdictScreen({ result, onDone, onPhotographAgain }: VerdictScreenProps) {
  const copy = verdictCopy[result.verdict];
  const isAccepted = result.verdict === "ACCEPT";

  return (
    <section
      className={`verdict-screen verdict-${result.verdict.toLowerCase()}`}
      aria-live="polite"
      aria-labelledby="verdict-title"
    >
      <div className="verdict-body">
        <span className="verdict-icon" aria-hidden="true">{copy.icon}</span>
        <p className="verdict-context">Waste check complete</p>
        <h1 id="verdict-title">{copy.label}</h1>
        <p className="verdict-instruction">{result.instruction}</p>
        {result.observations.items.length > 0 && (
          <div className="verdict-evidence">
            <p>Visible in the photos</p>
            <ul>
              {result.observations.items.map((item, index) => (
                <li key={`${item.type}-${index}`}>{formatObservedItem(item)}</li>
              ))}
            </ul>
          </div>
        )}
        {isAccepted && <p className="pickup-note">Ready for pickup tomorrow.</p>}
      </div>
      <button
        className="button verdict-action"
        type="button"
        onClick={isAccepted ? onDone : onPhotographAgain}
      >
        {isAccepted ? "Done" : "Photograph again"}
      </button>
    </section>
  );
}
