import { act, create, ReactTestRenderer } from "react-test-renderer";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthProvider, SessionGate, useAccount } from "./auth";
import { ApiError, apiRequest } from "./api";
const sdk = vi.hoisted(() => ({ emit: (_event: string, _session: { user: { id: string } } | null) => {}, signOut: vi.fn() }));
vi.mock("./api", async (original) => ({ ...await original<typeof import('./api')>(), apiRequest: vi.fn() }));
vi.mock("./supabase", () => ({ supabaseEnabled: true, accessToken: vi.fn(), supabase: { auth: {
  signOut: sdk.signOut, onAuthStateChange: (callback: typeof sdk.emit) => { sdk.emit = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; },
} } }));
let tree: ReactTestRenderer;
const text = () => JSON.stringify(tree.toJSON());
async function emit(id: string | null) {
  await act(async () => { sdk.emit(id ? "SIGNED_IN" : "SIGNED_OUT", id ? { user: { id } } : null); await new Promise((resolve) => setTimeout(resolve, 5)); });
}
function PrivateProfile() { const { userId } = useAccount(); return <p>Private profile for {userId}</p>; }
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubGlobal("sessionStorage", { removeItem: vi.fn() });
  sdk.signOut.mockImplementation(async () => { sdk.emit("SIGNED_OUT", null); return { error: null }; });
  await act(async () => { tree = create(<MemoryRouter><AuthProvider><SessionGate><PrivateProfile /></SessionGate></AuthProvider></MemoryRouter>); });
});
afterEach(() => { act(() => tree.unmount()); vi.unstubAllGlobals(); });
it("keeps sign-out available for a pending user whose dashboard verification fails", async () => {
  vi.mocked(apiRequest).mockRejectedValue(new ApiError(403, "ACCOUNT_PENDING", "Pending approval"));
  await emit("pending");
  expect(text()).toContain("Sign out"); expect(text()).toContain("Pending approval");
  await act(async () => { await tree.root.findByType("button").props.onClick(); });
  expect(text()).not.toContain("Private profile"); expect(text()).not.toContain("Account session");
});
it("clears private profile on cross-tab sign-out and never accepts a late verification", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ account: { id: "a", role: "ADMIN" } });
  await emit("a"); expect(text()).toContain("Private profile for");
  let finish: (value: unknown) => void = () => {};
  vi.mocked(apiRequest).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await emit("b"); await emit(null);
  await act(async () => { finish({ account: { id: "b", role: "ADMIN" } }); });
  expect(text()).not.toContain("Private profile"); expect(text()).not.toContain("My dashboard");
});
it("reports failed sign-out and offers retry without claiming success", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ account: { id: "a", role: "ADMIN" } });
  await emit("a"); sdk.signOut.mockResolvedValue({ error: new Error("Offline") });
  await act(async () => { await tree.root.findByType("button").props.onClick(); });
  expect(text()).toContain("Sign-out could not be confirmed"); expect(text()).toContain("Sign out");
});
