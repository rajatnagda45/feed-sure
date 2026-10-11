import { describe, expect, it } from "vitest";
import { accountPath } from "./auth";

describe("verified account destinations", () => {
  it("routes each role to its assigned workflow", () => {
    expect(accountPath({ id: "u", role: "ADMIN" })).toBe("/admin");
    expect(accountPath({ id: "u", role: "PLANT_OWNER" })).toBe("/owner");
    expect(accountPath({ id: "u", role: "GENERATOR", generatorId: "hotel-a" })).toBe("/g/hotel-a");
    expect(accountPath({ id: "u", role: "DRIVER", planKey: "2026-10-12#p-trip" })).toBe("/driver/2026-10-12%23p-trip");
  });
  it("rejects missing or malformed assignments", () => {
    expect(() => accountPath({ id: "u", role: "GENERATOR" })).toThrow("assignment");
    expect(() => accountPath({ id: "u", role: "GENERATOR", generatorId: "../admin" })).toThrow();
    expect(() => accountPath({ id: "u", role: "DRIVER", planKey: "https://evil.example" })).toThrow();
  });
});
