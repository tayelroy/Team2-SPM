-- SG2-104 AC6: reading an event's change history needs a relationship to
-- that event, not just an internal role. Before this, every internal role
-- read every event's history straight from the table.
--
-- event_relationship_exists() mirrors server/src/events/eventRelationship.ts
-- (which also gates GET /stage and GET /history); the two must change
-- together. It only answers for a role the caller holds, so nobody can probe
-- another account's relationships with it:
--   event_organiser          organises the event
--   event_coordinator        is its coordinator now (reassignment revokes it)
--   event_coordinator_lead   the event has been submitted (it is not a draft)
--   venue_staff              the event has a venue booking request or booking
--   technical_support_staff  the event has an equipment request or reservation
--   safety_officer           the event is at, or past, its safety check
--   attendee                 never
-- It deliberately does not read event_audit_logs, whose policy calls it.
--
-- The read policy below lets a caller read an entry when one role they hold
-- has a relationship to the event and, for the internal-only fields
-- (INTERNAL_ONLY_AUDIT_FIELDS in server/src/auth/policy.ts), that role is
-- internal (INTERNAL_ROLES). A coordinator who also organises an event sees
-- it only as its organiser, so never its planning notes.
begin;

create function public.event_relationship_exists(p_event_id integer, p_role text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.events e
    join public.account_roles ar on ar.user_id = (select auth.uid()) and ar.role = p_role
    where e.event_id = p_event_id
      and case p_role
        when 'event_organiser' then e.organiser_id = ar.user_id
        when 'event_coordinator' then e.coordinator_id = ar.user_id
        when 'event_coordinator_lead' then e.status <> 'draft'
        when 'venue_staff' then
          exists (select 1 from public.venue_booking_requests q where q.event_id = e.event_id)
          or exists (select 1 from public.venue_bookings b where b.event_id = e.event_id)
        when 'technical_support_staff' then
          exists (select 1 from public.equipment_requests q where q.event_id = e.event_id)
          or exists (select 1 from public.equipment_reservations x where x.event_id = e.event_id)
        when 'safety_officer' then
          e.status in ('awaiting_safety_check', 'safety_rejected', 'preparation', 'confirmed', 'completed')
        else false
      end
  );
$$;

revoke all on function public.event_relationship_exists(integer, text) from public, anon;
grant execute on function public.event_relationship_exists(integer, text) to authenticated, service_role;

drop policy if exists event_audit_logs_read on public.event_audit_logs;
create policy event_audit_logs_read on public.event_audit_logs
  for select to authenticated
  using (
    exists (
      select 1 from public.account_roles ar
      where ar.user_id = (select auth.uid())
        and public.event_relationship_exists(event_audit_logs.event_id, ar.role)
        and (
          ar.role in ('event_coordinator', 'venue_staff', 'technical_support_staff',
            'event_coordinator_lead', 'safety_officer')
          or event_audit_logs.field_name <> all (array['planning_notes'])
        )
    )
  );

commit;
