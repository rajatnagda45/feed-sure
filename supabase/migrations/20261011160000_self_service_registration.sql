-- Apply after user_flows.sql. Complete public registrations need no Admin approval.
-- Supabase Confirm email is a separate Auth setting; disable it for password-only signup.
begin;
create or replace function public.feedsure_self_service_ready(a public.feedsure_accounts)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if a.role not in ('kitchen', 'cbg', 'owner')
    or coalesce(btrim(a.organisation), '') = ''
    or coalesce(btrim(a.contact), '') = ''
    or coalesce(btrim(a.address), '') = '' then return false; end if;
  if a.role = 'kitchen' then
    if jsonb_typeof(a.profile->'lat') is distinct from 'number'
      or jsonb_typeof(a.profile->'lng') is distinct from 'number'
      or coalesce(a.profile->>'type', '') not in ('hotel','hostel_mess','pg','restaurant','canteen')
      or a.generator_id is distinct from 'registered-' || replace(a.id::text, '-', '') then
      return false;
    end if;
    return abs((a.profile->>'lat')::numeric) <= 90
      and abs((a.profile->>'lng')::numeric) <= 180;
  end if;
  return coalesce(a.capacity_kg > 0 and a.capacity_kg <= 1000000000, false);
end;
$$;

create or replace function public.feedsure_capture_user(u auth.users) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := coalesce(u.raw_user_meta_data->'feedsure_registration', '{}'::jsonb);
  m jsonb := coalesce(u.raw_app_meta_data, '{}'::jsonb);
  assigned text := m->>'feedsure_role';
  requested text := r->>'role';
  account_role text;
  account public.feedsure_accounts;
begin
  account_role := case assigned when 'ADMIN' then 'admin' when 'PLANT_OWNER' then 'owner'
    when 'GENERATOR' then 'kitchen' when 'DRIVER' then 'driver' else
    case when m->>'feedsure_account_role' in ('admin', 'driver') then m->>'feedsure_account_role'
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
  on conflict (id) do nothing returning * into account;
  if found and account.status = 'PENDING' and requested = account.role
    and jsonb_typeof(r->'organisation') = 'string'
    and jsonb_typeof(r->'contact') = 'string'
    and jsonb_typeof(r->'address') = 'string'
    and public.feedsure_self_service_ready(account) then
    update public.feedsure_accounts set status = 'ACTIVE' where id = account.id;
  end if;
end;
$$;

-- Activate existing complete registrations, preserving their identity and profiles.
-- Never reactivate suspended/deleted users or grant public Admin/driver access.
select pg_catalog.pg_advisory_xact_lock(74290110);
update public.feedsure_accounts a set status = 'ACTIVE', revision = a.revision + 1
from auth.users u
where a.id = u.id and a.status = 'PENDING'
  and u.raw_user_meta_data->'feedsure_registration'->>'role' = a.role
  and jsonb_typeof(u.raw_user_meta_data->'feedsure_registration'->'organisation') = 'string'
  and jsonb_typeof(u.raw_user_meta_data->'feedsure_registration'->'contact') = 'string'
  and jsonb_typeof(u.raw_user_meta_data->'feedsure_registration'->'address') = 'string'
  and public.feedsure_self_service_ready(a);

-- Version the existing workflow RPC once so this migration can be replayed safely.
do $$
begin
  if to_regprocedure('public.feedsure_accounts_workflow(uuid,uuid,text,uuid,integer,jsonb,uuid)') is null then
    alter function public.feedsure_accounts_api(uuid,uuid,text,uuid,integer,jsonb,uuid)
      rename to feedsure_accounts_workflow;
  end if;
end;
$$;
create or replace function public.feedsure_accounts_api(
  p_actor uuid, p_session uuid, p_action text, p_target uuid default null,
  p_revision integer default null, p_changes jsonb default '{}'::jsonb,
  p_ticket uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_action = 'registration' then
    return jsonb_build_object('ready', true, 'requiresApproval', false);
  end if;
  return public.feedsure_accounts_workflow(
    p_actor,p_session,p_action,p_target,p_revision,p_changes,p_ticket);
end;
$$;
revoke all on function public.feedsure_self_service_ready(public.feedsure_accounts) from public, anon, authenticated;
revoke all on function public.feedsure_capture_user(auth.users) from public, anon, authenticated;
revoke all on function public.feedsure_accounts_api(uuid,uuid,text,uuid,integer,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.feedsure_accounts_api(uuid,uuid,text,uuid,integer,jsonb,uuid) to service_role;
commit;
