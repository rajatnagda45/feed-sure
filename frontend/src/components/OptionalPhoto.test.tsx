import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { OptionalPhoto } from "./OptionalPhoto";

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
