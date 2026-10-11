import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const supabaseEnabled = Boolean(url || key);
export const supabase = url && key ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
}) : null;

export async function accessToken(): Promise<string | null> {
  if (!supabaseEnabled) return null;
  if (!supabase) throw new Error("Configure both Supabase frontend variables.");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error("Your session has ended. Sign in again.");
  return data.session.access_token;
}
