import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPlan, dispatchPlan, getDriverTrip, getGenerator, getGeneratorReceipts,
  getLatestPlan, getOperations, getPlanDetails, saveGate, savePickup, saveReadiness,
  type PickupRequest,
} from "../src/api";
import { requestGps } from "../src/workflow";

// Opt-in only: requires the disposable scripts/local_demo.py API. No HTTP mocks.
const live = process.env.FEEDSURE_LOCAL_INTEGRATION === "1";
const accessFile = process.env.FEEDSURE_LOCAL_ACCESS_FILE;
if (live && (!accessFile || resolve(accessFile) === resolve("../.tmp/local-demo-access.json"))) {
  throw new Error("Set FEEDSURE_LOCAL_ACCESS_FILE to a separate disposable demo manifest.");
}
const access = live ? JSON.parse(readFileSync(accessFile!, "utf8")) : null;
if (live) {
  const endpoint = new URL(access.apiBaseUrl);
  if (endpoint.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(endpoint.hostname)
    || !endpoint.port || endpoint.port === "8787"
    || process.env.VITE_API_BASE_URL !== access.apiBaseUrl) {
    throw new Error("Use a disposable loopback API on a non-default port matching VITE_API_BASE_URL.");
  }
}
const a = "demo-kitchen-01";
const b = "demo-kitchen-02";
const key = (scope: string) => scope + ":" + crypto.randomUUID();
const ready = (gid: string, day: string) => saveReadiness({
  generatorId: gid, collectionDate: day, status: "READY", confirmedKg: 100,
  weightSource: "SCALE", window: { start: "06:00", end: "09:00" }, photoKeys: [],
}, { generatorToken: access.generatorTokens[gid] });
const cancel = (gid: string, day: string) => saveReadiness({
  generatorId: gid, collectionDate: day, status: "NOT_READY", reason: "Synthetic cancellation",
}, { generatorToken: access.generatorTokens[gid] });
const reject = async (action: Promise<unknown>, status: number) => {
  await expect(action).rejects.toMatchObject({ name: "ApiError", status });
};

// Run on a fresh disposable server; records persist across HTTP refreshes in this process.
describe.skipIf(!live)("actual frontend client to local real-handler workflow", () => {
  it("confirms, cancels, rejects stale dispatch, replans, dispatches, picks up, reconciles and reads own records", async () => {
    const day = access.collectionDate;
    const admin = access.adminToken;
    const seeded = await getOperations(day, admin);
    expect(seeded.generators).toHaveLength(10);
    expect(seeded.serviceMode).toMatchObject({ database: "local", matrix: "fallback", screening: "not_used" });
    expect(seeded.generators.filter(g => g.readinessStatus === "UNCONFIRMED")).toHaveLength(2);
    expect(seeded.generators.some(g => g.readinessStatus === "NOT_READY")).toBe(true);
    for (const g of seeded.generators) {
      if (g.generatorId === a || g.generatorId === b) await ready(g.generatorId, day);
      else await cancel(g.generatorId, day);
    }
    expect((await getGenerator(a, access.generatorTokens[a])).generator.simulated).toBe(true);
    const draft = await createPlan(admin, { collectionDate: day, targetKg: 150 });
    expect(draft.params).toMatchObject({ readinessPrior: 0.8, capacityBuffer: 0.1 });
    expect(draft.plan.stops).toHaveLength(2);
    expect(draft.plan.totals).toMatchObject({ expectedCollectionKg: 160, reservedLoadKg: 220 });
    expect((await getPlanDetails(draft.planKey, admin)).plan.plan).toEqual(draft.plan);
    await cancel(b, day);
    await reject(dispatchPlan(draft.planKey, admin, {
      expectedVersion: draft.version, expectedInputRevision: draft.inputRevision,
    }, key("stale")), 409);
    const conflict = await createPlan(admin, { collectionDate: day, mandatoryIds: [b] });
    expect(conflict.status).toBe("MANDATORY_CONFLICT");
    await reject(dispatchPlan(conflict.planKey, admin, {
      expectedVersion: conflict.version, expectedInputRevision: conflict.inputRevision,
    }, key("conflict")), 409);
    await ready(b, day);
    const plan = await createPlan(admin, { collectionDate: day, targetKg: 150 });
    const dispatchKey = key("dispatch");
    const request = { expectedVersion: plan.version, expectedInputRevision: plan.inputRevision };
    const sent = await dispatchPlan(plan.planKey, admin, request, dispatchKey);
    expect(await dispatchPlan(plan.planKey, admin, request, dispatchKey)).toEqual(sent);
    const recovered = await dispatchPlan(plan.planKey, admin, {
      expectedVersion: sent.plan.version, expectedInputRevision: plan.inputRevision,
    }, key("recover-driver"));
    expect(recovered.driverAccess).toEqual(sent.driverAccess);
    const token = sent.driverAccess.token;
    let trip = await getDriverTrip(plan.planKey, token);
    expect(trip.reconciliation.status).toBe("PENDING_GATE");
    expect(trip.reconciliation.pendingStopIds).toHaveLength(2);
    await cancel(a, day);
    trip = await getDriverTrip(plan.planKey, token);
    expect(trip.alerts.some(alert => alert.code === "INPUTS_CHANGED")).toBe(true);
    expect(trip.plan.plan).toEqual(plan.plan); // Post-dispatch cancellation never reroutes.
    const denied = await requestGps({
      getCurrentPosition: (_success: PositionCallback, error: PositionErrorCallback) =>
        error({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    } as unknown as Geolocation);
    expect(denied.state).toBe("denied");
    for (const [gid, kg] of [[a, 100], [b, 60]] as const) {
      const pickup: PickupRequest = {
        planKey: plan.planKey, generatorId: gid, outcome: gid === a ? "COLLECTED" : "PARTIAL",
        kg, weightSource: gid === a ? "SCALE" : "ESTIMATE", gps: denied.gps,
        reason: gid === a ? null : "Capacity-limited synthetic pickup",
        remainingKg: gid === a ? null : 40, remainingUnknown: false, expectedRevision: 0,
      };
      const pickupKey = key("pickup");
      const saved = await savePickup(pickup, token, pickupKey);
      expect(saved.pickup.gpsStatus).toBe("UNKNOWN");
      expect(await savePickup(pickup, token, pickupKey)).toEqual(saved);
      await reject(savePickup({ ...pickup, kg: kg + 1 }, token, pickupKey), 409);
      await reject(savePickup(pickup, token, key("stale-pickup")), 409);
    }
    trip = await getDriverTrip(plan.planKey, token);
    expect(trip.pickups).toHaveLength(2);
    expect(trip.reconciliation).toMatchObject({ status: "PENDING_GATE", pickedKg: 160 });
    const partial = trip.pickups.find(p => p.generatorId === b)!;
    expect(partial).toMatchObject({ kg: 60, remainingKg: 40, remainingUnknown: false });
    // Send only request fields, rather than echoing server-only record properties.
    await savePickup({
      planKey: plan.planKey, generatorId: b, outcome: "PARTIAL", kg: 65,
      weightSource: "ESTIMATE", reason: "Capacity-limited synthetic pickup", remainingKg: 35,
      remainingUnknown: false, gps: null, expectedRevision: partial.revision,
      correctionReason: "Correct estimate",
    }, token, key("correct-pickup"));
    expect((await getDriverTrip(plan.planKey, token)).reconciliation.pickedKg).toBe(165);
    const zero = await saveGate({
      planKey: plan.planKey, netKg: 0, weightSource: "SCALE", reference: null, expectedRevision: 0,
    }, admin, key("zero-gate"));
    expect(zero.reconciliation).toMatchObject({ status: "REVIEW", pickedKg: 165, netGateKg: 0, deltaKg: -165 });
    const gateRequest = {
      planKey: plan.planKey, netKg: 160, weightSource: "SCALE" as const, reference: "synthetic-scale",
      expectedRevision: 1, correctionReason: "Correct intake entry",
    };
    const gateKey = key("gate");
    const gate = await saveGate(gateRequest, admin, gateKey);
    expect(gate.reconciliation).toMatchObject({ status: "WITHIN_TOLERANCE", pickedKg: 165, deltaKg: -5, provisional: true });
    expect(await saveGate(gateRequest, admin, gateKey)).toEqual(gate);
    expect((await getPlanDetails(plan.planKey, admin)).execution.reconciliation).toEqual(gate.reconciliation);
    const own = await getGeneratorReceipts(a, access.generatorTokens[a], day.slice(0, 7));
    expect(own.records).toHaveLength(1);
    expect(own.records[0]).toMatchObject({ gateStatus: "WITHIN_TOLERANCE", gateRecorded: true, pickup: { generatorId: a, kg: 100 } });
    expect(own.records[0]).not.toHaveProperty("netKg");
    // A saved draft must never hide the operating trip from dashboard refresh.
    const newer = await createPlan(admin, { collectionDate: day, targetKg: 75 });
    expect(newer.planKey).not.toBe(plan.planKey);
    expect((await getLatestPlan(day, admin)).plan?.planKey).toBe(plan.planKey);
    expect((await getPlanDetails(plan.planKey, admin)).execution.reconciliation.pickedKg).toBe(165);
  }, 30000);

  it("rejects anonymous, incorrect and cross-kitchen credentials and permits the real CORS headers", async () => {
    await reject(getOperations(access.collectionDate, ""), 401);
    await reject(getOperations(access.collectionDate, "incorrect"), 401);
    await reject(getGenerator(a, access.generatorTokens[b]), 401);
    const plan = (await getLatestPlan(access.collectionDate, access.adminToken)).plan!;
    await reject(getDriverTrip(plan.planKey, "incorrect"), 401);
    const response = await fetch(access.apiBaseUrl + "/pickups", { method: "OPTIONS", headers: {
      Origin: access.frontendOrigin, "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,x-driver-token,idempotency-key",
    } });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(access.frontendOrigin);
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("idempotency-key");
  }, 10000);

  it("handles pending outcomes, zero/zero intake and unmatched intake without division by zero", async () => {
    const nextDay = new Date(access.collectionDate + "T00:00:00Z");
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const day = nextDay.toISOString().slice(0, 10);
    await ready(a, day);
    await ready(b, day);
    const plan = await createPlan(access.adminToken, { collectionDate: day, targetKg: 150 });
    const sent = await dispatchPlan(plan.planKey, access.adminToken, {
      expectedVersion: plan.version, expectedInputRevision: plan.inputRevision,
    }, key("dispatch-zero"));
    const token = sent.driverAccess.token;
    expect((await getDriverTrip(plan.planKey, token)).reconciliation.status).toBe("PENDING_GATE");
    const gateRequest = { planKey: plan.planKey, netKg: 0, weightSource: "SCALE" as const, reference: null, expectedRevision: 0 };
    expect((await saveGate(gateRequest, access.adminToken, key("gate-zero"))).reconciliation.status).toBe("INCOMPLETE");
    for (const gid of [a, b]) await savePickup({
      planKey: plan.planKey, generatorId: gid, outcome: "NOT_READY", kg: 0,
      weightSource: null, reason: "Visited, unavailable", remainingKg: null,
      remainingUnknown: false, gps: null, expectedRevision: 0,
    }, token, key("empty"));
    expect((await getDriverTrip(plan.planKey, token)).reconciliation).toMatchObject({ status: "NO_LOAD", pickedKg: 0, netGateKg: 0, deltaPct: null });
    const unmatched = await saveGate({
      ...gateRequest, netKg: 50, expectedRevision: 1, correctionReason: "Correct synthetic intake",
    }, access.adminToken, key("gate-unmatched"));
    expect(unmatched.reconciliation).toMatchObject({ status: "UNMATCHED_INTAKE", deltaPct: null });
  }, 15000);
});
