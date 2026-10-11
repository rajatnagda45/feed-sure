import { afterEach, describe, expect, it, vi } from "vitest";

const { token } = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock("./supabase", () => ({ accessToken: token, supabaseEnabled: true, supabase: null }));
import { apiRequest } from "./api";

afterEach(() => { vi.unstubAllGlobals(); token.mockReset(); });

describe("Supabase API authentication", () => {
  it("uses the latest SDK bearer and preserves idempotency without legacy secrets", async () => {
    token.mockResolvedValueOnce("session-one").mockResolvedValueOnce("refreshed-session");
    const fetch = vi.fn().mockImplementation(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    const options = { adminToken: "legacy-admin", generatorToken: "legacy-supplier",
      plantToken: "legacy-owner", driverToken: "legacy-driver", idempotencyKey: "retry-key" };
    await apiRequest("/operations", options);
    await apiRequest("/operations", options);
    expect(new Headers(fetch.mock.calls[0][1].headers).get("Authorization")).toBe("Bearer session-one");
    const headers = new Headers(fetch.mock.calls[1][1].headers);
    expect(headers.get("Authorization")).toBe("Bearer refreshed-session");
    expect(headers.get("Idempotency-Key")).toBe("retry-key");
    for (const name of ["X-Admin-Token", "X-Generator-Token", "X-Plant-Token", "X-Driver-Token"])
      expect(headers.has(name)).toBe(false);
  });
  it("does not submit a request when the session is absent or cannot refresh", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    token.mockRejectedValue(new Error("Sign in again"));
    await expect(apiRequest("/operations", { adminToken: "legacy" })).rejects.toThrow("Sign in again");
    expect(fetch).not.toHaveBeenCalled();
  });
});
