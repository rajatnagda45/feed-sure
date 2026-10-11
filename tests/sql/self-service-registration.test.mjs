// Real migration/RPC checks in PostgreSQL WASM; hosted Auth is a separate service.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const uid = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sid = (n) => uid(n + 1000);
const registration = { role: "kitchen", organisation: "Synthetic hotel", contact: "Test contact",
  address: "Test pickup", profile: { lat: 12.68, lng: 77.47, type: "hotel" } };
const migration = () => readFile(new URL("../../supabase/migrations/20261011180000_self_service_registration.sql", import.meta.url), "utf8");
async function user(n, details = registration, trusted = {}) {
  await db.query(`insert into auth.users (id,email,raw_user_meta_data,raw_app_meta_data)
    values ($1,$2,$3,$4)`, [uid(n), `user${n}@example.test`, { feedsure_registration: details }, trusted]);
  await db.query(`insert into auth.sessions (id,user_id,created_at) values ($1,$2,clock_timestamp())`, [sid(n), uid(n)]);
}
async function rpc(n, action, target = null, revision = null, changes = {}) {
  const result = await db.query(`select public.feedsure_accounts_api($1,$2,$3,$4,$5,$6) as result`,
    [uid(n), sid(n), action, target === null ? null : uid(target), revision, changes]);
  return result.rows[0].result;
}

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb);
    create table auth.sessions (id uuid primary key, user_id uuid, created_at timestamptz);`);
  await user(1, {}, { feedsure_role: "ADMIN" });
  for (const file of ["202610110002_accounts.sql", "202610110003_admin_creation_role.sql", "20261011150000_user_flows.sql", "20261011170000_profile_completion.sql"])
    await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8"));
  await user(2);
  await user(3, { ...registration, role: "cbg", capacityKg: 1200 });
  await user(4, { ...registration, role: "owner", capacityKg: 1200 });
  await user(5, { ...registration, address: "" });
  await user(6); await rpc(1, "suspend", 6, 1);
  await user(7); await rpc(1, "delete", 7, 1);
  await user(8, { ...registration, role: "admin" }, { feedsure_account_role: "admin" });
  await user(9, { ...registration, role: "driver" }, { feedsure_account_role: "driver" });
  await user(60, { ...registration, address: "", profile: { type: "hotel" } });
  assert.equal((await rpc(60, "self_update", 60, 1, { address: registration.address, profile: registration.profile })).status, "PENDING");
  await db.exec(await migration());
});

test("profiles completed before the migration become active even when signup details were incomplete", async () => {
  const account = await rpc(60, "identity");
  assert.equal(account.status, "ACTIVE");
  assert.equal(account.revision, 3);
  assert.equal(account.generator_id, `registered-${uid(60).replaceAll("-", "")}`);
});

test("saving a complete profile activates access without Admin action or a new session", async () => {
  await user(61, { ...registration, address: "", profile: { type: "hotel" } });
  assert.equal((await rpc(61, "self_update", 61, 1, { contact: "Updated contact" })).status, "PENDING");
  const result = await rpc(61, "self_update", 61, 2, { address: registration.address, profile: registration.profile });
  assert.equal(result.status, "ACTIVE"); assert.equal(result.revision, 3);
  assert.equal(result.role, "kitchen");
  assert.equal((await rpc(61, "identity")).status, "ACTIVE");
  assert.equal((await rpc(61, "self_update", 61, 2, { contact: "Stale" })).status, 409);
  assert.equal((await rpc(61, "self_update", 60, 3, { contact: "Other user" })).status, 403);
  assert.equal((await rpc(61, "self_update", 61, 3, { role: "admin" })).status, 400);
  await rpc(1, "suspend", 61, 3);
  assert.equal((await rpc(61, "self_update", 61, 4, { contact: "Suspended" })).status, 401);
});

test("plant profiles activate automatically but managed privileged accounts do not", async () => {
  for (const [n, role] of [[62, "cbg"], [63, "owner"]]) {
    await user(n, { ...registration, role, address: "", capacityKg: 1000 });
    assert.equal((await rpc(n, "self_update", n, 1, { address: registration.address })).status, "ACTIVE");
  }
  for (const n of [8, 9]) {
    assert.equal((await rpc(n, "self_update", n, 1, { contact: "Complete managed profile" })).status, "PENDING");
  }
});
after(async () => { await db.close(); });

test("activates existing complete registrations without changing their scopes or profiles", async () => {
  for (const [n, role] of [[2, "kitchen"], [3, "cbg"], [4, "owner"]]) {
    const account = await rpc(n, "identity");
    assert.equal(account.status, "ACTIVE"); assert.equal(account.role, role); assert.equal(account.revision, 2);
    assert.equal(account.organisation, registration.organisation);
    assert.equal(account.address, registration.address);
    assert.deepEqual(account.profile, registration.profile);
    if (role === "kitchen") assert.equal(account.generator_id, `registered-${uid(n).replaceAll("-", "")}`);
  }
  assert.equal((await rpc(5, "identity")).status, "PENDING");
  assert.equal((await rpc(5, "list")).error,
    "Complete My profile to activate access automatically. No Admin approval is required.");
  for (const n of [6, 7]) assert.equal((await rpc(n, "identity")).status, 401);
  for (const n of [8, 9]) assert.equal((await rpc(n, "identity")).status, "PENDING");
});

test("new generator and plant accounts can operate immediately with their own role", async () => {
  await user(10); await user(11, { ...registration, role: "cbg", capacityKg: 1000 });
  await user(12, { ...registration, role: "owner", capacityKg: 1000 });
  for (const n of [10, 11, 12]) {
    const account = await rpc(n, "identity");
    assert.equal(account.status, "ACTIVE"); assert.equal(account.revision, 1);
    assert.equal((await rpc(n, "list")).status, 403);
  }
  assert.ok((await rpc(11, "sites")).accounts.some((a) => a.id === uid(10)));
  assert.equal((await rpc(10, "sites")).status, 403);
  assert.equal((await rpc(12, "sites")).status, 403);
});

test("public metadata cannot create Admin or driver access and delayed managed roles remain pending", async () => {
  await user(13, { ...registration, role: "admin" });
  await user(14, { ...registration, role: "driver" });
  for (const n of [13, 14]) {
    assert.equal((await rpc(n, "identity")).role, "kitchen");
    assert.equal((await rpc(n, "identity")).status, "PENDING");
  }
  await db.query("update auth.users set raw_app_meta_data=$1 where id=$2", [{ feedsure_account_role: "admin" }, uid(13)]);
  assert.equal((await rpc(13, "identity")).role, "admin");
  assert.equal((await rpc(13, "identity")).status, "PENDING");
  await user(15, { ...registration, feedsure_role: "ADMIN" });
  assert.equal((await rpc(15, "identity")).role, "kitchen");
  assert.equal((await rpc(15, "list")).status, 403);
});

test("incomplete and malformed pickup or plant details cannot become active", async () => {
  const invalid = [
    { ...registration, address: "  " }, { ...registration, contact: null },
    { ...registration, organisation: 123 },
    { ...registration, profile: { ...registration.profile, lat: 91 } },
    { ...registration, profile: { ...registration.profile, lng: -181 } },
    { ...registration, profile: { ...registration.profile, lat: "12.68" } },
    { ...registration, profile: { ...registration.profile, type: "unknown" } },
    { ...registration, role: "cbg", capacityKg: 0 },
    { ...registration, role: "owner", capacityKg: 1000000001 },
    { ...registration, role: "owner", capacityKg: "1000" },
  ];
  for (const [index, details] of invalid.entries()) {
    await user(30 + index, details);
    assert.equal((await rpc(30 + index, "identity")).status, "PENDING");
  }
});

test("editing signup metadata cannot rewrite an active role or location", async () => {
  const before = await rpc(10, "identity");
  await db.query("update auth.users set raw_user_meta_data=$1,raw_app_meta_data=$2 where id=$3", [
    { feedsure_registration: { ...registration, role: "admin" } }, { feedsure_account_role: "admin" }, uid(10),
  ]);
  assert.deepEqual(await rpc(10, "identity"), before);
});

test("migration replay preserves suspensions, deletions and active account revisions", async () => {
  await rpc(1, "suspend", 11, 1);
  const snapshot = () => db.query("select row_to_json(a) as account from public.feedsure_accounts a order by id");
  const before = (await snapshot()).rows;
  await db.exec(await migration());
  assert.deepEqual((await snapshot()).rows, before);
  assert.equal((await rpc(11, "identity")).status, 401);
  assert.equal((await rpc(7, "identity")).status, 401);
  // Future inserts still use the policy after a replay.
  await user(50); assert.equal((await rpc(50, "identity")).status, "ACTIVE");
});

test("readiness reports the installed policy without granting browser access to the registry", async () => {
  const policy = (await db.query("select public.feedsure_accounts_api(null,null,'registration') as result")).rows[0].result;
  assert.deepEqual(policy, { ready: true, requiresApproval: false });
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(db.query("select * from public.feedsure_accounts"), /permission denied/);
      await assert.rejects(db.query("select public.feedsure_accounts_api(null,null,'registration')"), /permission denied/);
      await assert.rejects(db.query("select public.feedsure_self_service_ready(null::public.feedsure_accounts)"), /permission denied/);
      await assert.rejects(db.query("select public.feedsure_accounts_workflow(null,null,'identity')"), /permission denied/);
    } finally { await db.exec("reset role"); }
  }
});
