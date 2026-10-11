import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { supabaseEnabled } from "../../supabase";

const links = [
  { href: "#workflow", label: "How it works" },
  { href: "#operations", label: "Operations" },
  { href: "#demo-guide", label: "For suppliers" },
  { href: "#reconcile", label: "For plants" },
];

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className={`fs-nav${scrolled ? " is-scrolled" : ""}`}>
      <div className="fs-nav__inner">
        <Link className="fs-wordmark" to="/" aria-label="FeedSure CBG home" onClick={() => setOpen(false)}>
          <span className="fs-wordmark__mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" role="img" aria-label="">
              <path d="M12 3C7 5 5 9 6 14c3 0 6-1 8-4-1 4-4 6-7 7l1 2c6-1 9-5 9-11 0-2-2-4-5-5Z" fill="currentColor" />
            </svg>
          </span>
          <span className="fs-wordmark__text">
            FeedSure<span aria-hidden="true"> </span><em>CBG</em>
          </span>
        </Link>

        <nav className="fs-nav__links" aria-label="Primary">
          {links.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </nav>

        <div className="fs-nav__actions">
          {supabaseEnabled && (
            <Link className="fs-btn fs-btn--ghost fs-btn--sm" to="/login">
              Sign in
            </Link>
          )}
          <Link className="fs-btn fs-btn--primary fs-btn--sm" to="/admin">
            Open operations desk
          </Link>
          <button
            type="button"
            className={`fs-nav__burger${open ? " is-open" : ""}`}
            aria-expanded={open}
            aria-controls="fs-mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </button>
        </div>
      </div>

      <div id="fs-mobile-menu" className={`fs-mobile${open ? " is-open" : ""}`} hidden={!open}>
        <nav aria-label="Mobile" className="fs-mobile__links">
          {links.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
        </nav>
        {supabaseEnabled && (
          <Link className="fs-btn fs-btn--ghost fs-btn--block" to="/login" onClick={() => setOpen(false)}>
            Sign in
          </Link>
        )}
        <Link className="fs-btn fs-btn--primary fs-btn--block" to="/admin" onClick={() => setOpen(false)}>
          Open operations desk
        </Link>
        <Link className="fs-btn fs-btn--ghost fs-btn--block" to="/supplier-access" onClick={() => setOpen(false)}>
          Waste supplier access
        </Link>
      </div>
    </header>
  );
}
