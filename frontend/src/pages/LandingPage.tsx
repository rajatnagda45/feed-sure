import { useEffect, useRef } from "react";

import { WorkflowMedia } from "../components/WorkflowMedia";
import { FinalCTA } from "./landing/FinalCTA";
import { HeroSection } from "./landing/HeroSection";
import { LandingNav } from "./landing/LandingNav";
import { OperationsPreview } from "./landing/OperationsPreview";
import { ProblemSection } from "./landing/ProblemSection";
import { RoleSection } from "./landing/RoleSection";
import { TraceabilitySection } from "./landing/TraceabilitySection";
import { WorkflowSection } from "./landing/WorkflowSection";
import { motionEnabled } from "./landing/motion";

export function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);

  // Animation is strictly opt-in: the `fs--motion` class only hides/animates
  // content when IntersectionObserver is available and reduced-motion is off.
  // Without it, every section renders fully visible (no-JS / reduced-motion safe).
  useEffect(() => {
    if (motionEnabled()) rootRef.current?.classList.add("fs--motion");
  }, []);

  return (
    <div className="fs fs-intro" ref={rootRef}>
      <LandingNav />
      <main id="main">
        <HeroSection />
        <ProblemSection />
        <WorkflowSection />
        <WorkflowMedia />
        <OperationsPreview />
        <RoleSection />
        <TraceabilitySection />
        <FinalCTA />
      </main>
    </div>
  );
}
