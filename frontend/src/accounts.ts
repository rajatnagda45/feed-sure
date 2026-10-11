import { apiRequest } from "./api";
import { supabase } from "./supabase";

export type AccountRole = "kitchen" | "cbg" | "owner" | "admin";
export const accountLabels: Record<AccountRole | "driver", string> = {
  kitchen: "Organic waste generator", cbg: "CBG operations", owner: "CBG plant owner", admin: "Admin", driver: "Driver",
};
export interface Account {
  id: string;
  loginId: string; role: AccountRole | "driver"; status: "PENDING" | "ACTIVE" | "SUSPENDED";
  revision: number; organisation: string; contact: string; address: string;
  generatorId?: string; capacityKg?: number;
  profile?: { lat: number; lng: number; type: string };
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
export async function registerAccount(payload: Registration, admin = false): Promise<void> {
  if (!supabase) throw new Error("Supabase registration is not configured. Ask your operator.");
  if (admin) { await accountRequest<Account>("/auth/accounts", payload); return; }
  if (payload.role === "admin") throw new Error("Admin accounts require an existing Admin.");
  const status = await apiRequest<{ ready: boolean }>("/auth/registration", { anonymous: true });
  if (!status.ready) throw new Error("Account registration is not ready. Ask your operator to check Supabase setup.");
  const { email, password, lat, lng, type, ...details } = payload;
  const { error } = await supabase.auth.signUp({ email, password, options: {
    data: { feedsure_registration: { ...details,
      ...(payload.role === "kitchen" ? { profile: { lat, lng, type } } : {}),
    } },
  } });
  if (error?.code === "email_address_not_authorized") {
    throw new Error("Verification email cannot be sent to this address. Ask your operator to configure Supabase SMTP, or have an Admin create your account.");
  }
  if (error) throw error;
}
