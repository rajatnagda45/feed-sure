import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

export function privateRolePath(link: string, role: "kitchen" | "driver", origin: string): string {
  const url = new URL(link.trim(), origin);
  const prefix = role === "kitchen" ? "/g/" : "/driver/";
  if (url.origin !== origin || !url.pathname.startsWith(prefix)
    || !url.pathname.slice(prefix.length) || url.pathname.slice(prefix.length).includes("/")
    || !url.searchParams.get("t") || url.username || url.password) {
    throw new Error(`Use the complete ${role} link issued by your dispatcher for this FeedSure site.`);
  }
  return `${url.pathname}${url.search}`;
}

export function RoleAccessPage({ role }: { role: "kitchen" | "driver" }) {
  const navigate = useNavigate();
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const kitchen = role === "kitchen";
  function open(event: FormEvent) {
    event.preventDefault();
    try { navigate(privateRolePath(link, role, window.location.origin)); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "Check your private link."); }
  }
  return <main className="auth-shell">
    <section className="token-panel">
      <Link className="brand" to="/">FeedSure CBG</Link>
      <h1>{kitchen ? "Kitchen access" : "Driver access"}</h1>
      {kitchen && <Link className="button button-primary" to="/login?role=generator">Sign in with ID and password</Link>}
      <p>{kitchen ? "Confirm waste readiness and view your kitchen’s collection records."
        : "Open your assigned trip and record pickup outcomes while parked."}</p>
      <p>{kitchen ? "Ask your dispatcher for a kitchen-specific private link."
        : "Your dispatcher sends a trip-specific private link after dispatch. Ask for a fresh link if it has expired."}</p>
      <form onSubmit={open}>
        <label className="field"><span>Paste your private {role} link</span>
          <input type="password" required autoComplete="off" spellCheck={false} value={link}
            aria-invalid={Boolean(error)} aria-describedby="access-help"
            onChange={(event) => { setLink(event.currentTarget.value); setError(null); }} />
          <small id="access-help">Open the original link directly, or paste it here. Keep it private.</small>
        </label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <button className="button button-primary" type="submit">Open {kitchen ? "my kitchen" : "assigned trip"}</button>
      </form>
      <Link className="text-button" to="/#demo-guide">Local demo access instructions</Link>
    </section>
  </main>;
}
