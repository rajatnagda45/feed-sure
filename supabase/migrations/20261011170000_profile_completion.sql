-- Allow authenticated owners (including pending registrants) to complete their
-- profile without changing approval, role, login identity or assignments.
begin;
do $$ begin
 if to_regprocedure('public.feedsure_accounts_v2(uuid,uuid,text,uuid,integer,jsonb,uuid)') is null then
  alter function public.feedsure_accounts_api(uuid,uuid,text,uuid,integer,jsonb,uuid) rename to feedsure_accounts_v2;
 end if;
end; $$;
create or replace function public.feedsure_accounts_api(
 p_actor uuid, p_session uuid, p_action text, p_target uuid default null,
 p_revision integer default null, p_changes jsonb default '{}'::jsonb, p_ticket uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 actor jsonb; target public.feedsure_accounts; field_name text; profile_value jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(74290110);
 if p_action <> 'self_update' then
  return public.feedsure_accounts_v2(p_actor,p_session,p_action,p_target,p_revision,p_changes,p_ticket);
 end if;
 actor := public.feedsure_accounts_v2(p_actor,p_session,'identity');
 if actor ? 'error' then return actor; end if;
 if p_target is distinct from p_actor then
  return jsonb_build_object('error','You can edit only your own profile.','status',403);
 end if;
 select * into target from public.feedsure_accounts where id=p_actor;
 if target.revision is distinct from p_revision then
  return jsonb_build_object('error','Your profile changed. Reload the saved profile before retrying.','status',409);
 end if;
 if jsonb_typeof(p_changes) is distinct from 'object' then
  return jsonb_build_object('error','Profile details are required.','status',400);
 end if;
 if exists(select 1 from jsonb_object_keys(p_changes) k where k not in ('organisation','contact','address','profile','capacityKg')) then
  return jsonb_build_object('error','Only site and contact details can be updated here.','status',400);
 end if;
 foreach field_name in array array['organisation','contact','address'] loop
  if p_changes ? field_name and (jsonb_typeof(p_changes->field_name) is distinct from 'string'
   or length(btrim(p_changes->>field_name)) not between 1 and 200) then
   return jsonb_build_object('error','Enter valid site and contact details.','status',400);
  end if;
 end loop;
 profile_value := target.profile;
 if p_changes ? 'profile' then
  profile_value := p_changes->'profile';
  if target.role <> 'kitchen' or jsonb_typeof(profile_value) is distinct from 'object'
   or jsonb_typeof(profile_value->'lat') is distinct from 'number'
   or jsonb_typeof(profile_value->'lng') is distinct from 'number'
   or coalesce(profile_value->>'type','') not in ('hotel','hostel_mess','pg','restaurant','canteen') then
   return jsonb_build_object('error','Confirm a valid pickup entrance and generator type.','status',400);
  end if;
  if abs((profile_value->>'lat')::numeric)>90 or abs((profile_value->>'lng')::numeric)>180
   or exists(select 1 from jsonb_object_keys(profile_value) k where k not in ('lat','lng','type')) then
   return jsonb_build_object('error','Pickup location is invalid.','status',400);
  end if;
 elsif target.role='kitchen' and p_changes ? 'address' and p_changes->>'address' <> target.address then
  if target.status='ACTIVE' then
   return jsonb_build_object('error','Confirm the new pickup entrance when changing your address.','status',400);
  end if;
  -- A pending address correction must not retain an unrelated old confirmed pin.
  profile_value := target.profile - 'lat' - 'lng';
 end if;
 if p_changes ? 'capacityKg' then
  if target.role not in ('cbg','owner') or jsonb_typeof(p_changes->'capacityKg') is distinct from 'number' then
   return jsonb_build_object('error','Valid plant capacity is required.','status',400);
  end if;
  if (p_changes->>'capacityKg')::numeric <= 0 or (p_changes->>'capacityKg')::numeric > 1000000000 then
   return jsonb_build_object('error','Plant capacity is out of range.','status',400);
  end if;
 end if;
 update public.feedsure_accounts set
  organisation=coalesce(p_changes->>'organisation',organisation),
  contact=coalesce(p_changes->>'contact',contact),
  address=coalesce(p_changes->>'address',address), profile=profile_value,
  capacity_kg=case when p_changes ? 'capacityKg' then (p_changes->>'capacityKg')::numeric else capacity_kg end,
  revision=revision+1
 where id=p_actor returning * into target;
 return to_jsonb(target) - 'password_ticket' - 'revoked_at';
end; $$;
revoke all on function public.feedsure_accounts_api(uuid,uuid,text,uuid,integer,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.feedsure_accounts_api(uuid,uuid,text,uuid,integer,jsonb,uuid) to service_role;
commit;
