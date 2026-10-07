-- SG2-87: record when an event request was submitted, so the Event
-- Coordinator Lead's unassigned queue can show and order by it.
-- Written by the server on every submission (a resubmission restamps it).
-- Requests submitted before this column existed keep NULL and are shown as
-- "Not recorded"; no reliable earlier source exists to backfill from.
alter table public.events
  add column if not exists submitted_at timestamptz;

comment on column public.events.submitted_at is
  'When the request was last submitted for review (SG2-87). NULL for requests submitted before this column existed.';

-- The queue reads submitted, unassigned requests oldest first.
create index if not exists events_unassigned_queue_idx
  on public.events (submitted_at, event_id)
  where status = 'submitted' and coordinator_id is null;
