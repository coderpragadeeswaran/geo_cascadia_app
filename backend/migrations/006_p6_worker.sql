-- P6 (D34): live analysis jobs.
-- "needs_approval": the worker planned the street and the estimated cost is above the job cost cap; nothing was bought
-- yet. The person approves (back to queued, approved = true) or cancels.
alter table jobs drop constraint if exists jobs_status_check;
alter table jobs add constraint jobs_status_check
  check (status in ('queued', 'running', 'done', 'failed', 'expired_token', 'no_street_view', 'needs_approval'));
alter table jobs add column if not exists approved boolean not null default false;   -- cost cap lifted by a person
alter table jobs add column if not exists estimate jsonb;                            -- the worker's plan-time estimate
alter table jobs add column if not exists device text;                               -- 'gpu' | 'cpu' of the worker that ran it
