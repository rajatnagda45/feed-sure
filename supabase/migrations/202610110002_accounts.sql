-- Run AFTER private_photos.sql. Browser roles cannot read or mutate this registry.
begin;
create table public.feedsure_accounts (
  id uuid primary key,
  email text not null,
  role text not null check (role in ('kitchen', 'cbg', 'owner', 'admin', 'driver')),
  status text not null default 'PENDING' check (status in ('PENDING', 'ACTIVE', 'SUSPENDED', 'DELETED')),
  revision integer not null default 1,
  organisation text not null default '',
  contact text not null default '',
  address text not null default '',
  profile jsonb not null default '{}'::jsonb,
  capacity_kg numeric,
  generator_id text,
  plan_key text,
  revoked_at timestamptz not null default '-infinity',
  password_ticket uuid,
  created_at timestamptz not null default now()
);
alter table public.feedsure_accounts enable row level security;
revoke all on public.feedsure_accounts from public, anon, authenticated;
grant all on public.feedsure_accounts to service_role;

-- Only trusted app_metadata imports an existing role as ACTIVE. Signup data is
-- a request for review, never a grant of access. Keep tombstones after Auth deletion.
create function public.feedsure_capture_user(u auth.users) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := coalesce(u.raw_user_meta_data->'feedsure_registration', '{}'::jsonb);
  m jsonb := coalesce(u.raw_app_meta_data, '{}'::jsonb);
  assigned text := m->>'feedsure_role';
  requested text := r->>'role';
  account_role text;
begin
  account_role := case assigned when 'ADMIN' then 'admin' when 'PLANT_OWNER' then 'owner'
    when 'GENERATOR' then 'kitchen' when 'DRIVER' then 'driver' else
    case when m->>'feedsure_account_role' = 'admin' then 'admin'
      when requested in ('kitchen', 'cbg', 'owner') then requested else 'kitchen' end end;
  insert into public.feedsure_accounts
    (id, email, role, status, organisation, contact, address, profile, capacity_kg, generator_id, plan_key)
  values (u.id, coalesce(u.email, ''), account_role,
    case when assigned in ('ADMIN', 'PLANT_OWNER', 'GENERATOR', 'DRIVER') then 'ACTIVE' else 'PENDING' end,
    left(coalesce(r->>'organisation', u.email, ''), 200),
    left(coalesce(r->>'contact', u.email, ''), 200), left(coalesce(r->>'address', ''), 200),
    case when jsonb_typeof(r->'profile') = 'object' then jsonb_build_object(
      'lat', case when jsonb_typeof(r->'profile'->'lat') = 'number' then r->'profile'->'lat' end,
      'lng', case when jsonb_typeof(r->'profile'->'lng') = 'number' then r->'profile'->'lng' end,
      'type', left(r->'profile'->>'type', 64)) else '{}'::jsonb end,
    case when jsonb_typeof(r->'capacityKg') = 'number' then (r->>'capacityKg')::numeric end,
    case when assigned = 'GENERATOR' then m->>'generator_id'
      when account_role = 'kitchen' then 'registered-' || replace(u.id::text, '-', '') end,
    case when assigned = 'DRIVER' then m->>'plan_key' end)
  on conflict (id) do nothing;
end;
$$;
create function public.feedsure_user_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform public.feedsure_capture_user(new); return new; end;
$$;
create trigger feedsure_user_created after insert on auth.users
for each row execute function public.feedsure_user_created();
select public.feedsure_capture_user(u) from auth.users u;

-- One serialized, revision-checked transaction protects approvals and the last
-- Admin. session_id is supplied only after the backend verifies the JWT with Auth.
create function public.feedsure_accounts_api(
  p_actor uuid, p_session uuid, p_action text, p_target uuid default null,
  p_revision integer default null, p_changes jsonb default '{}'::jsonb,
  p_ticket uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.feedsure_accounts;
  target public.feedsure_accounts;
  session_started timestamptz;
  result jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(74290110);
  -- Finishing a password operation uses a private one-time server receipt. A
  -- failed Auth request still finishes the receipt, allowing a fresh login/retry.
  if p_action = 'password_finish' then
    update public.feedsure_accounts set password_ticket = null, revoked_at = clock_timestamp()
      where id = p_target and password_ticket = p_ticket and p_ticket is not null
      returning * into target;
    if not found then return jsonb_build_object('error', 'Password operation expired.', 'status', 409); end if;
    return to_jsonb(target) - 'password_ticket' - 'revoked_at';
  end if;
  select * into actor from public.feedsure_accounts where id = p_actor;
  select created_at into session_started from auth.sessions where id = p_session and user_id = p_actor;
  if actor.id is null or session_started is null or session_started <= actor.revoked_at
    or actor.password_ticket is not null or actor.status in ('SUSPENDED', 'DELETED') then
    return jsonb_build_object('error', 'Account access ended. Sign in again.', 'status', 401);
  end if;
  if p_action = 'identity' then return to_jsonb(actor) - 'password_ticket' - 'revoked_at'; end if;
  if actor.status <> 'ACTIVE' then
    return jsonb_build_object('error', 'Your registration is pending Admin approval.', 'status', 403);
  end if;
  if p_action = 'list' then
    if actor.role <> 'admin' then return jsonb_build_object('error', 'Admin access required.', 'status', 403); end if;
    select coalesce(jsonb_agg(to_jsonb(a) - 'password_ticket' - 'revoked_at' order by created_at), '[]'::jsonb)
      into result from public.feedsure_accounts a where status <> 'DELETED';
    return jsonb_build_object('accounts', result);
  end if;
  select * into target from public.feedsure_accounts where id = p_target;
  if target.id is null or target.status = 'DELETED' then
    return jsonb_build_object('error', 'Account was not found.', 'status', 404);
  end if;
  if actor.role <> 'admin' and (p_target <> p_actor or p_action not in ('password', 'delete')) then
    return jsonb_build_object('error', 'Admin access required.', 'status', 403);
  end if;
  if p_action = 'inspect' then return to_jsonb(target) - 'password_ticket' - 'revoked_at'; end if;
  if target.revision is distinct from p_revision or target.password_ticket is not null then
    return jsonb_build_object('error', 'Account changed. Refresh before retrying.', 'status', 409);
  end if;
  if p_action in ('suspend', 'delete') and target.role = 'admin' and target.status = 'ACTIVE'
    and (select count(*) from public.feedsure_accounts where role = 'admin' and status = 'ACTIVE') <= 1 then
    return jsonb_build_object('error', 'Keep at least one active Admin.', 'status', 409);
  end if;
  if p_action = 'suspend' and p_target = p_actor then
    return jsonb_build_object('error', 'An Admin cannot suspend their own account.', 'status', 409);
  end if;
  if p_action not in ('activate', 'suspend', 'delete', 'update', 'password') then
    return jsonb_build_object('error', 'Unsupported account action.', 'status', 400);
  end if;
  update public.feedsure_accounts set
    status = case p_action when 'activate' then 'ACTIVE' when 'suspend' then 'SUSPENDED'
      when 'delete' then 'DELETED' else status end,
    revision = revision + 1,
    revoked_at = case when p_action = 'update' then revoked_at else clock_timestamp() end,
    password_ticket = case when p_action = 'password' then gen_random_uuid() else null end,
    organisation = case when p_action = 'delete' then '' when p_action = 'update' then coalesce(p_changes->>'organisation', organisation) else organisation end,
    contact = case when p_action = 'delete' then '' when p_action = 'update' then coalesce(p_changes->>'contact', contact) else contact end,
    address = case when p_action = 'delete' then '' when p_action = 'update' then coalesce(p_changes->>'address', address) else address end,
    email = case when p_action = 'delete' then '' else email end,
    profile = case when p_action = 'delete' then '{}'::jsonb else profile end,
    capacity_kg = case when p_action = 'delete' then null else capacity_kg end
    where id = p_target returning * into target;
  result := to_jsonb(target) - 'password_ticket' - 'revoked_at';
  if p_action = 'password' then result := result || jsonb_build_object('ticket', target.password_ticket); end if;
  return result;
end;
$$;

revoke all on function public.feedsure_capture_user(auth.users) from public, anon, authenticated;
revoke all on function public.feedsure_user_created() from public, anon, authenticated;
revoke all on function public.feedsure_accounts_api(uuid, uuid, text, uuid, integer, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.feedsure_accounts_api(uuid, uuid, text, uuid, integer, jsonb, uuid) to service_role;
commit;
