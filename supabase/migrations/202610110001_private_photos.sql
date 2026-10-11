-- Dedicated private bucket. No browser CRUD policies are granted: the API checks
-- verified role and supplier scope before minting a single-object capability.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedsure-photos', 'feedsure-photos', false, 3500000,
        array['image/jpeg', 'image/png'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
