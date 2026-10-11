import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

export function privateRolePath(link: string, role: "kitchen" | "driver", origin: string): string {
  const url = new URL(link.trim(), origin);
  const prefix = role === "kitchen" ? "/g/" : "/driver/";
  if (url.origin !== origin || !url.pathname.startsWith(prefix)
    || !url.pathname.slice(prefix.length) || url.pathname.slice(prefix.length).includes("/")
    || !url.searchParams.get("t") || url.username || url.password) {
    throw new Error(`Use the complete ${role === "kitchen" ? "supplier" : "driver"} link issued by your dispatcher for this FeedSure site.`);
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
      <Link className="brand" to="/" aria-label="FeedSure CBG home"><span className="brand-mark" aria-hidden="true">F</span><span>FeedSure CBG</span></Link>
      <h1>{kitchen ? "Waste supplier access" : "Driver access"}</h1>
      <p>{kitchen ? "For hotels, hostels, PG owners, canteens and organisations supplying bulk food waste. Confirm readiness and view your collection records."
        : "Open your assigned trip and record pickup outcomes while parked."}</p>
      <p>{kitchen ? "Ask your dispatcher for a supplier-specific private link."
        : "Your dispatcher sends a trip-specific private link after dispatch. Ask for a fresh link if it has expired."}</p>
      <form onSubmit={open}>
        <label className="field"><span>Paste your private {kitchen ? "supplier" : "driver"} link</span>
          <input type="password" required autoComplete="off" spellCheck={false} value={link}
            aria-invalid={Boolean(error)} aria-describedby="access-help"
            onChange={(event) => { setLink(event.currentTarget.value); setError(null); }} />
          <small id="access-help">Open the original link directly, or paste it here. Keep it private.</small>
        </label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <button className="button button-primary" type="submit">Open {kitchen ? "my supplier dashboard" : "assigned trip"}</button>
      </form>
      <Link className="text-button" to="/#demo-guide">Local demo access instructions</Link>
    </section>
  </main>;
}
