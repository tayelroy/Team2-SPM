-- Venue availability: bookings and recorded unavailability for a venue over
-- time, plus the foreign key that closes events.venue_booking_id. Supports
-- SG2-44 "View venue availability": internal scheduling roles read a venue's
-- occupied periods across a date range; Attendees and Event Organisers cannot.
begin;

create table public.venue_bookings (
  booking_id bigserial primary key,
  venue_id   integer not null references public.venues(venue_id) on delete cascade,
  event_id   integer references public.events(event_id) on delete set null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  status     text not null check (status in ('held', 'confirmed')),
  constraint venue_bookings_time_order check (ends_at > starts_at)
);
create index venue_bookings_venue_time_idx
  on public.venue_bookings (venue_id, starts_at, ends_at);

create table public.venue_unavailability (
  unavailability_id bigserial primary key,
  venue_id  integer not null references public.venues(venue_id) on delete cascade,
  starts_at timestamptz not null,
  ends_at   timestamptz not null,
  reason    text not null,
  constraint venue_unavailability_time_order check (ends_at > starts_at)
);
create index venue_unavailability_venue_time_idx
  on public.venue_unavailability (venue_id, starts_at, ends_at);

-- Close the dangling column from the baseline schema now that its target exists.
alter table public.events
  add constraint events_venue_booking_id_fkey
  foreign key (venue_booking_id) references public.venue_bookings(booking_id)
  on delete set null;

-- Row level security. Reads are limited to internal scheduling roles; writes
-- go through privileged server operations using the service role.
alter table public.venue_bookings       enable row level security;
alter table public.venue_bookings       force  row level security;
alter table public.venue_unavailability enable row level security;
alter table public.venue_unavailability force  row level security;

revoke all on table public.venue_bookings       from public, anon, authenticated;
revoke all on table public.venue_unavailability from public, anon, authenticated;
grant select on table public.venue_bookings       to authenticated;
grant select on table public.venue_unavailability to authenticated;
grant select, insert, update, delete on table public.venue_bookings       to service_role;
grant select, insert, update, delete on table public.venue_unavailability to service_role;

create policy venue_bookings_read_internal on public.venue_bookings
  for select to authenticated
  using (exists (
    select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid())
      and ar.role in ('event_coordinator', 'venue_staff', 'technical_support_staff')
  ));

create policy venue_unavailability_read_internal on public.venue_unavailability
  for select to authenticated
  using (exists (
    select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid())
      and ar.role in ('event_coordinator', 'venue_staff', 'technical_support_staff')
  ));

commit;
