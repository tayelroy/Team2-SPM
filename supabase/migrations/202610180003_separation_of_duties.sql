-- SG2-104 separation of duties for accounts that hold several roles.
--
-- (a) The Event Coordinator Lead never makes an event's own organiser its
--     coordinator, so nobody reviews, decides or confirms their own request.
--     server/src/events/assignCoordinator.ts refuses it first; this check is
--     the backstop for any other write. Single-role accounts could not reach
--     this state (an organiser was never a coordinator), and the block below
--     stops the migration loudly rather than hide any row that breaks it.
-- (b) Venue Staff never approve or reject a venue booking request they raised
--     themselves: decide_venue_booking_request() gains that check in
--     202610200001_acting_role_functions.sql, which builds on its latest body.
begin;

do $$
declare
  violations integer;
begin
  select count(*) into violations from public.events where coordinator_id = organiser_id;
  if violations > 0 then
    raise exception 'SG2-104: % event(s) have their organiser as coordinator; reassign them before applying this migration', violations;
  end if;
end $$;

alter table public.events
  add constraint events_coordinator_not_organiser
  check (coordinator_id is null or coordinator_id <> organiser_id);


commit;
