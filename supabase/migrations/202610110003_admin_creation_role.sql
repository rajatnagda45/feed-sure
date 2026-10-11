-- Supabase's Admin create-user API may write app_metadata AFTER the Auth insert.
-- Complete only a new pending role request; never change an approved assignment.
begin;
create function public.feedsure_complete_user_creation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  requested text := new.raw_app_meta_data->>'feedsure_account_role';
begin
  if requested in ('kitchen', 'cbg', 'owner', 'admin')
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
revoke all on function public.feedsure_complete_user_creation() from public, anon, authenticated;
create trigger feedsure_complete_user_creation
after update of raw_app_meta_data on auth.users
for each row when (
  old.raw_app_meta_data->>'feedsure_account_role'
    is distinct from new.raw_app_meta_data->>'feedsure_account_role'
)
execute function public.feedsure_complete_user_creation();

-- Repair untouched pending Admin creations made before this migration.
select pg_catalog.pg_advisory_xact_lock(74290110);
update public.feedsure_accounts a
set role = u.raw_app_meta_data->>'feedsure_account_role', revision = a.revision + 1,
    generator_id = case when u.raw_app_meta_data->>'feedsure_account_role' = 'kitchen'
      then 'registered-' || replace(a.id::text, '-', '') else null end
from auth.users u
where a.id = u.id and a.status = 'PENDING' and a.revision = 1
  and u.raw_app_meta_data->>'feedsure_account_role' in ('kitchen', 'cbg', 'owner', 'admin')
  and u.raw_user_meta_data->'feedsure_registration'->>'role'
    = u.raw_app_meta_data->>'feedsure_account_role'
  and a.role is distinct from u.raw_app_meta_data->>'feedsure_account_role';
commit;
