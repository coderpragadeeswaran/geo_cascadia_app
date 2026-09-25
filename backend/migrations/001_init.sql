-- GEO-CASCADIA schema (CLAUDE.md §6 + docs/DECISIONS.md). EPSG:4326, GiST indexes.
-- Idempotent: safe to run more than once. PostGIS lives in the `extensions` schema (D6).
-- Run with `python backend/migrate.py`, or paste into the Supabase SQL editor.

create extension if not exists postgis with schema extensions;
set search_path = public, extensions;

-- One row per analysed area. meta/dashboard/run_report are stored as-is; computed/consistency come from
-- backend/app/derived.py (D2: countable facts are computed from the records).
create table if not exists areas (
  id              serial primary key,
  slug            text not null unique,
  name            text not null,
  polygon         geometry(MultiPolygon, 4326),
  polygon_source  text,                 -- 'study_area' | 'streets_buffer_40m'
  bbox            geometry(Polygon, 4326),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  source_job_id   uuid,
  meta            jsonb not null,
  dashboard       jsonb not null,
  run_report      jsonb,
  computed        jsonb,
  consistency     jsonb
);

create table if not exists jobs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('street_click', 'polygon')),
  input        jsonb not null,
  status       text not null default 'queued'
               check (status in ('queued', 'running', 'done', 'failed', 'expired_token', 'no_street_view')),
  stage        text,
  done         integer,
  total        integer,
  message      text,
  area_id      integer references areas(id) on delete set null,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  heartbeat_at timestamptz,
  worker_id    text
);
create index if not exists jobs_status_created on jobs (status, created_at);

do $$ begin
  alter table areas add constraint areas_source_job_fk foreign key (source_job_id) references jobs(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists streets (
  area_id   integer not null references areas(id) on delete cascade,
  name      text not null,
  geom      geometry(MultiLineString, 4326),
  length_m  real,
  road_type text,
  kind      text,
  panos     integer,
  coverage  real,
  way_ids   bigint[],
  primary key (area_id, name)
);

create table if not exists buildings (
  area_id          integer not null references areas(id) on delete cascade,
  id               text not null,
  street           text,
  geom             geometry(Point, 4326) not null,
  footprint        geometry(Polygon, 4326),
  use              text,                -- null = not classified (shown explicitly, D9)
  use_route        text,
  floors           integer,
  floors_status    text,
  name             text,
  name_quality     text,
  name_route       text,
  google_confirmed boolean not null default false,
  match_status     text,
  severity         text,
  discrepancies    text[] not null default '{}',
  reasons          text[] not null default '{}',
  google_flags     text[] not null default '{}',
  attrs            jsonb,
  register         jsonb,               -- SYNTHETIC register (demo)
  evidence         jsonb,
  review_status    text,
  record           jsonb not null,      -- full export record (same shape the offline mode serves, D4)
  primary key (area_id, id)
);

create table if not exists assets (
  area_id         integer not null references areas(id) on delete cascade,
  id              text not null,
  type            text not null,
  street          text,
  geom            geometry(Point, 4326) not null,
  confidence      text,
  method          text,
  cameras_used    integer,
  uncertainty_m   real,
  register_status text,
  flags           text[] not null default '{}',
  evidence        jsonb,
  review_status   text,
  record          jsonb not null,
  primary key (area_id, id)
);

create table if not exists unmapped_businesses (
  area_id   integer not null references areas(id) on delete cascade,
  id        text not null,
  name      text,
  ocr_text  text,
  street    text,
  geom      geometry(Point, 4326) not null,   -- approximate position
  sightings integer,
  evidence  jsonb,
  record    jsonb not null,
  primary key (area_id, id)
);

create table if not exists streetlight_gaps (
  area_id      integer not null references areas(id) on delete cascade,
  id           text not null,
  street       text,
  geom         geometry(LineString, 4326) not null,
  length_m     real,
  interval_m   integer,
  poles_inside integer,
  gap_type     text,
  record       jsonb not null,
  primary key (area_id, id)
);

-- Register record with nothing detected nearby (D7). Register is SYNTHETIC.
create table if not exists missing_asset_records (
  area_id  integer not null references areas(id) on delete cascade,
  asset_no text not null,
  street   text,
  geom     geometry(Point, 4326) not null,
  why      text,
  primary key (area_id, asset_no)
);

create table if not exists review_items (
  id               serial primary key,
  area_id          integer not null references areas(id) on delete cascade,
  item_type        text not null check (item_type in ('building', 'asset')),
  ref_id           text not null,       -- buildings.id / assets.id (asset rows joined by lat/lon/type, D7)
  street           text,
  geom             geometry(Point, 4326),
  priority         integer,
  reasons          text[] not null default '{}',
  discrepancies    text[] not null default '{}',
  status           text not null default 'pending'
                   check (status in ('pending', 'approved', 'rejected', 'appealed')),
  reviewer         text,
  note             text,
  appeal_photo_url text,
  updated_at       timestamptz not null default now(),
  unique (area_id, item_type, ref_id)
);
create index if not exists review_items_area_status on review_items (area_id, status, priority);

create index if not exists areas_polygon_gix       on areas using gist (polygon);
create index if not exists streets_geom_gix        on streets using gist (geom);
create index if not exists buildings_geom_gix      on buildings using gist (geom);
create index if not exists buildings_footprint_gix on buildings using gist (footprint);
create index if not exists assets_geom_gix         on assets using gist (geom);
create index if not exists unmapped_geom_gix       on unmapped_businesses using gist (geom);
create index if not exists gaps_geom_gix           on streetlight_gaps using gist (geom);
create index if not exists missing_geom_gix        on missing_asset_records using gist (geom);
create index if not exists review_geom_gix         on review_items using gist (geom);
create index if not exists buildings_filters       on buildings (area_id, street, match_status, use);
create index if not exists assets_filters          on assets (area_id, street, type, register_status);

-- The backend connects as the table owner, which bypasses RLS. Enabling RLS with no policies blocks the
-- public anon/authenticated keys (Supabase auto-exposes the public schema via its REST API).
alter table areas                 enable row level security;
alter table jobs                  enable row level security;
alter table streets               enable row level security;
alter table buildings             enable row level security;
alter table assets                enable row level security;
alter table unmapped_businesses   enable row level security;
alter table streetlight_gaps      enable row level security;
alter table missing_asset_records enable row level security;
alter table review_items          enable row level security;
