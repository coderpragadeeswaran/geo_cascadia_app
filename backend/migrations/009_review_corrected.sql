-- ui-polish-2 (D59): a reviewer's corrected value ("Actual floors: 2", a use, a sign name) saved WITH the decision.
-- It never overwrites the AI's value or the register; it is shown as "Reviewer says: …". Additive and nullable, so every
-- existing item and history row stays valid (null = no correction). review_events keeps the value before and after each
-- event, so an undo restores it exactly (the append-only trigger only refuses UPDATE / DELETE of rows, not new columns).
alter table review_items add column if not exists corrected jsonb;
alter table review_events add column if not exists corrected jsonb;
alter table review_events add column if not exists previous_corrected jsonb;
