-- Rollback for 202610260001_event_change_requests.sql (SG2-64).
--
-- Drops raise_event_change_request and event_change_requests, so the
-- migration can be applied again later.
--
-- Not undone (data, not schema): every raised change request is lost with
-- the table. Accepted ones are still in the event's history, which records
-- each accepted change as "change request <id>". Rehearse it first inside
-- BEGIN ... ROLLBACK on a live database.
--
-- Not a migration: keep it out of supabase/migrations, where every file is
-- applied in order.
begin;

drop function if exists public.raise_event_change_request(integer, uuid, text, jsonb, text);
drop table if exists public.event_change_requests;

commit;
