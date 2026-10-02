-- SG2-47: a booking request for a venue too small for the event's expected
-- attendance needs a capacity exception before it can be approved. Venue
-- Staff, Technical Support Staff or the event's own Event Organiser approve
-- one; the approver and their role are recorded against the booking request.
-- Approving an exception never approves the booking itself: the request's
-- status is left for Venue Staff to decide (SG2-49).
--
-- Each approval covers the attendance it was given for. If attendance later
-- rises above that, a further approval is needed, so earlier rows are kept as
-- history rather than replaced.
begin;

create table public.venue_capacity_exceptions (
  exception_id bigserial primary key,
  request_id bigint not null references public.venue_booking_requests(request_id) on delete cascade,
  approved_by uuid not null references public.users(user_id),
  approver_role text not null
    check (approver_role in ('venue_staff', 'technical_support_staff', 'event_organiser')),
  expected_attendance integer not null check (expected_attendance > 0),
  venue_capacity integer,
  approved_at timestamptz not null default now()
);
-- Two approvers acting at once must not both record the same approval: the
-- second insert fails here and the API reports it as already approved.
create unique index venue_capacity_exceptions_request_attendance_idx
  on public.venue_capacity_exceptions (request_id, expected_attendance);

-- Like venue_booking_requests, only the server writes or reads these, after
-- checking the caller's role and their relationship to the event. A recorded
-- approval is never edited or removed, except with its booking request.
alter table public.venue_capacity_exceptions enable row level security;
alter table public.venue_capacity_exceptions force row level security;
revoke all on public.venue_capacity_exceptions from public, anon, authenticated, service_role;
revoke all on sequence public.venue_capacity_exceptions_exception_id_seq from public, anon, authenticated, service_role;
grant select, insert on public.venue_capacity_exceptions to service_role;
grant usage, select on sequence public.venue_capacity_exceptions_exception_id_seq to service_role;

commit;
