-- Rollback for 202610270001_change_request_decisions.sql (SG2-65).
--
-- Drops decide_event_change_request and the decision columns, so the
-- migration can be applied again later.
--
-- Not undone (data, not schema): who decided each request, when, and why a
-- refusal was given are lost with the columns, and decided requests keep
-- their accepted/refused status. The event history still records each
-- decision. `change_accepted` and `change_refused` stay allowed on
-- notifications so notices already sent remain valid. Rehearse it first
-- inside BEGIN ... ROLLBACK on a live database.
--
-- Not a migration: keep it out of supabase/migrations, where every file is
-- applied in order.
begin;

drop function if exists public.decide_event_change_request(integer, bigint, uuid, text, text, text);
alter table public.event_change_requests
  drop constraint if exists event_change_requests_refusal_reason,
  drop constraint if exists event_change_requests_decision_recorded,
  drop column if exists decision_reason,
  drop column if exists decided_at,
  drop column if exists decided_by;

commit;
