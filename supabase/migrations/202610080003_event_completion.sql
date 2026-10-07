-- SG2-100 AC4: an event that has been held is marked Completed by its
-- coordinator, and the record says who did it and when.
--
-- Mirrors the decided_by/decided_at pair from 202609250001 and its
-- events_decision_recorded_together constraint: who and when always travel
-- together, so a half-written completion cannot look like a valid one.
--
-- There is deliberately no events.ends_at column. "The event's end time" is
-- derived from max(venue_bookings.ends_at) over the event's confirmed
-- bookings — an event may need several venues, and the last booking ending
-- is the real "the event is over" signal. A stored copy would duplicate
-- booking data and drift the moment a booking is rescheduled.
begin;

alter table public.events
  add column if not exists completed_by uuid references public.users(user_id),
  add column if not exists completed_at timestamptz;

alter table public.events
  add constraint events_completion_recorded_together
  check ((completed_by is null) = (completed_at is null));

-- A completed event always carries its completion record, so the audit
-- question "who marked this done, and when?" can never be unanswerable.
alter table public.events
  add constraint events_completed_requires_record
  check (status <> 'completed' or completed_at is not null);

comment on column public.events.completed_by is
  'Coordinator who marked the event completed (SG2-100 AC4).';
comment on column public.events.completed_at is
  'When the event was marked completed (SG2-100 AC4).';

commit;
