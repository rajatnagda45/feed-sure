import { afterEach, expect, it, vi } from "vitest";
import { apiRequest } from "./api";
import { accessToken } from "./supabase";

vi.mock("./supabase", () => ({ accessToken: vi.fn().mockRejectedValue(new Error("Sign in again")) }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("can check signup readiness before the user has an SDK session", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ready: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await apiRequest("/auth/registration", { anonymous: true })).toEqual({ ready: true });
  expect(accessToken).not.toHaveBeenCalled();
  const options = fetchMock.mock.calls[0][1];
  expect(options).not.toHaveProperty("anonymous");
  expect(new Headers(options.headers).has("Authorization")).toBe(false);
});

it("still requires a session for ordinary protected requests", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await expect(apiRequest("/auth/accounts")).rejects.toThrow("Sign in again");
  expect(fetchMock).not.toHaveBeenCalled();
});
