-- Status vocabulary for the Week 7 event lifecycle (SG2-100 Unit 1).
--
-- Four new statuses close two gaps: `unassigned` gives the assignment queue
-- (SG2-87/88/97) an indexable status instead of deriving it from
-- `status = 'submitted' and coordinator_id is null`; `awaiting_safety_check`,
-- `safety_rejected` and `preparation` give the Safety Officer gate
-- (SG2-91/92/93/94) somewhere to stand between Arrangements and Confirmed.
--
-- Postgres 12+ permits ALTER TYPE ... ADD VALUE inside a transaction as long
-- as the new value is not used before commit. Nothing here writes any of
-- these four values — no backfill, no seeding, no index predicate naming
-- them — so the whole migration stays in one transaction. The Unit 2
-- backfill that reads `unassigned` belongs in its own, later migration file.
begin;

alter type public.event_status add value if not exists 'unassigned';
alter type public.event_status add value if not exists 'awaiting_safety_check';
alter type public.event_status add value if not exists 'safety_rejected';
alter type public.event_status add value if not exists 'preparation';

commit;
