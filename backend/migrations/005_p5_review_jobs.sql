-- P5 (D29): the photo uploaded WITH a decision is kept on its history row, so the history panel can show every appeal
-- photo (signed URLs only). ADD COLUMN is DDL: the append-only trigger (004) blocks row UPDATE/DELETE, not this.
alter table review_events add column if not exists photo text;

-- Jobs created by automated tests are marked, so "clear test jobs" can never remove a real analysis request.
alter table jobs add column if not exists is_test boolean not null default false;
