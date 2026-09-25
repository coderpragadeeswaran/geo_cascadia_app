-- Keep export.json order so the API returns rows in the same order from the DB and from the JSON files (D4).
alter table streets               add column if not exists ord integer;
alter table buildings             add column if not exists ord integer;
alter table assets                add column if not exists ord integer;
alter table unmapped_businesses   add column if not exists ord integer;
alter table streetlight_gaps      add column if not exists ord integer;
alter table missing_asset_records add column if not exists ord integer;
alter table review_items          add column if not exists ord integer;

-- real (float32) turns 0.97 into 0.9700000286; use double precision so DB values equal the JSON values.
alter table streets          alter column length_m      type double precision;
alter table streets          alter column coverage      type double precision;
alter table assets           alter column uncertainty_m type double precision;
alter table streetlight_gaps alter column length_m      type double precision;
