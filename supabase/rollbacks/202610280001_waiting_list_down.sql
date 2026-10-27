-- Rollback for 202610280001_waiting_list.sql (SG2-61, SG2-62 AC6).
--
-- Unschedules the offer sweep, drops the waiting list and its functions, and
-- puts back the SG2-60/62/63 versions of the functions it replaced by
-- re-running those parts of their migrations: apply this file, then re-run
-- the create-or-replace statements for register_for_event,
-- withdraw_registration, update_registration_settings,
-- event_registration_overview and private.registrable_events_json from
-- 202610260003, 202610230001 and 202610200004 (newest first wins), so the
-- functions stop referring to the dropped table before it goes.
--
-- Not undone (data, not schema): who waited, was offered or lapsed is lost
-- with the table. `registration_full`, `waiting_list_offer` and
-- `waiting_list_offer_lapsed` stay allowed on notifications so notices
-- already sent remain valid. Rehearse it first inside BEGIN ... ROLLBACK on a
-- live database.
--
-- Not a migration: keep it out of supabase/migrations, where every file is
-- applied in order.
begin;

do $$
begin
  if exists(select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'waiting-list-offers';
  end if;
end;
$$;
drop function if exists public.join_waiting_list(integer);
drop function if exists public.leave_waiting_list(integer);
drop function if exists public.process_waiting_list_offers();
drop function if exists private.offer_waiting_places(integer);
drop function if exists private.places_held(integer, uuid);
drop function if exists private.waiting_entry_json(bigint);
drop function if exists private.waiting_position(bigint);
drop table if exists public.waiting_list_entries;
alter table public.events
  drop constraint if exists events_waiting_list_response_hours_range,
  drop column if exists waiting_list_response_hours;

commit;
