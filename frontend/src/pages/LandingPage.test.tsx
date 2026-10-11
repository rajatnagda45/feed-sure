import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { LandingPage } from "./LandingPage";

it("provides operations and demo navigation while explaining scoped private access", () => {
  const html = renderToStaticMarkup(<StaticRouter location="/"><LandingPage /></StaticRouter>);
  expect(html).toContain('href="/plant"');
  expect(html).toContain('href="#demo-guide"');
  expect(html).toContain('id="demo-guide"');
  expect(html).toContain("Requires a kitchen-specific link");
  expect(html).toContain("Driver link is issued after dispatch");
  expect(html).not.toMatch(/href="[^"]*[?&]t=/);
  expect(html).toContain("Public map tiles do not demonstrate AWS operation");
});
