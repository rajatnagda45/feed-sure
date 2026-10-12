import { act, create } from "react-test-renderer";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { PlantPage } from "./PlantPage";
import { getOperations, getLatestPlan, saveReadiness, OperationsSnapshot } from "../api";
import { serviceDateInIndia } from "../workflow";
vi.mock("../auth", () => ({ useAccount: () => ({ account: {role:"ADMIN",accountRole:"admin"} }) }));
vi.mock("../api", async (original) => ({ ...await original<typeof import("../api")>(), getOperations:vi.fn(), getLatestPlan:vi.fn(), saveReadiness:vi.fn() }));
vi.mock("../components/RouteMap", () => ({RouteMap:()=>null}));
vi.mock("../components/HazardReview", () => ({HazardReview:()=>null}));
afterEach(() => {vi.unstubAllGlobals();vi.clearAllMocks();});

it("shows incomplete-save errors beside the form and changes UNCONFIRMED to READY on save", async () => {
  vi.stubGlobal("sessionStorage", {getItem:()=>null});
  let snapshot = {collectionDate:serviceDateInIndia(),inputRevision:1,depot:{lat:12,lng:77},defaults:{},serviceMode:{matrix:"fallback"},
    generators:[{generatorId:"site",name:"Test supplier",address:"Test",lat:12,lng:77,pickupWindow:{start:"06:00",end:"09:00"},
      readinessStatus:"UNCONFIRMED",readiness:null,unresolvedHazards:[],supportedMaterial:true}]} as unknown as OperationsSnapshot;
  vi.mocked(getOperations).mockImplementation(async()=>snapshot);
  vi.mocked(getLatestPlan).mockResolvedValue({plan:null});
  vi.mocked(saveReadiness).mockImplementation(async (request) => {
    const submission={...request,inputRevision:2,submissionId:"saved"} as never;
    snapshot={...snapshot,inputRevision:2,generators:[{...snapshot.generators[0],readiness:submission,readinessStatus:"READY"}]};
    return {submission,inputRevision:2};
  });
  let tree!:ReturnType<typeof create>;
  await act(async()=>{tree=create(<MemoryRouter><PlantPage/></MemoryRouter>);});
  try {
    await act(async()=>{tree.root.findAllByType("button").find(b=>b.props.children==="Record phone confirmation")!.props.onClick();});
    await act(async()=>{await tree.root.findByType("form").props.onSubmit({preventDefault:vi.fn()});});
    expect(saveReadiness).not.toHaveBeenCalled();
    expect(tree.root.findByProps({"aria-label":"Phone confirmation editor"}).findByProps({role:"alert"}).children.join("")).toContain("Selecting Ready alone");
    for (const [index,value] of [[0,"69.1"],[3,"Supervisor"],[4,"Confirmed by phone"]] as const) {
      await act(async()=>{tree.root.findByType("form").findAllByType("input")[index].props.onChange({currentTarget:{value}});});
    }
    await act(async()=>{await tree.root.findByType("form").props.onSubmit({preventDefault:vi.fn()});});
    expect(saveReadiness).toHaveBeenCalledWith(expect.objectContaining({status:"READY",confirmedKg:69.1,confirmedBy:"Supervisor"}),expect.anything());
    expect(tree.root.findAllByProps({className:"status-badge readiness-ready"})).toHaveLength(1);
    expect(tree.root.findAllByProps({className:"status-badge readiness-unconfirmed"})).toHaveLength(0);
  } finally {act(()=>tree.unmount());}
});
