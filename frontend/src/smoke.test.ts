import { describe, expect, it } from "vitest";

import { ROUTES } from "./routes";

describe("application routes", () => {
  it("exposes kitchen, admin, owner and driver workflows with the legacy dispatch URL", () => {
    expect(Object.values(ROUTES)).toEqual(["/", "/g/:id", "/plant", "/admin", "/owner", "/driver/:planKey"]);
  });
});
