import { act, create, ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { LocationPicker } from "./LocationPicker";
import { ProfileDetails } from "./ProfileDetails";
import { Account, accountRequest } from "../accounts";
vi.mock("../accounts", () => ({ accountRequest: vi.fn() }));
vi.mock("./LocationPicker", () => ({ LocationPicker: () => <div>Location picker</div> }));
const account: Account = {id:"one",loginId:"test@example.test",role:"kitchen",status:"PENDING",revision:1,
  organisation:"Test site",contact:"Test contact",address:"Site address",profile:{type:"hotel"}};
let tree: ReactTestRenderer;
afterEach(() => { if (tree) act(() => tree.unmount()); vi.clearAllMocks(); });
it("saves pending contact details without inventing coordinates or changing access", async () => {
  const saved=vi.fn(); vi.mocked(accountRequest).mockResolvedValue({...account,revision:2});
  await act(async () => {tree=create(<ProfileDetails account={account} onSaved={saved}/>);});
  await act(async () => {await tree.root.findByType("form").props.onSubmit({preventDefault:vi.fn()});});
  expect(accountRequest).toHaveBeenCalledWith("/auth/account", {action:"update",expectedRevision:1,
    organisation:"Test site",contact:"Test contact",address:"Site address"});
  expect(saved).toHaveBeenCalledWith({...account,revision:2});
});
it("requires fresh location confirmation when an active user changes address", async () => {
  await act(async () => {tree=create(<ProfileDetails account={{...account,status:"ACTIVE",profile:{type:"hotel",lat:12,lng:77}}} onSaved={vi.fn()}/>);});
  await act(async () => {tree.root.findAllByType("input")[2].props.onChange({currentTarget:{value:"New address"}});});
  await act(async () => {await tree.root.findByType("form").props.onSubmit({preventDefault:vi.fn()});});
  expect(accountRequest).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).toContain("Confirm your pickup entrance");
});
it("preserves entries on a failed save and allows retry", async () => {
  vi.mocked(accountRequest).mockRejectedValue(new Error("Connection interrupted"));
  await act(async () => {tree=create(<ProfileDetails account={account} onSaved={vi.fn()}/>);});
  await act(async () => {await tree.root.findByType("form").props.onSubmit({preventDefault:vi.fn()});});
  expect(JSON.stringify(tree.toJSON())).toContain("Connection interrupted");
  expect(tree.root.findAllByType("input")[0].props.value).toBe("Test site");
  expect(tree.root.findByType("fieldset").props.disabled).toBe(false);
});

it("saves a resolved PIN area without claiming entrance confirmation", async () => {
  const saved=vi.fn(); vi.mocked(accountRequest).mockResolvedValue({...account,status:"ACTIVE",revision:2});
  await act(async () => {tree=create(<ProfileDetails account={account} onSaved={saved}/>);});
  await act(async () => {tree.root.findByType(LocationPicker).props.onChange({lat:12.95,lng:77.57,pincode:"560004",locationAccuracy:"pincode",label:"Postal area"});});
  await act(async () => {await tree.root.findByType("form").props.onSubmit({preventDefault:vi.fn()});});
  expect(accountRequest).toHaveBeenCalledWith("/auth/account", expect.objectContaining({profile:{lat:12.95,lng:77.57,type:"hotel",pincode:"560004",locationAccuracy:"pincode"}}));
});
it("preserves approximate precision when an active user saves other profile details", async () => {
  const profile={type:"hotel",lat:12.95,lng:77.57,pincode:"560004",locationAccuracy:"pincode" as const};
  vi.mocked(accountRequest).mockResolvedValue({...account,status:"ACTIVE",profile,revision:2});
  await act(async () => {tree=create(<ProfileDetails account={{...account,status:"ACTIVE",profile}} onSaved={vi.fn()}/>);});
  expect(JSON.stringify(tree.toJSON())).toContain("Approximate PIN-code area");
  expect(JSON.stringify(tree.toJSON())).not.toContain("Pickup entrance confirmed.");
  await act(async () => {await tree.root.findByType("form").props.onSubmit({preventDefault:vi.fn()});});
  expect(accountRequest).toHaveBeenCalledWith("/auth/account",expect.objectContaining({profile}));
});
