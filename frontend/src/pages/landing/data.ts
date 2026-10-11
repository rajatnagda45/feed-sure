/**
 * Illustrative demo records for the landing page only. These are synthetic
 * examples that mirror real FeedSure operational screens; they are clearly
 * labelled as demo data throughout the UI and never presented as live metrics.
 */

export const problems = [
  {
    id: "01",
    title: "Unconfirmed quantities",
    body: "A truck leaves without knowing how much waste is actually ready, so capacity is guessed rather than reserved.",
  },
  {
    id: "02",
    title: "Unclear pickup windows",
    body: "Suppliers and drivers disagree on when a site is reachable, and stops are missed or repeated.",
  },
  {
    id: "03",
    title: "Routes beyond capacity",
    body: "A plan looks fine on paper but exceeds the vehicle's load or the practical collection window.",
  },
  {
    id: "04",
    title: "Collected is not received",
    body: "What the driver records at the kerb rarely matches the net weight logged at the plant gate.",
  },
] as const;

export const workflow = [
  {
    step: "01",
    key: "ready",
    name: "Ready",
    role: "Supplier confirmation",
    summary:
      "Hotels, hostels, PGs, canteens and other bulk food-waste sources confirm available quantity and a pickup window.",
    sample: {
      supplier: "Harbour View Canteen",
      category: "Wet food waste",
      quantity: "120 kg (est.)",
      window: "06:00 – 09:00",
      status: "Confirmed",
    },
  },
  {
    step: "02",
    key: "plan",
    name: "Plan",
    role: "Dispatcher route planning",
    summary:
      "Dispatchers review confirmed and unconfirmed suppliers, resolve capacity conflicts and freeze a feasible route.",
  },
  {
    step: "03",
    key: "collect",
    name: "Collect",
    role: "Driver pickup recording",
    summary:
      "Drivers open the assigned trip, follow ordered stops and record full, partial or skipped pickups with notes.",
    outcomes: [
      { label: "Full pickup", value: "118 kg", tone: "ok" },
      { label: "Partial pickup", value: "64 kg", tone: "warn" },
      { label: "Skipped", value: "site closed", tone: "muted" },
    ],
  },
  {
    step: "04",
    key: "reconcile",
    name: "Reconcile",
    role: "CBG plant intake",
    summary:
      "Plant operators record net received weight and surface discrepancies between driver records and gate intake.",
  },
] as const;

/** Compact route used in the Plan mockup. Schematic coordinates, not geography. */
export const planStops = [
  { n: 1, name: "Harbour View Canteen", load: "120 kg", window: "06:00" },
  { n: 2, name: "Lakeside Hostel Mess", load: "90 kg", window: "06:40" },
  { n: 3, name: "Grand Court Hotel", load: "150 kg", window: "07:30" },
  { n: 4, name: "Unity PG Kitchen", load: "70 kg", window: "08:10" },
] as const;

export const reconciliation = [
  { supplier: "Harbour View Canteen", expected: 120, collected: 118, received: 116 },
  { supplier: "Lakeside Hostel Mess", expected: 90, collected: 64, received: 64 },
  { supplier: "Grand Court Hotel", expected: 150, collected: 150, received: 141 },
  { supplier: "Unity PG Kitchen", expected: 70, collected: 0, received: 0 },
] as const;

export const roles = [
  {
    n: "01",
    name: "Waste supplier",
    body: "Confirm available quantity, set a pickup window and review your own collection records.",
    cta: { label: "Open supplier access", to: "/supplier-access" },
    note: "Requires a supplier-specific link",
    accent: "sage",
  },
  {
    n: "02",
    name: "Dispatcher",
    body: "Review readiness and cancellations, resolve capacity conflicts and dispatch a feasible route.",
    cta: { label: "Open dispatcher access", to: "/admin" },
    note: "Opens with the runtime admin token",
    accent: "forest",
  },
  {
    n: "03",
    name: "Driver",
    body: "Open the assigned trip, follow the ordered stops and record actual pickup outcomes.",
    cta: { label: "Open driver access", to: "/driver-access" },
    note: "Driver link is issued after dispatch",
    accent: "moss",
  },
  {
    n: "04",
    name: "CBG plant owner",
    body: "Review recorded pickups, enter net received weight and reconcile intake discrepancies.",
    cta: { label: "Open plant owner access", to: "/owner" },
    note: "Uses a separate plant owner credential",
    accent: "lime",
  },
] as const;
