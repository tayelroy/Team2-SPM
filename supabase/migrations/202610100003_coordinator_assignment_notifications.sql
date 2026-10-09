-- SG2-88 AC4: an assignment or reassignment notifies the newly assigned
-- Event Coordinator, any previous coordinator, and the event's organiser.
-- The server writes these with the service role after the assignment and
-- its history are committed; recipients read their own through the existing
-- row level security on public.notifications (SG2-49).
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in (
    'venue_request_approved', 'venue_request_rejected', 'venue_booking_released',
    'coordinator_assigned', 'coordinator_removed', 'event_coordinator_changed'
  ));
