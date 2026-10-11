// Approval-only pilots can use Supabase with Confirm email disabled. This flag
// changes UI guidance, never provider security settings or server authorization.
export const emailDeliveryEnabled = import.meta.env.VITE_AUTH_EMAIL_MODE === "email";
export const authRedirect = (path: string) => typeof window === "undefined" ? undefined : new URL(path, window.location.origin).href;
