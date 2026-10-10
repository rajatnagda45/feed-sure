import { describe, expect, it } from "vitest";

import { ROUTES } from "./routes";

describe("application routes", () => {
  it("exposes the three M0 routes", () => {
    expect(Object.values(ROUTES)).toEqual(["/", "/g/:id", "/plant"]);
  });
});
