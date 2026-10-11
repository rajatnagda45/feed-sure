import { authMessage } from "./network";
import { authRedirect, emailDeliveryEnabled } from "./authEmail";
import { apiRequest } from "./api";
import { supabase } from "./supabase";

export type AccountRole = "kitchen" | "cbg" | "owner" | "admin" | "driver";
export const accountLabels: Record<AccountRole | "driver", string> = {
  kitchen: "Organic waste generator", cbg: "CBG operations", owner: "CBG plant owner", admin: "Admin", driver: "Driver",
};
export interface Account {
  id: string;
  loginId: string; role: AccountRole | "driver"; status: "PENDING" | "ACTIVE" | "SUSPENDED";
  revision: number; organisation: string; contact: string; address: string;
  generatorId?: string; planKey?: string; capacityKg?: number;
  profile?: { lat?: number; lng?: number; type: string };
}
export function accountRequest<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
  });
}
export function clearAccountAccess() {
  Object.keys(sessionStorage).filter((key) => key.startsWith("feedsure:"))
    .forEach((key) => sessionStorage.removeItem(key));
}

export interface Registration {
  role: AccountRole; email: string; password: string; organisation: string;
  contact: string; address: string; lat?: number; lng?: number; type?: string; capacityKg?: number;
}
export interface RegistrationStatus { ready: boolean; emailConfirmationRequired: boolean }
export async function checkRegistrationSetup(): Promise<void> {
  const status = await apiRequest<RegistrationStatus>("/auth/registration", { anonymous: true });
  if (!status.ready) throw new Error("Account registration is not ready. Ask your operator to check Supabase setup.");
  if (!emailDeliveryEnabled && status.emailConfirmationRequired !== false)
    throw new Error("Turn off Confirm email in Supabase to enable registration without email verification.");
}
export async function registerAccount(payload: Registration, admin = false): Promise<void> {
  if (!supabase) throw new Error("Supabase registration is not configured. Ask your operator.");
  if (admin) { await accountRequest<Account>("/auth/accounts", payload); return; }
  if (payload.role === "admin" || payload.role === "driver") throw new Error("Admin and driver accounts require an existing Admin.");
  await checkRegistrationSetup();
  const { email, password, lat, lng, type, ...details } = payload;
  const { data, error } = await supabase.auth.signUp({ email, password, options: {
    emailRedirectTo: authRedirect("/login"),
    data: { feedsure_registration: { ...details,
      ...(payload.role === "kitchen" ? { profile: { type, ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}) } } : {}),
    } },
  } });
  if (error) throw new Error(authMessage(error));
  if (!emailDeliveryEnabled && !data.session)
    throw new Error("No sign-in session was created. Ask your operator to turn off Confirm email, then sign in with the account you registered.");
}
