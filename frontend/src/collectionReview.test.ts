import { expect, it } from "vitest";
import { collectionJourney, currentExclusion } from "./workflow";
import type { GeneratorReceipt, OperationGenerator, PlanEnvelope } from "./api";

const supplier = { generatorId: "site", readinessStatus: "READY", supportedMaterial: true,
  unresolvedHazards: [] } as unknown as OperationGenerator;
const plan = { inputRevision: 1, state: "DRAFT", excluded: [{ generatorId: "site", reason: "UNCONFIRMED" }] } as PlanEnvelope;

it("does not present an old exclusion as the current readiness", () => {
  expect(currentExclusion(supplier, plan, 2)).toBeNull();
  expect(currentExclusion(supplier, { ...plan, state: "DISPATCHED" }, 2)).toBeNull();
  expect(currentExclusion(supplier, plan, 1)).toBe("UNCONFIRMED");
  expect(currentExclusion({ ...supplier, readinessStatus: "NOT_READY" }, plan, 2)).toBe("NOT_READY");
  expect(currentExclusion({ ...supplier, unresolvedHazards: [{}] } as OperationGenerator, plan, 2)).toBe("HAZARD_REVIEW");
});

it("does not use another date's receipt or NOT_READY to mark progress complete", () => {
  const previous = [{ collectionDate: "2026-10-11", gateRecorded: true, pickup: { kg: 100 } }] as GeneratorReceipt[];
  expect(collectionJourney("2026-10-12", false, null, previous).map(s => s.done)).toEqual([false, false, false, false]);
  expect(collectionJourney("2026-10-12", true, { state: "DRAFT", stale: false }, previous).map(s => s.done)).toEqual([true, true, false, false]);
  expect(collectionJourney("2026-10-12", true, { state: "DRAFT", stale: true }, previous)[1].done).toBe(false);
  expect(collectionJourney("2026-10-12", true, { state: "CANCELLED", stale: false }, previous)[1].done).toBe(false);
});

it("zero pickup is not collected and a gate record is only trip-level evidence", () => {
  const records = [{ collectionDate: "2026-10-12", gateRecorded: true, pickup: { kg: 0 } }] as GeneratorReceipt[];
  expect(collectionJourney("2026-10-12", true, null, records).map(s => s.done)).toEqual([true, true, false, false]);
  records[0].pickup.kg = 20;
  expect(collectionJourney("2026-10-12", true, null, records).every(s => s.done)).toBe(true);
});
