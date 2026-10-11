import { act, create, ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { LocationPicker } from "./LocationPicker";
import { apiRequest } from "../api";
vi.mock("../api", () => ({apiRequest: vi.fn()}));
vi.mock("maplibre-gl", () => ({Map: vi.fn(), Marker: vi.fn(), NavigationControl: vi.fn(), setWorkerUrl: vi.fn()}));
vi.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url", () => ({default: "worker.js"}));
let tree: ReactTestRenderer;
afterEach(() => {if(tree) act(() => tree.unmount()); vi.clearAllMocks();});
async function search(onChange = vi.fn(), pin = "560004", allowPinArea = true) {
  await act(async () => {tree=create(<LocationPicker address="Test address" onChange={onChange} allowPinArea={allowPinArea}/>);});
  await act(async () => {tree.root.findByType("input").props.onChange({currentTarget:{value:pin}});});
  await act(async () => {await tree.root.findAllByType("button").find(b=>b.props.children==="Find PIN code")!.props.onClick();});
  return onChange;
}
it("a resolved PIN area enables saving without ticking entrance confirmation", async () => {
  vi.mocked(apiRequest).mockResolvedValue({locations:[{lat:12.95,lng:77.57,label:"Area"}]});
  const change=await search();
  expect(change).toHaveBeenLastCalledWith(expect.objectContaining({pincode:"560004",locationAccuracy:"pincode",lat:12.95,lng:77.57}));
  expect(JSON.stringify(tree.toJSON())).toContain("not a confirmed pickup entrance");
  await act(async () => {tree.root.findAllByType("input")[0].props.onChange({currentTarget:{value:"560005"}});});
  expect(change).toHaveBeenLastCalledWith(null);
});
it("ambiguous results require choosing an area instead of silently using the first", async () => {
  vi.mocked(apiRequest).mockResolvedValue({locations:[{lat:12,lng:77,label:"A"},{lat:13,lng:77,label:"B"}]});
  const change=await search();
  expect(change).toHaveBeenLastCalledWith(null);
  await act(async () => {tree.root.findAllByType("button").find(b=>b.props.children==="B")!.props.onClick();});
  expect(change).toHaveBeenLastCalledWith(expect.objectContaining({lat:13,locationAccuracy:"pincode"}));
});
it("invalid or unresolved PIN codes never produce an activatable point", async () => {
  const change=await search(vi.fn(),"123");
  expect(apiRequest).not.toHaveBeenCalled();
  expect(change).toHaveBeenLastCalledWith(null);
});
it("strict entrance workflows retain their confirmation requirement", async () => {
  vi.mocked(apiRequest).mockResolvedValue({locations:[{lat:12,lng:77,label:"A"}]});
  const change=await search(vi.fn(),"560004",false);
  expect(change).toHaveBeenLastCalledWith(null);
});
