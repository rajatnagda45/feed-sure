-- Dedicated import tables for the upcoming Supabase adapter, separate from live operations.
create table if not exists public.feedsure_demo_generators (
    generator_id text primary key check (generator_id ~ '^demo-kitchen-[0-9]{2}$'),
    name text not null,
    venue_name text not null,
    type text not null,
    address text not null,
    lat double precision not null check (lat between -90 and 90),
    lng double precision not null check (lng between -180 and 180),
    location_source jsonb not null check (location_source->>'provider' = 'OpenStreetMap'),
    verification jsonb not null,
    simulated boolean not null check (simulated)
);

create table if not exists public.feedsure_demo_readiness (
    generator_id text not null references public.feedsure_demo_generators(generator_id),
    collection_date date not null,
    status text not null check (status in ('READY', 'NOT_READY', 'UNCONFIRMED')),
    confirmed_kg numeric,
    weight_source text,
    window_start time,
    window_end time,
    reason text,
    simulated boolean not null check (simulated),
    quantity_source text not null check (quantity_source = 'SIMULATED'),
    primary key (generator_id, collection_date),
    check (
        (status = 'READY' and confirmed_kg is not null and confirmed_kg > 0
         and weight_source = 'ESTIMATE' and weight_source is not null
         and window_start is not null and window_end is not null and window_start < window_end)
        or (status = 'NOT_READY' and confirmed_kg is not null and confirmed_kg = 0
            and weight_source is null and window_start is null and window_end is null)
        or (status = 'UNCONFIRMED' and confirmed_kg is null and weight_source is null
            and window_start is null and window_end is null)
    )
);

create table if not exists public.feedsure_demo_history (
    generator_id text not null references public.feedsure_demo_generators(generator_id),
    date date not null,
    kg numeric not null check (kg >= 0),
    simulated boolean not null check (simulated),
    quantity_source text not null check (quantity_source = 'SIMULATED'),
    primary key (generator_id, date)
);

alter table public.feedsure_demo_generators enable row level security;
alter table public.feedsure_demo_readiness enable row level security;
alter table public.feedsure_demo_history enable row level security;
revoke all on public.feedsure_demo_generators, public.feedsure_demo_readiness,
    public.feedsure_demo_history from anon, authenticated;
grant select, insert on public.feedsure_demo_generators, public.feedsure_demo_readiness,
    public.feedsure_demo_history to service_role;

comment on table public.feedsure_demo_generators is
    'OSM-derived venue references, ODbL-1.0. No verified supplier enrolment or pickup entrance.';
comment on table public.feedsure_demo_readiness is
    'Synthetic demo states only; quantities are not measured business waste.';
comment on table public.feedsure_demo_history is
    'Synthetic demo history only; quantities are not measured business waste.';
