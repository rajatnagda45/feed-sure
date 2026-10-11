import { apiRequest } from "./api";

export type AccountRole = "kitchen" | "cbg" | "owner" | "admin";
export const accountLabels: Record<AccountRole, string> = {
  kitchen: "Organic waste generator", cbg: "CBG operations", owner: "CBG plant owner", admin: "Admin",
};
export interface Account {
  loginId: string; role: AccountRole; status: "PENDING" | "ACTIVE" | "SUSPENDED";
  revision: number; organisation: string; contact: string; address: string;
  generatorId?: string; capacityKg?: number;
  profile?: { lat: number; lng: number; type: string };
}
export function accountRequest<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    accountToken: sessionStorage.getItem("feedsure:account") ?? "",
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
  });
}
export function clearAccountAccess() {
  Object.keys(sessionStorage).filter((key) => key.startsWith("feedsure:"))
    .forEach((key) => sessionStorage.removeItem(key));
}
