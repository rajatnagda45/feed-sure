import { describe, expect, it } from "vitest";

import { ROUTES } from "./routes";

describe("application routes", () => {
  it("exposes kitchen, dispatcher, and private driver workflows", () => {
    expect(Object.values(ROUTES)).toEqual(["/", "/g/:id", "/plant", "/driver/:planKey"]);
  });
});
