import type { Lang } from "./api";
export function normalizeLanguage(value: unknown): Lang {
  return typeof value === "string" && value.toLowerCase() === "hi" ? "hi" : "en";
}
