import { afterEach, expect, it, vi } from "vitest";
import { accountRequest, clearAccountAccess } from "./accounts";
vi.mock("./supabase", () => ({ accessToken: vi.fn().mockResolvedValue("supabase-session") }));

afterEach(() => vi.unstubAllGlobals());

it("sends the SDK bearer without granting legacy dispatcher credentials", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accounts: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  await accountRequest("/auth/accounts");
  const headers = new Headers(fetch.mock.calls[0][1].headers);
  expect(headers.get("Authorization")).toBe("Bearer supabase-session");
  expect(headers.has("X-Account-Token")).toBe(false);
  expect(headers.has("X-Admin-Token")).toBe(false);
});

it("clears role access on account switch while preserving unrelated tab data", () => {
  const storage: Record<string, unknown> = {
    "feedsure:admin": "old-admin", "feedsure:generator:site": "old-generator",
    "feedsure:plant-owner": "old-owner", "feedsure:account": "old-session", unrelated: "keep",
  };
  storage.removeItem = (key: string) => { delete storage[key]; };
  vi.stubGlobal("sessionStorage", storage);
  clearAccountAccess();
  expect(Object.keys(storage).some((key) => key.startsWith("feedsure:"))).toBe(false);
  expect(storage.unrelated).toBe("keep");
});
