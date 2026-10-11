import { afterEach, describe, expect, it, vi } from "vitest";
import { createMapSession } from "./mapSession";
import type { MapPoint } from "../workflow";

const plant: MapPoint = { id: "plant", name: "Plant", lat: 18.5, lng: 73.9, kind: "plant" };
const stop: MapPoint = { id: "one", name: "Kitchen", lat: 18.6, lng: 73.8, kind: "stop", order: 1 };
function harness(points = [plant, stop]) {
  let load!: () => void;
  let fail!: () => void;
  const port = { draw: vi.fn(), fit: vi.fn(), destroy: vi.fn() };
  const open = vi.fn((onLoad: () => void, onFailure: () => void) => {
    load = onLoad; fail = onFailure; return port;
  });
  const onStatus = vi.fn();
  const session = createMapSession({ points, open, onStatus });
  return { session, port, open, onStatus, load: () => load(), fail: () => fail() };
}
afterEach(() => { vi.useRealTimers(); });

describe("map resource lifetime and recovery", () => {
  it("draws the latest pre-load scene, then preserves the camera through polling and metadata edits", () => {
    const map = harness();
    const changed = [plant, { ...stop, order: 2, window: { start: "07:00", end: "09:00" } }];
    map.session.update(changed);
    expect(map.port.draw).not.toHaveBeenCalled();
    map.load();
    expect(map.port.draw).toHaveBeenLastCalledWith(changed);
    expect(map.port.fit).toHaveBeenCalledTimes(1);
    map.session.update(changed.map((point) => ({ ...point })));
    expect(map.port.draw).toHaveBeenCalledTimes(1);
    const next = [...changed, { ...stop, id: "held", kind: "excluded" as const, reason: "HAZARD_REVIEW" }];
    map.session.update(next);
    expect(map.port.draw).toHaveBeenLastCalledWith(next);
    map.session.update([...changed, { ...next[2], reason: "NOT_READY" }]);
    expect(map.port.draw).toHaveBeenCalledTimes(3);
    expect(map.open).toHaveBeenCalledTimes(1);
    expect(map.port.fit).toHaveBeenCalledTimes(1);
    map.session.fit();
    expect(map.port.fit).toHaveBeenCalledTimes(2);
    map.session.destroy();
  });
  it("fits once when locations first arrive, including an initially empty date", () => {
    const map = harness([]);
    map.load();
    expect(map.port.fit).not.toHaveBeenCalled();
    map.session.update([plant, stop]);
    expect(map.port.fit).toHaveBeenCalledTimes(1);
    map.session.update([]);
    expect(map.port.draw).toHaveBeenLastCalledWith([]);
    map.session.destroy();
  });
  it("releases a failed map, ignores late callbacks and recovers through one explicit new session", () => {
    vi.useFakeTimers();
    const failed = harness();
    failed.fail(); failed.fail(); failed.load();
    failed.session.update([plant]); failed.session.fit(); failed.session.destroy();
    expect(failed.port.destroy).toHaveBeenCalledTimes(1);
    expect(failed.port.draw).not.toHaveBeenCalled();
    expect(failed.onStatus.mock.calls).toEqual([["loading"], ["failed"]]);
    expect(vi.getTimerCount()).toBe(0);
    const retry = harness();
    retry.load();
    expect(retry.onStatus).toHaveBeenLastCalledWith("ready");
    expect(retry.open).toHaveBeenCalledTimes(1);
    retry.session.destroy(); retry.session.destroy();
    expect(retry.port.destroy).toHaveBeenCalledTimes(1);
  });
  it("times out a stalled provider without automatic retries or leaked resources", () => {
    vi.useFakeTimers();
    const map = harness();
    vi.advanceTimersByTime(15000);
    expect(map.port.destroy).toHaveBeenCalledTimes(1);
    expect(map.onStatus).toHaveBeenLastCalledWith("failed");
    map.load();
    expect(map.onStatus).not.toHaveBeenCalledWith("ready");
    expect(map.open).toHaveBeenCalledTimes(1);
  });
  it("handles missing WebGL and draw errors while preserving a recoverable failed state", () => {
    vi.useFakeTimers();
    const status = vi.fn();
    const map = createMapSession({ points: [plant], onStatus: status, open: () => { throw new Error("WebGL unavailable"); } });
    expect(status).toHaveBeenLastCalledWith("failed");
    map.destroy();
    expect(vi.getTimerCount()).toBe(0);
    const drawing = harness();
    drawing.port.draw.mockImplementation(() => { throw new Error("style lost"); });
    drawing.load();
    expect(drawing.port.destroy).toHaveBeenCalledTimes(1);
    expect(drawing.onStatus).toHaveBeenLastCalledWith("failed");
    expect(drawing.onStatus).not.toHaveBeenCalledWith("ready");
  });
  it("cancels timers on unmount and suppresses late loads", () => {
    vi.useFakeTimers();
    const map = harness();
    map.session.destroy(); map.load();
    vi.advanceTimersByTime(15000);
    expect(map.port.draw).not.toHaveBeenCalled();
    expect(map.port.destroy).toHaveBeenCalledTimes(1);
    expect(map.onStatus.mock.calls).toEqual([["loading"]]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
