-- Create these test users in Authentication > Users first. Replace the email
-- placeholders below. Run in your own project's SQL editor (not a migration).
-- Auth role stays "authenticated"; FeedSure permission is in app_metadata.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || '{"feedsure_role":"GENERATOR","generator_id":"demo-kitchen-01"}'::jsonb
where email = 'YOUR_SUPPLIER_EMAIL';

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || '{"feedsure_role":"ADMIN"}'::jsonb
where email = 'YOUR_DISPATCHER_EMAIL';

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || '{"feedsure_role":"PLANT_OWNER"}'::jsonb
where email = 'YOUR_PLANT_OWNER_EMAIL';
