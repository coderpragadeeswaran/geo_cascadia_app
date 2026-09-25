-- D13: street lines carry the pipeline's display name (joins the records) + the raw OSM label;
-- streetlight gaps carry their map display (along-road path / "check" flag, computed by app/streetgeo.py).
alter table streets          add column if not exists osm_name text;
alter table streetlight_gaps add column if not exists display  jsonb;
