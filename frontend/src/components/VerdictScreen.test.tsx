import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SubmissionResponse, Verdict } from "../api";
import { VerdictScreen } from "./VerdictScreen";

function resultFor(verdict: Verdict): SubmissionResponse {
  return {
    submissionId: "hostel-3#2026-10-09T18:42:10Z",
    date: "2026-10-09",
    verdict,
    reason: verdict === "ACCEPT" ? "clean" : verdict === "INSPECT" ? "low_confidence" : "hazard",
    instruction: `${verdict} worker instruction`,
    observations: {
      items: verdict === "ACCEPT"
        ? []
        : [{ type: "plastic_wrapper", count: 3, confidence: 0.91 }],
      visibleContaminantPct: verdict === "HOLD" ? 8 : 0,
      hazard: verdict === "HOLD",
      imageQuality: "ok",
      confidence: verdict === "INSPECT" ? 0.42 : 0.9,
      notes: "Fixture observations.",
    },
    modelId: "mock",
    screenedAt: "2026-10-09T18:42:10Z",
  };
}

describe("verdict screen", () => {
  it.each(["ACCEPT", "INSPECT", "HOLD"] as const)(
    "renders the %s verdict and API instruction",
    (verdict) => {
      const html = renderToStaticMarkup(
        <VerdictScreen
          result={resultFor(verdict)}
          onDone={() => undefined}
          onPhotographAgain={() => undefined}
        />,
      );

      const label = verdict.charAt(0) + verdict.slice(1).toLowerCase();
      expect(html).toContain(`verdict-${verdict.toLowerCase()}`);
      expect(html).toContain(`>${label}</h1>`);
      expect(html).toContain(`${verdict} worker instruction`);
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain(verdict === "ACCEPT" ? ">Done</button>" : ">Photograph again</button>");
    },
  );

  it("renders a short detected-item list", () => {
    const html = renderToStaticMarkup(
      <VerdictScreen
        result={resultFor("HOLD")}
        onDone={() => undefined}
        onPhotographAgain={() => undefined}
      />,
    );

    expect(html).toContain("Visible in the photos");
    expect(html).toContain("3 plastic wrappers");
  });
});
