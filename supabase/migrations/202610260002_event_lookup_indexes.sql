-- SG2-96 (performance and scalability NFRs): index the per-event lookups on the
-- arrangement tables.
--
-- The safety check queue (safety_check_queue), the attendee list
-- (registrable_events_json), arrangement readiness and an event's own
-- arrangements all filter these tables by event_id alone. Until now only
-- partial (pending-only) or venue-first indexes existed, so every event in a
-- list scanned the whole table. On the year-3 data set in
-- docs/nfr-capacity-review.md the safety check queue took about 462 ms and the
-- attendee list about 227 ms for one user (median before these indexes).
--
-- Plain b-tree indexes only: no data, grant or behaviour change.
begin;

create index if not exists venue_bookings_event_idx on public.venue_bookings (event_id);
create index if not exists venue_booking_requests_event_idx on public.venue_booking_requests (event_id);
create index if not exists equipment_requests_event_idx on public.equipment_requests (event_id);
create index if not exists equipment_reservations_event_idx on public.equipment_reservations (event_id);

commit;
