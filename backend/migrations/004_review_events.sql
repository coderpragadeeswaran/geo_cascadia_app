-- Review history (D24): one append-only row per decision or undo. Written by the same statement that changes
-- review_items, so the history can never miss a change made through the API. No foreign keys on purpose: the history
-- outlives items and areas; UPDATE and DELETE are refused by a trigger.
create table if not exists review_events (
  id                bigserial primary key,
  item_id           integer not null,               -- review_items.id
  area_id           integer not null,
  ref_id            text not null,                  -- buildings.id / assets.id
  action            text not null check (action in ('approve', 'reject', 'appeal', 'undo')),
  status            text not null,                  -- status after this event
  previous_status   text not null,                  -- status before (what an undo restores)
  previous_reviewer text,
  previous_note     text,
  previous_photo    text,
  reviewer          text,
  note              text,
  undoes            bigint,                         -- for action = 'undo': the event it reverted
  created_at        timestamptz not null default now()
);
create index if not exists review_events_item on review_events (item_id, id desc);
alter table review_events enable row level security;

create or replace function review_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'review_events is append-only';
end $$;
drop trigger if exists review_events_no_change on review_events;
create trigger review_events_no_change before update or delete on review_events
  for each row execute function review_events_append_only();
