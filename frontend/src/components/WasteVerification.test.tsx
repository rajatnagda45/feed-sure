import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { WasteVerification } from "./WasteVerification";
import { apiRequest } from "../api";
import { PhotoRecord } from "../photoApi";
vi.mock("../api", () => ({ apiRequest: vi.fn(), createIdempotencyKey: () => "review-key" }));

it("requires a human check and reason and retains reviewer attribution", async () => {
  const review = { decision: "VERIFIED", reason: "Checked on site", actor: {id:"reviewer"}, recordedAt:"2026-10-12" };
  vi.mocked(apiRequest).mockResolvedValue({submission:{photoReview:review}});
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree=create(<WasteVerification record={{submissionId:"s",photoRevision:2} as PhotoRecord} token="private" onSaved={vi.fn()} />); });
  try {
    expect(tree.root.findAllByType("button")[0].props.disabled).toBe(true);
    await act(async () => { tree.root.findAllByType("input")[0].props.onChange({currentTarget:{checked:true}}); tree.root.findAllByType("input")[1].props.onChange({currentTarget:{value:"Checked on site"}}); });
    await act(async () => { tree.root.findAllByType("button")[0].props.onClick(); });
    expect(apiRequest).toHaveBeenCalledWith("/submissions/s/review", expect.objectContaining({body:JSON.stringify({decision:"VERIFIED",reason:"Checked on site",evidenceChecked:true,expectedPhotoRevision:2})}));
    expect(JSON.stringify(tree.toJSON())).toContain("reviewer");
  } finally { act(() => tree.unmount()); }
});

it("does not offer verification for an unrelated image", async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree=create(<WasteVerification record={{analysis:{observations:{image_quality:"not_waste"}}} as PhotoRecord} token="private" onSaved={vi.fn()} />); });
  try { expect(tree.root.findAllByType("button")[0].props.disabled).toBe(true); expect(JSON.stringify(tree.toJSON())).toContain("Replace this unrelated image"); }
  finally { act(() => tree.unmount()); }
});
