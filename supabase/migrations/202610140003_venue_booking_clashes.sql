-- SG2-79 (Week 7 customer change #1): flag existing bookings that conflict
-- once setup and turnaround time apply.
--
-- SG2-78 made a booking occupy its venue from setup before it starts until
-- turnaround after it ends, and refuses new commitments that would clash. But
-- bookings made before a venue's times were introduced or raised can already
-- sit closer together than setup plus turnaround. Those pairs are flagged here
-- (AC1) and never cancelled, removed or altered (AC2). The routes show each
-- flag to Venue Staff and to the coordinator of each affected event (AC3), the
-- coordinator of each affected event is told when a flag appears (AC4), and a
-- flag clears as soon as its bookings no longer clash: one is moved or
-- released, or the venue's times change (AC5).
begin;

-- One row per clashing pair of confirmed bookings at a venue, stored once
-- (lower booking id first). Removing either booking removes the flag.
create table public.venue_booking_clashes (
  booking_id       bigint not null references public.venue_bookings(booking_id) on delete cascade,
  other_booking_id bigint not null references public.venue_bookings(booking_id) on delete cascade,
  venue_id         integer not null references public.venues(venue_id) on delete cascade,
  flagged_at       timestamptz not null default clock_timestamp(),
  primary key (booking_id, other_booking_id),
  constraint venue_booking_clashes_ordered check (booking_id < other_booking_id)
);
create index venue_booking_clashes_venue_idx on public.venue_booking_clashes (venue_id);
create index venue_booking_clashes_other_idx on public.venue_booking_clashes (other_booking_id);

-- Server only: the API shows each caller only the flags the routes allow.
alter table public.venue_booking_clashes enable row level security;
alter table public.venue_booking_clashes force  row level security;
revoke all on table public.venue_booking_clashes from public, anon, authenticated;
grant select, insert, update, delete on table public.venue_booking_clashes to service_role;

-- AC4: clash notices share the notifications table (SG2-49, SG2-51, SG2-55).
alter table public.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check check (kind in
    ('venue_request_approved', 'venue_request_rejected', 'venue_booking_released', 'equipment_reserved', 'venue_booking_clash'));

-- Rebuild one venue's flags. Runs under the venue lock every booking, block
-- and hold write takes, so a booking committed at the same moment is seen.
create function public.refresh_venue_booking_clashes(p_venue_id integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  gap interval;
begin
  if p_venue_id is null then return; end if;
  perform 1 from public.venues where venue_id = p_venue_id for update;
  if not found then return; end if;
  gap := public.venue_preparation_gap(p_venue_id);

  -- AC5: a flag clears once its bookings no longer clash.
  delete from public.venue_booking_clashes c
    where c.venue_id = p_venue_id
      and not exists (
        select 1 from public.venue_bookings a, public.venue_bookings b
        where a.booking_id = c.booking_id and b.booking_id = c.other_booking_id
          and a.venue_id = p_venue_id and b.venue_id = p_venue_id
          and a.status = 'confirmed' and b.status = 'confirmed'
          and a.starts_at < b.ends_at + gap and a.ends_at > b.starts_at - gap);

  -- AC1: flag every pair of confirmed bookings closer together than setup
  -- plus turnaround. AC4: tell the coordinator of each affected event about
  -- a new flag, naming the other event only when it is also theirs (as
  -- SG2-50 shows conflicts). Flags that already existed are not repeated.
  with flagged as (
    insert into public.venue_booking_clashes (booking_id, other_booking_id, venue_id)
      select a.booking_id, b.booking_id, p_venue_id
      from public.venue_bookings a
      join public.venue_bookings b on b.venue_id = a.venue_id and b.booking_id > a.booking_id
      where a.venue_id = p_venue_id and a.status = 'confirmed' and b.status = 'confirmed'
        and a.starts_at < b.ends_at + gap and a.ends_at > b.starts_at - gap
    on conflict do nothing
    returning booking_id, other_booking_id
  ), sides as (
    select f.booking_id as own_id, f.other_booking_id as other_id from flagged f
    union all
    select f.other_booking_id, f.booking_id from flagged f
  )
  insert into public.notifications (recipient_id, event_id, kind, message)
    select oe.coordinator_id, oe.event_id, 'venue_booking_clash',
      v.name || ': ' || coalesce(nullif(oe.name, ''), 'Untitled event') || ' ('
        || to_char(own.starts_at at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI') || ' – '
        || to_char(own.ends_at at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI') || ' SGT) now clashes with '
        || case when xe.coordinator_id = oe.coordinator_id then coalesce(nullif(xe.name, ''), 'Untitled event') else 'another event' end
        || ' (' || to_char(other.starts_at at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI') || ' – '
        || to_char(other.ends_at at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI')
        || ' SGT) once setup and turnaround time are included. Neither booking has been changed.'
    from sides s
    join public.venue_bookings own on own.booking_id = s.own_id
    join public.venue_bookings other on other.booking_id = s.other_id
    join public.events oe on oe.event_id = own.event_id
    left join public.events xe on xe.event_id = other.event_id
    join public.venues v on v.venue_id = own.venue_id
    where oe.coordinator_id is not null;
end;
$$;
revoke all on function public.refresh_venue_booking_clashes(integer) from public, anon, authenticated;

-- AC1/AC5: introducing or changing a venue's times re-checks its bookings.
create function public.venue_operations_refresh_clashes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_venue_booking_clashes(new.venue_id);
  return null;
end;
$$;
revoke all on function public.venue_operations_refresh_clashes() from public, anon, authenticated;
create trigger venue_operations_refresh_clashes
  after insert or update of setup_minutes, turnaround_minutes on public.venue_operations
  for each row execute function public.venue_operations_refresh_clashes();

-- AC5: a booking committed, moved or released re-checks its venue, and the
-- venue it left if it moved.
create function public.venue_bookings_refresh_clashes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_venue_booking_clashes(new.venue_id);
  if tg_op = 'UPDATE' and old.venue_id is distinct from new.venue_id then
    perform public.refresh_venue_booking_clashes(old.venue_id);
  end if;
  return null;
end;
$$;
revoke all on function public.venue_bookings_refresh_clashes() from public, anon, authenticated;
create trigger venue_bookings_refresh_clashes
  after insert or update of venue_id, starts_at, ends_at, status on public.venue_bookings
  for each row execute function public.venue_bookings_refresh_clashes();

-- Flag any clashes that already exist where times were recorded before this.
select public.refresh_venue_booking_clashes(venue_id) from public.venues;

commit;
