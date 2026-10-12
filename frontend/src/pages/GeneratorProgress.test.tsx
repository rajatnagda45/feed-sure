import { act, create, ReactTestRenderer } from "react-test-renderer";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { GeneratorPage } from "./GeneratorPage";
import { getKitchenReadiness, PhotoRecord } from "../photoApi";
import { serviceDateInIndia } from "../workflow";

vi.mock("../auth", () => ({ useAccount: () => ({ account: { role: "GENERATOR" } }) }));
vi.mock("../api", async (original) => ({
  ...await original<typeof import("../api")>(),
  getGenerator: vi.fn().mockResolvedValue({ generator: {
    generatorId: "site", name: "Synthetic site", defaultLang: "en", simulated: true,
    pickupWindow: { start: "06:00", end: "09:00" },
  } }),
  getGeneratorReceipts: vi.fn().mockResolvedValue({ records: [] }),
}));
vi.mock("../photoApi", () => ({ getKitchenReadiness: vi.fn() }));
vi.mock("../components/OptionalPhoto", () => ({
  OptionalPhoto: ({ submission, onSaved }: { submission: PhotoRecord; onSaved: (record: PhotoRecord) => void }) =>
    <button type="button" onClick={() => onSaved({ ...submission, photoKeys: ["synthetic/photo.png"] })}>Save changed photo</button>,
}));
let tree: ReactTestRenderer;
afterEach(() => { if (tree) act(() => tree.unmount()); vi.clearAllMocks(); });

it.each(["DRAFT", "DISPATCHED"] as const)("photo updates invalidate a draft, preserving a %s trip's actual state", async (state) => {
  vi.mocked(getKitchenReadiness).mockResolvedValue({
    submission: { submissionId: "ready-site", collectionDate: serviceDateInIndia(),
      generatorId: "site", status: "READY", confirmedKg: 80, photoKeys: [],
      window: { start: "06:00", end: "09:00" }, weightSource: "ESTIMATE" } as unknown as PhotoRecord,
    collectionPlan: { state, stale: false }, unresolvedHazard: null,
  });
  await act(async () => { tree = create(<MemoryRouter initialEntries={["/g/site"]}>
    <Routes><Route path="/g/:id" element={<GeneratorPage />} /></Routes>
  </MemoryRouter>); });
  const planned = () => tree.root.findAllByType("li").find((item) => item.findAllByProps({ className: "gen-timeline__label" })[0]?.children[0] === "Planned")!;
  expect(planned().props.className).toBe("is-done");
  await act(async () => { tree.root.findAllByType("button").find((button) => button.props.children === "Save changed photo")!.props.onClick(); });
  expect(planned().props.className).toBe(state === "DRAFT" ? "" : "is-done");
  expect(JSON.stringify(tree.toJSON())).toContain("80");
});
