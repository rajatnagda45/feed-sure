import { beforeEach, expect, it, vi } from "vitest";
import { registerAccount } from "./accounts";
import { supabase } from "./supabase";
import { apiRequest } from "./api";
import { AuthApiError } from "@supabase/supabase-js";

vi.mock("./supabase", () => ({ supabase: { auth: { signUp: vi.fn() } } }));
vi.mock("./api", () => ({ apiRequest: vi.fn() }));
const payload = { role: "kitchen" as const, email: "supplier@example.test", password: "test-password-long",
  organisation: "Test hotel", contact: "Test contact", address: "Test address", lat: 12.68, lng: 77.47, type: "hotel" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(apiRequest).mockResolvedValue({ ready: true, emailConfirmationRequired: false });
  const user = { id: "test-user", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-10-11T00:00:00Z" };
  vi.mocked(supabase!.auth.signUp).mockResolvedValue({ data: { user, session: {
    access_token: "test-token", refresh_token: "test-refresh", expires_in: 3600, token_type: "bearer", user,
  } }, error: null });
});

it("uses native signup with registration metadata and no embedded password or app role", async () => {
  await registerAccount(payload);
  const request = vi.mocked(supabase!.auth.signUp).mock.calls[0][0];
  expect(request).toMatchObject({ email: payload.email, password: payload.password, options: {
    data: { feedsure_registration: { role: "kitchen", profile: { lat: 12.68, lng: 77.47, type: "hotel" } } },
  } });
  expect(JSON.stringify(request.options?.data)).not.toContain(payload.password);
  expect(request.options?.data).not.toHaveProperty("app_metadata");
  expect(apiRequest).toHaveBeenCalledWith("/auth/registration", { anonymous: true });
});

it("stops before signup when Supabase still requires email verification", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ ready: true, emailConfirmationRequired: true });
  await expect(registerAccount(payload)).rejects.toThrow("Turn off Confirm email");
  expect(supabase!.auth.signUp).not.toHaveBeenCalled();
});

it("does not claim immediate access when signup produces no session", async () => {
  vi.mocked(supabase!.auth.signUp).mockResolvedValue({ data: { user: null, session: null }, error: null });
  await expect(registerAccount(payload)).rejects.toThrow("No sign-in session was created");
});

it("public signup cannot request Admin while trusted creation goes through the backend", async () => {
  await expect(registerAccount({ ...payload, role: "admin" })).rejects.toThrow("existing Admin");
  expect(supabase!.auth.signUp).not.toHaveBeenCalled();
  vi.mocked(apiRequest).mockResolvedValue({ status: "PENDING" });
  await registerAccount({ ...payload, role: "admin" }, true);
  expect(apiRequest).toHaveBeenCalledWith("/auth/accounts", expect.objectContaining({ method: "POST" }));
  expect(supabase!.auth.signUp).not.toHaveBeenCalled();
});

it("reports provider failures so the form cannot claim registration succeeded", async () => {
  vi.mocked(supabase!.auth.signUp).mockRejectedValue(new Error("Signup unavailable"));
  await expect(registerAccount(payload)).rejects.toThrow("Signup unavailable");
});

it("stops before signup when the account migration or backend is unavailable", async () => {
  vi.mocked(apiRequest).mockRejectedValue(new Error("Run the Supabase account migration."));
  await expect(registerAccount(payload)).rejects.toThrow("account migration");
  expect(supabase!.auth.signUp).not.toHaveBeenCalled();
});

it("explains the no-email setup when Supabase still requires delivery", async () => {
  vi.mocked(supabase!.auth.signUp).mockResolvedValue({ data: { user: null, session: null },
    error: new AuthApiError("Email address not authorized", 403, "email_address_not_authorized") });
  await expect(registerAccount(payload)).rejects.toThrow("no-email pilot setup");
});
