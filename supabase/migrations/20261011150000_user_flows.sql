-- Extend the existing registry without trusting public role metadata.
begin;
create or replace function public.feedsure_capture_user(u auth.users) returns void
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
  on conflict (id) do nothing;
end;
$$;
create or replace function public.feedsure_complete_user_creation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  requested text := new.raw_app_meta_data->>'feedsure_account_role';
begin
  if requested in ('kitchen', 'cbg', 'owner', 'admin', 'driver')
    and new.raw_user_meta_data->'feedsure_registration'->>'role' = requested then
    perform pg_catalog.pg_advisory_xact_lock(74290110);
    update public.feedsure_accounts
      set role = requested, revision = revision + 1,
          generator_id = case when requested = 'kitchen'
            then 'registered-' || replace(new.id::text, '-', '') else null end
      where id = new.id and status = 'PENDING' and revision = 1
        and role is distinct from requested;
  end if;
  return new;
end;
$$;

-- Permit a migration runner to replay SQL previously applied in the dashboard.
do $$
begin
 if to_regprocedure('public.feedsure_accounts_v1(uuid,uuid,text,uuid,integer,jsonb,uuid)') is null then
  alter function public.feedsure_accounts_api(uuid, uuid, text, uuid, integer, jsonb, uuid) rename to feedsure_accounts_v1;
 end if;
end;
$$;
create or replace function public.feedsure_accounts_api(
 p_actor uuid, p_session uuid, p_action text, p_target uuid default null,
 p_revision integer default null, p_changes jsonb default '{}'::jsonb, p_ticket uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 actor jsonb; result jsonb; target public.feedsure_accounts;
begin
 perform pg_catalog.pg_advisory_xact_lock(74290110);
 if p_action in ('drivers', 'assign_driver', 'sites') then
  actor := public.feedsure_accounts_v1(p_actor,p_session,'identity');
  if actor ? 'error' then return actor; end if;
  if actor->>'status' <> 'ACTIVE' or actor->>'role' not in ('admin','cbg') then
   return jsonb_build_object('error','Dispatcher access required.','status',403);
  end if;
  if p_action = 'sites' then
   select jsonb_build_object('accounts', coalesce(jsonb_agg(to_jsonb(a) - 'password_ticket' - 'revoked_at'), '[]'::jsonb)) into result
    from public.feedsure_accounts a where role='kitchen' and status='ACTIVE';
   return result;
  end if;
  if p_action = 'drivers' then
   select jsonb_build_object('drivers', coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'organisation',organisation,'revision',revision,'planKey',plan_key) order by organisation), '[]'::jsonb))
    into result from public.feedsure_accounts where role='driver' and status='ACTIVE';
   return result;
  end if;
  select * into target from public.feedsure_accounts where id=p_target and role='driver' and status='ACTIVE';
  if target.id is null then return jsonb_build_object('error','Active driver was not found.','status',404); end if;
  if target.revision is distinct from p_revision then return jsonb_build_object('error','Driver assignment changed. Refresh and retry.','status',409); end if;
  if coalesce(p_changes->>'planKey','') !~ '^\d{4}-\d{2}-\d{2}#p-[a-zA-Z0-9-]{1,64}$' then
   return jsonb_build_object('error','Dispatched trip is required.','status',400);
  end if;
  -- One assigned driver for this trip. Old driver access fails the next scope check.
  update public.feedsure_accounts set plan_key=null, revision=revision+1
   where role='driver' and plan_key=p_changes->>'planKey' and id<>p_target;
  update public.feedsure_accounts set plan_key=p_changes->>'planKey', revision=revision+1
   where id=p_target returning * into target;
  return to_jsonb(target) - 'password_ticket' - 'revoked_at';
 end if;
 if p_action='update' and (p_changes ? 'profile' or p_changes ? 'capacityKg') then
  actor := public.feedsure_accounts_v1(p_actor,p_session,'identity');
  if actor ? 'error' then return actor; end if;
  if actor->>'role' <> 'admin' or actor->>'status' <> 'ACTIVE' then
   return jsonb_build_object('error','Admin access required.','status',403);
  end if;
  select * into target from public.feedsure_accounts where id=p_target;
  if p_changes ? 'profile' and (target.role <> 'kitchen'
   or jsonb_typeof(p_changes->'profile'->'lat') is distinct from 'number'
   or jsonb_typeof(p_changes->'profile'->'lng') is distinct from 'number'
   or coalesce(p_changes->'profile'->>'type','') not in ('hotel','hostel_mess','pg','restaurant','canteen')) then
   return jsonb_build_object('error','Valid pickup coordinates and type are required.','status',400);
  end if;
  if p_changes ? 'profile' and (abs((p_changes->'profile'->>'lat')::numeric)>90 or abs((p_changes->'profile'->>'lng')::numeric)>180) then
   return jsonb_build_object('error','Pickup coordinates are out of range.','status',400);
  end if;
  if p_changes ? 'capacityKg' then
   if target.role not in ('cbg','owner') or jsonb_typeof(p_changes->'capacityKg') is distinct from 'number' then
    return jsonb_build_object('error','Valid plant capacity is required.','status',400);
   end if;
   if (p_changes->>'capacityKg')::numeric <= 0 or (p_changes->>'capacityKg')::numeric > 1000000000 then
    return jsonb_build_object('error','Plant capacity is out of range.','status',400);
   end if;
  end if;
 end if;
 result := public.feedsure_accounts_v1(p_actor,p_session,p_action,p_target,p_revision,p_changes,p_ticket);
 if result ? 'error' then return result; end if;
 if p_action='update' then
  update public.feedsure_accounts set
   profile=case when p_changes ? 'profile' then p_changes->'profile' else profile end,
   capacity_kg=case when p_changes ? 'capacityKg' then (p_changes->>'capacityKg')::numeric else capacity_kg end
   where id=p_target returning * into target;
  return to_jsonb(target) - 'password_ticket' - 'revoked_at';
 end if;
 return result;
end;
$$;
revoke all on function public.feedsure_accounts_api(uuid,uuid,text,uuid,integer,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.feedsure_accounts_api(uuid,uuid,text,uuid,integer,jsonb,uuid) to service_role;
commit;
