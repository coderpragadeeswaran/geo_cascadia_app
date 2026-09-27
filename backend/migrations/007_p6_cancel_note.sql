-- P6 browser round (D35): cancelling a running job is a handshake (the worker stops at its next heartbeat or stage),
-- and the worker can leave a note for people ("continued from saved progress" / "started again from the beginning").
alter table jobs add column if not exists cancel_requested boolean not null default false;
alter table jobs add column if not exists note text;
