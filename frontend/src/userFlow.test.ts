import { afterEach, expect, it, vi } from "vitest";
import { normalizeLanguage } from "./language";
import { t } from "./i18n";
import { wasteCopy } from "./wasteCopy";
import { authMessage, timedFetch } from "./network";
import { accountPath } from "./auth";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("opens enrolled uppercase language profiles safely and falls back for unknown languages", () => {
  for (const input of ["EN", "en", null, "unknown"]) {
    const lang = normalizeLanguage(input); expect(lang).toBe("en"); expect(t(lang)).toBeTruthy(); expect(wasteCopy(lang).title).toBeTruthy();
  }
  expect(normalizeLanguage("HI")).toBe("hi");
});
it("unassigned drivers have a waiting page without a fabricated trip", () => {
  expect(accountPath({ id: "d", role: "DRIVER" })).toBe("/driver");
});
it("explains rate limits, unconfirmed email and bad credentials", () => {
  expect(authMessage({ code: "over_email_send_rate_limit" })).toContain("temporarily limited");
  expect(authMessage({ code: "over_request_rate_limit" })).toBe("Too many requests. Wait a moment before trying again.");
  expect(authMessage({ code: "email_not_confirmed" })).toContain("turn off Confirm email");
  expect(authMessage({ code: "invalid_credentials" })).toContain("Forgot password");
});
it("aborts a stalled request and does not automatically retry it", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))));
  vi.stubGlobal("fetch", fetch);
  const result = timedFetch("https://example.test");
  const assertion = expect(result).rejects.toThrow("took too long");
  await vi.advanceTimersByTimeAsync(15000); await assertion; expect(fetch).toHaveBeenCalledTimes(1);
});
