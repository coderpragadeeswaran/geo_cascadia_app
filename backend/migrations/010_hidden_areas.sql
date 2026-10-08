-- D64: an area can be HIDDEN — left out of the area list (and so of every page that lists areas: switcher, Trust,
-- Under the Hood's comparison, reports' area lists, the street picker's "already analysed"), but still served by its own
-- address (/areas/{slug}) for checks. Set by the loader from a hidden.json marker in the area folder: a re-run waiting
-- for the owner's approval, or a backup kept after a switch.
alter table areas add column if not exists hidden boolean not null default false;
