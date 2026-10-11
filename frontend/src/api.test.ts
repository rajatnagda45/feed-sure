import { afterEach, describe, expect, it, vi } from "vitest";

import readyRequest from "../../tests/contracts/ready-request.json";
import readyResponse from "../../tests/contracts/ready-response.json";
import driverResponse from "../../tests/contracts/driver-response.json";
import { apiRequest, getPlantIntake, savePlantGate, savePickup, saveReadiness } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("READY v3 API boundary", () => {
  it("sends the exact generator auth header and fixture request shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(readyResponse), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await saveReadiness(readyRequest as Parameters<typeof saveReadiness>[0], { generatorToken: "generator-secret" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("X-Generator-Token")).toBe("generator-secret");
    expect(headers.has("Authorization")).toBe(false);
    expect(JSON.parse(String(init.body))).toEqual(readyRequest);
  });

  it("uses driver and idempotency headers and preserves revision fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      pickup: driverResponse.pickups[0],
      reconciliation: driverResponse.reconciliation,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = {
      planKey: "2026-10-12#1", generatorId: "generator#1", outcome: "PARTIAL" as const,
      kg: 80, weightSource: "SCALE" as const, reason: "Capacity", remainingKg: 20,
      remainingUnknown: false, gps: null, expectedRevision: 1, correctionReason: "Corrected ticket",
    };

    await savePickup(request, "driver-secret", "pickup:g-1:event-1");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("X-Driver-Token")).toBe("driver-secret");
    expect(headers.get("Idempotency-Key")).toBe("pickup:g-1:event-1");
    expect(JSON.parse(String(init.body)).expectedRevision).toBe(1);
  });

  it("encodes path identifiers and preserves the contract error envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "CONFLICT", message: "stale revision", details: { currentRevision: 3 } },
    }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/plans/2026-10-12%231/dispatch")).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
      details: { currentRevision: 3 },
    });
  });
});


it("keeps owner credentials separate for intake reads and idempotent gate writes", async () => {
  const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
  vi.stubGlobal("fetch", fetchMock);
  await getPlantIntake("2026-10-11", "owner-secret");
  const request = { planKey: "2026-10-11#trip", netKg: 0, weightSource: "SCALE" as const, reference: null, expectedRevision: 0 };
  await savePlantGate(request, "owner-secret", "owner-event");
  expect(fetchMock.mock.calls[0][0]).toContain("/intake?date=2026-10-11");
  for (const [, init] of fetchMock.mock.calls) {
    const headers = new Headers(init.headers);
    expect(headers.get("X-Plant-Token")).toBe("owner-secret");
    expect(headers.has("X-Admin-Token")).toBe(false);
  }
  expect(new Headers(fetchMock.mock.calls[1][1].headers).get("Idempotency-Key")).toBe("owner-event");
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(request);
});
