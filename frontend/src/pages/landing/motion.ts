import { useEffect, useRef, useState } from "react";

/** Motion is strictly opt-in: without JS or with reduced-motion the page renders fully visible. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function motionEnabled(): boolean {
  return (
    typeof window !== "undefined" &&
    "IntersectionObserver" in window &&
    !prefersReducedMotion()
  );
}

/**
 * Adds `is-in` to the element once it enters the viewport. When motion is
 * disabled the class is applied immediately so content never stays hidden.
 */
export function useReveal<T extends HTMLElement>(
  options: IntersectionObserverInit = { threshold: 0.2, rootMargin: "0px 0px -8% 0px" },
) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!motionEnabled()) {
      el.classList.add("is-in");
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      }
    }, options);
    observer.observe(el);
    return () => observer.disconnect();
  }, [options]);
  return ref;
}

/** Counts up to `value` only while in view and motion is allowed; otherwise shows the final value. */
export function useCountUp(value: number, durationMs = 1100) {
  const [display, setDisplay] = useState(() => (motionEnabled() ? 0 : value));
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !motionEnabled()) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    let start = 0;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      observer.disconnect();
      const step = (now: number) => {
        if (!start) start = now;
        const progress = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - progress, 3);
        setDisplay(Math.round(value * eased));
        if (progress < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.6 });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, durationMs]);
  return { ref, display };
}
