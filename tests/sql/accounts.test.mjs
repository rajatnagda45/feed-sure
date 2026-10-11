// Execute the shipped migration in PostgreSQL WASM. Auth tables are schema
// fixtures; these tests do not exercise hosted Supabase Auth or PostgREST.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sid = (n) => uid(n + 100);
async function user(n, metadata = {}, trusted = {}) {
  await db.query(`insert into auth.users (id,email,raw_user_meta_data,raw_app_meta_data)
    values ($1,$2,$3,$4)`, [uid(n), `user${n}@example.test`, metadata, trusted]);
  await db.query(`insert into auth.sessions (id,user_id,created_at) values ($1,$2,clock_timestamp())`, [sid(n), uid(n)]);
}
async function rpc(n, action, target = null, rev = null, changes = {}, ticket = null) {
  const result = await db.query(`select public.feedsure_accounts_api($1,$2,$3,$4,$5,$6,$7) as result`,
    [uid(n), sid(n), action, target === null ? null : uid(target), rev, changes, ticket]);
  return result.rows[0].result;
}
const registration = { role: "kitchen", organisation: "Test hotel", contact: "Test contact", address: "Test address",
  profile: { lat: 12.68, lng: 77.47, type: "hotel" } };

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb);
    create table auth.sessions (id uuid primary key, user_id uuid, created_at timestamptz);`);
  // Existing trusted assignments must migrate, including their generator scope.
  await user(1, {}, { feedsure_role: "ADMIN" });
  await user(2, {}, { feedsure_role: "GENERATOR", generator_id: "existing-hotel" });
  await db.exec(await readFile(new URL("../../supabase/migrations/202610110002_accounts.sql", import.meta.url), "utf8"));
  // Reproduce the hosted Admin API's insert, then trusted metadata update order.
  await user(20, { feedsure_registration: { ...registration, role: "admin" } });
  await db.query("update auth.users set raw_app_meta_data=$1 where id=$2",
    [{ feedsure_account_role: "admin" }, uid(20)]);
  await db.exec(await readFile(new URL("../../supabase/migrations/202610110003_admin_creation_role.sql", import.meta.url), "utf8"));
});
after(async () => { await db.close(); });

test("repairs untouched pending Admin API creations without activating them", async () => {
  const account = await rpc(20, "identity");
  assert.equal(account.role, "admin");
  assert.equal(account.status, "PENDING");
  assert.equal(account.revision, 2);
  assert.equal(account.generator_id, null);
  assert.equal((await rpc(20, "list")).status, 403);
});

test("captures delayed trusted Admin roles and ignores public metadata escalation", async () => {
  await user(21, { feedsure_registration: { ...registration, role: "admin" } });
  assert.equal((await rpc(21, "identity")).role, "kitchen");
  await db.query("update auth.users set raw_user_meta_data=$1 where id=$2",
    [{ feedsure_account_role: "admin", feedsure_registration: { ...registration, role: "admin" } }, uid(21)]);
  assert.equal((await rpc(21, "identity")).role, "kitchen");
  await db.query("update auth.users set raw_app_meta_data=$1 where id=$2",
    [{ feedsure_account_role: "admin" }, uid(21)]);
  const pending = await rpc(21, "identity");
  assert.equal(pending.role, "admin");
  assert.equal(pending.status, "PENDING");
  assert.equal(pending.revision, 2);
  assert.equal((await rpc(21, "list")).status, 403);
  await db.exec("set role authenticated");
  try {
    await assert.rejects(db.query("select public.feedsure_complete_user_creation()"), /permission denied/);
  } finally { await db.exec("reset role"); }
});

test("metadata updates cannot rewrite reviewed or activated assignments", async () => {
  await user(22, { feedsure_registration: { ...registration, role: "owner", capacityKg: 1000 } });
  await rpc(1, "update", 22, 1, { organisation: "Reviewed owner" });
  await db.query("update auth.users set raw_user_meta_data=$1, raw_app_meta_data=$2 where id=$3",
    [{ feedsure_registration: { ...registration, role: "admin" } }, { feedsure_account_role: "admin" }, uid(22)]);
  assert.equal((await rpc(22, "identity")).role, "owner");
  await rpc(1, "activate", 22, 2);
  await db.query("update auth.users set raw_app_meta_data=$1 where id=$2",
    [{ feedsure_account_role: "kitchen" }, uid(22)]);
  await db.query("update auth.sessions set created_at=clock_timestamp() where id=$1", [sid(22)]);
  assert.equal((await rpc(22, "identity")).role, "owner");
});

test("imports trusted assignments and ignores public Admin escalation", async () => {
  assert.equal((await rpc(1, "identity")).role, "admin");
  assert.equal((await rpc(2, "identity")).generator_id, "existing-hotel");
  await user(3, { feedsure_role: "ADMIN", feedsure_registration: { ...registration, role: "admin" } });
  const pending = await rpc(3, "identity");
  assert.equal(pending.role, "kitchen");
  assert.equal(pending.status, "PENDING");
  assert.equal((await rpc(3, "list")).status, 403);
  assert.match(pending.generator_id, /^registered-/);
});

test("browser roles cannot select, mutate, call RPC, or call capture helpers", async () => {
  const grants = await db.query(`select
    has_function_privilege('authenticated', 'public.feedsure_capture_user(auth.users)', 'EXECUTE') as capture,
    has_function_privilege('anon', 'public.feedsure_user_created()', 'EXECUTE') as trigger,
    has_function_privilege('service_role', 'public.feedsure_accounts_api(uuid,uuid,text,uuid,integer,jsonb,uuid)', 'EXECUTE') as backend`);
  assert.deepEqual(grants.rows[0], { capture: false, trigger: false, backend: true });
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(db.query("select * from public.feedsure_accounts"), /permission denied/);
      await assert.rejects(db.query("update public.feedsure_accounts set status='ACTIVE'"), /permission denied/);
      await assert.rejects(rpc(1, "list"), /permission denied/);
      await assert.rejects(db.query("select public.feedsure_capture_user(null::auth.users)"), /permission denied/);
    } finally { await db.exec("reset role"); }
  }
  await db.exec("set role service_role");
  try { assert.equal((await rpc(1, "identity")).role, "admin"); }
  finally { await db.exec("reset role"); }
});

test("approval checks revisions; CBG operators cannot manage accounts", async () => {
  await user(4, { feedsure_registration: { ...registration, role: "cbg", capacityKg: 1200 } });
  assert.equal((await rpc(1, "activate", 4, 1)).status, "ACTIVE");
  assert.equal((await rpc(1, "update", 4, 1, { organisation: "stale" })).status, 409);
  await db.query("update auth.sessions set created_at=clock_timestamp() where id=$1", [sid(4)]);
  assert.equal((await rpc(4, "list")).status, 403);
  assert.equal((await rpc(4, "activate", 3, 1)).status, 403);
  assert.equal((await rpc(4, "inspect", 1)).status, 403);
  assert.equal((await rpc(1, "activate", 3, 1)).revision, 2);
});

test("suspension/reactivation reject the same session after refreshed JWTs", async () => {
  await db.query("update auth.sessions set created_at=clock_timestamp() where id=$1", [sid(3)]);
  assert.equal((await rpc(3, "identity")).status, "ACTIVE");
  assert.equal((await rpc(1, "suspend", 3, 2)).status, "SUSPENDED");
  assert.equal((await rpc(3, "identity")).status, 401);
  assert.equal((await rpc(1, "activate", 3, 3)).status, "ACTIVE");
  assert.equal((await rpc(3, "identity")).status, 401);
  await db.query("update auth.sessions set created_at=clock_timestamp() where id=$1", [sid(3)]);
  assert.equal((await rpc(3, "identity")).status, "ACTIVE");
});

test("password receipt blocks concurrent mutations and revokes sessions on finish", async () => {
  const begin = await rpc(1, "password", 3, 4);
  assert.ok(begin.ticket);
  assert.equal((await rpc(3, "identity")).status, 401);
  assert.equal((await rpc(1, "delete", 3, 5)).status, 409);
  assert.equal((await rpc(1, "password_finish", 3, null, {}, uid(999))).status, 409);
  const end = await rpc(1, "password_finish", 3, null, {}, begin.ticket);
  assert.equal(end.revision, 5);
  assert.equal(end.password_ticket, undefined);
  assert.equal((await rpc(1, "password_finish", 3, null, {}, begin.ticket)).status, 409);
  assert.equal((await rpc(3, "identity")).status, 401);
});

test("last Admin protection and deletion scrub the profile while retaining linkage", async () => {
  assert.equal((await rpc(1, "delete", 1, 1)).status, 409);
  assert.equal((await rpc(1, "suspend", 1, 1)).status, 409);
  const deleted = await rpc(1, "delete", 3, 5);
  assert.equal(deleted.status, "DELETED");
  assert.equal(deleted.email, "");
  assert.equal(deleted.contact, "");
  assert.deepEqual(deleted.profile, {});
  assert.ok(deleted.generator_id);
  await db.query("delete from auth.users where id=$1", [uid(3)]);
  assert.equal((await db.query("select status from public.feedsure_accounts where id=$1", [uid(3)])).rows[0].status, "DELETED");
  assert.equal((await rpc(3, "identity")).status, 401);
  assert.equal((await rpc(1, "list")).accounts.some((a) => a.id === uid(3)), false);
});

test("signout is enforced by checking that the Auth session still exists", async () => {
  await db.query("delete from auth.sessions where id=$1", [sid(2)]);
  assert.equal((await rpc(2, "identity")).status, 401);
});
