-- D53: OpenStreetMap roads / buildings / shop points and Microsoft building footprints for the covered cities, loaded
-- once by tools/import_osm_local.py and refreshed monthly. Inside a city box the street click, the cost planner and the
-- worker's area stage read these tables instead of Overpass / the Microsoft tile download (backend/app/mapdata.py).
-- Features are kept whole when they touch the box (not cut at its edge). EPSG:4326; a GiST index on every geometry.

create table if not exists map_cities (
  city          text primary key,                  -- coimbatore / trichy / tiruppur / madurai
  name          text not null,                     -- display name
  box           geometry(Polygon, 4326) not null,  -- the covered box (city boundary + margin)
  box_source    text,                              -- where the box comes from
  osm_snapshot  timestamptz,                       -- the Geofabrik extract's replication timestamp
  ms_release    date,                              -- the Microsoft tiles' upload date (dataset-links.csv)
  counts        jsonb,                             -- rows loaded per table
  loaded_at     timestamptz not null default now()
);

create table if not exists osm_roads (
  way_id   bigint primary key,
  city     text not null,
  highway  text not null,
  name     text,
  bridge   text,
  tunnel   text,
  geom     geometry(LineString, 4326) not null
);

-- one row per outline, with the pipeline's own ids: w<way id>, or r<relation id>_<member index> for each outer member
create table if not exists osm_buildings (
  id       text primary key,
  city     text not null,
  geom     geometry(Polygon, 4326) not null
);

-- shop / amenity / office points (the pipeline uses them to call a street commercial); ways as their centre
create table if not exists osm_pois (
  osm_type char(1) not null,                       -- n = node, w = way
  osm_id   bigint not null,
  city     text not null,
  geom     geometry(Point, 4326) not null,
  primary key (osm_type, osm_id)
);

create table if not exists ms_buildings (
  id       bigserial primary key,
  city     text not null,
  geom     geometry(Polygon, 4326) not null
);

create index if not exists map_cities_box_gix   on map_cities using gist (box);
create index if not exists osm_roads_geom_gix    on osm_roads using gist (geom);
create index if not exists osm_roads_name        on osm_roads (name);
create index if not exists osm_buildings_geom_gix on osm_buildings using gist (geom);
create index if not exists osm_pois_geom_gix     on osm_pois using gist (geom);
create index if not exists ms_buildings_geom_gix on ms_buildings using gist (geom);

alter table map_cities    enable row level security;
alter table osm_roads     enable row level security;
alter table osm_buildings enable row level security;
alter table osm_pois      enable row level security;
alter table ms_buildings  enable row level security;
