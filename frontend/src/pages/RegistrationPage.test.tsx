import { act, create, ReactTestRenderer } from "react-test-renderer";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { RegistrationPage } from "./RegistrationPage";
import { registerAccount } from "../accounts";
vi.mock("../auth", () => ({useAccount: () => ({userId:"new-user"})}));
vi.mock("../supabase", () => ({supabase:{}}));
vi.mock("../api", async (original) => ({...await original<typeof import('../api')>(),apiRequest:vi.fn().mockResolvedValue({ready:true,emailConfirmationRequired:false})}));
vi.mock("../accounts", async (original) => ({...await original<typeof import('../accounts')>(),registerAccount:vi.fn().mockResolvedValue(undefined)}));
it("submits registration without address or GPS and offers profile completion", async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {tree=create(<MemoryRouter><RegistrationPage /></MemoryRouter>);});
  try {
    const values=["Test site","Test contact","","signup@example.test","long-test-password","long-test-password"];
    for (let i=0;i<values.length;i++) {
      await act(async () => {tree.root.findAllByType("input")[i].props.onChange({currentTarget:{value:values[i]}});});
    }
    expect(tree.root.findAllByType("input")[2].props.required).toBe(false);
    expect(JSON.stringify(tree.toJSON())).not.toContain("Find PIN code");
    await act(async () => {await tree.root.findByType("form").props.onSubmit({preventDefault:vi.fn()});});
    expect(registerAccount).toHaveBeenCalledWith(expect.objectContaining({email:"signup@example.test",address:"",type:"hotel"}),false);
    expect(vi.mocked(registerAccount).mock.calls[0][0]).not.toHaveProperty("lat");
    expect(JSON.stringify(tree.toJSON())).toContain("Complete my profile");
    expect(JSON.stringify(tree.toJSON())).toContain('"href":"/account"');
  } finally {act(() => tree.unmount());}
});
