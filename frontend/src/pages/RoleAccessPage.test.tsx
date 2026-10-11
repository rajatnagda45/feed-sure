import { expect, it } from "vitest";
import { privateRolePath } from "./RoleAccessPage";

it("accepts only a complete private link for the selected role on this site", () => {
  const origin = "https://feedsure.example";
  expect(privateRolePath(`${origin}/g/kitchen-1?t=private`, "kitchen", origin)).toBe("/g/kitchen-1?t=private");
  expect(privateRolePath("/driver/2026-10-12%23trip?t=private", "driver", origin)).toBe("/driver/2026-10-12%23trip?t=private");
  for (const link of ["https://other.example/g/kitchen-1?t=private", "/g/kitchen-1", "/g/?t=private", "/driver/trip?t=private", "/g/kitchen/extra?t=private"]) {
    expect(() => privateRolePath(link, "kitchen", origin)).toThrow("Use the complete supplier link");
  }
});
