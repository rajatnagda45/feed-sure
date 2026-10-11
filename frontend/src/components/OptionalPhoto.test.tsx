import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { OptionalPhoto } from "./OptionalPhoto";
import type { PhotoRecord } from "../photoApi";

it("makes browser capture primary and existing-image upload a secondary disclosure", () => {
  const html = renderToStaticMarkup(<OptionalPhoto generatorId="hotel-a" token="private-test-token"
    language="en" submission={null} onSaved={() => {}} />);
  expect(html).toContain('class="button button-primary">Take photo');
  expect(html).toContain('<details class="photo-upload-fallback">');
  expect(html).toContain("Upload an existing photo instead");
  expect(html).toContain("current GPS is not added to older photos");
  expect(html).toContain("Location denial does not block capture");
  expect(html).not.toContain('capture="environment"');
  expect(html).not.toContain("private-test-token");
});

it("flags unrelated images without claiming readiness failed", () => {
  const submission = { photoKeys: ["private/photo.jpg"], photoStatus: "ADVICE", analysis: {
    state: "COMPLETE", mode: "nvidia", observations: { items: [], image_quality: "not_waste", notes: "A poster." },
  } } as unknown as PhotoRecord;
  const html = renderToStaticMarkup(<OptionalPhoto generatorId="hotel-a" token="test-only"
    language="en" submission={submission} onSaved={() => {}} />);
  expect(html).toContain("does not show waste");
  expect(html).toContain("Your readiness is still saved");
});

it("shows NVIDIA observations with the correct provider label and visible items", () => {
  const submission = { generatorId: "hotel-a", collectionDate: "2026-10-12", photoKeys: ["private/photo.jpg"],
    photoStatus: "ADVICE", photoRevision: 1, analysis: { state: "COMPLETE", mode: "nvidia",
      observations: { items: [{ type: "plastic_wrapper", count: 2, confidence: 0.9 }],
        hazard: false, image_quality: "ok", confidence: 0.9, notes: "Two visible wrappers." },
      limit: "Visible surface only." } } as PhotoRecord;
  const html = renderToStaticMarkup(<OptionalPhoto generatorId="hotel-a" token="private-test-token"
    language="en" submission={submission} onSaved={() => {}} />);
  expect(html).toContain("NVIDIA visible-item assistance");
  expect(html).toContain("Two visible wrappers.");
  expect(html).toContain("plastic wrapper · 2 visible");
  expect(html).not.toContain("Amazon Bedrock");
  expect(html).not.toContain("private-test-token");
});
