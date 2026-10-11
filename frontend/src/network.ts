import { emailDeliveryEnabled } from "./authEmail";
// Bound SDK and API requests, including reading response bodies. Never retry writes.
export async function timedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const cancel = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) cancel();
  else init.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Request timed out")), 15000);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const body = await response.arrayBuffer();
    return new Response(body.byteLength ? body : null, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new Error(controller.signal.aborted
      ? "The request took too long. Check your connection and try again."
      : "We couldn't connect. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", cancel);
  }
}

export function authMessage(issue: unknown): string {
  const code = (issue as { code?: string })?.code;
  if (code === "over_request_rate_limit")
    return "Too many requests. Wait a moment before trying again.";
  if (code === "over_email_send_rate_limit")
    return emailDeliveryEnabled ? "Verification emails are temporarily limited. Check your inbox and spam folder, then try again later." : "Email sending is temporarily limited. Ask the operator to turn off Confirm email in Supabase for this password-only installation.";
  if (code === "email_address_not_authorized")
    return emailDeliveryEnabled ? "Verification email cannot be sent to this address. Ask your operator to configure Supabase SMTP, or have an Admin create your account." : "This installation still requires email confirmation. Ask your operator to finish the no-email pilot setup, or have an Admin create your account.";
  if (code === "email_not_confirmed") return emailDeliveryEnabled ? "Confirm your email before signing in. Use Resend confirmation if you need a new link." : "Email confirmation is still enabled for this account. Ask your operator to turn off Confirm email and fix this account's Auth setup.";
  if (code === "invalid_credentials") return "Email or password is incorrect. Try again or use Forgot password.";
  if (code === "otp_expired") return "This email link has expired or was already used. Request a new link.";
  return issue instanceof Error ? issue.message : "The request could not be completed. Please try again.";
}
