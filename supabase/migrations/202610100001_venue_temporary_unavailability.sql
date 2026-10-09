-- SG2-80 (Week 7 customer change #2): Venue Staff mark a venue temporarily
-- unavailable even when confirmed bookings already fall in the period. This
-- replaces SG2-45 AC2, which refused such a block.
--
-- A period is still a row in venue_unavailability, so venue search (SG2-46),
-- the availability calendar (SG2-44), approvals (SG2-49) and holds (SG2-84)
-- keep treating it as unavailable (AC5). Each period now records a reason
-- category and note (AC1) and who recorded it and when (AC6). Confirmed
-- bookings inside the period are flagged in venue_booking_disruptions (AC3);
-- neither the booking nor its event is changed (AC4).
begin;

-- AC2: a confirmed booking no longer stops a period being marked unavailable.
drop trigger venue_unavailability_refuse_confirmed_overlap on public.venue_unavailability;
drop function public.venue_unavailability_refuse_confirmed_overlap();

-- AC1: the reason is chosen from a fixed list; the existing reason column
-- holds the note. Periods recorded before SG2-80 are filed under 'other'.
-- AC6: who recorded the period and when; unknown for earlier periods.
alter table public.venue_unavailability
  add column category text not null default 'other'
    constraint venue_unavailability_category_check
    check (category in ('maintenance', 'equipment_failure', 'renovation', 'safety_concern', 'other')),
  add column created_by uuid references auth.users(id) on delete set null,
  add column created_at timestamptz;

-- AC6: the recorder and time come from the session, never from the caller,
-- and cannot be rewritten later. Taking the venue lock serialises a new
-- period with SG2-49 approvals and SG2-84 holds, which check unavailability
-- under the same lock, so a booking confirmed at the same moment is either
-- refused or seen and flagged below.
create function public.venue_unavailability_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.venues where venue_id = new.venue_id for update;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := clock_timestamp();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
revoke all on function public.venue_unavailability_stamp() from public, anon, authenticated;

create trigger venue_unavailability_stamp
  before insert or update on public.venue_unavailability
  for each row execute function public.venue_unavailability_stamp();

-- AC3: which confirmed bookings fall within which unavailable period. Rows
-- are written only by the triggers below; removing the period or the booking
-- removes the flag. AC4: nothing here touches events or venue_bookings.
create table public.venue_booking_disruptions (
  unavailability_id bigint not null references public.venue_unavailability(unavailability_id) on delete cascade,
  booking_id        bigint not null references public.venue_bookings(booking_id) on delete cascade,
  flagged_at        timestamptz not null default clock_timestamp(),
  primary key (unavailability_id, booking_id)
);
create index venue_booking_disruptions_booking_idx on public.venue_booking_disruptions (booking_id);

alter table public.venue_booking_disruptions enable row level security;
alter table public.venue_booking_disruptions force  row level security;
revoke all on table public.venue_booking_disruptions from public, anon, authenticated;
grant select on table public.venue_booking_disruptions to authenticated;
grant select, insert, update, delete on table public.venue_booking_disruptions to service_role;

-- The same internal roles that read venue_bookings and venue_unavailability.
create policy venue_booking_disruptions_read_internal on public.venue_booking_disruptions
  for select to authenticated
  using (exists (
    select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid())
      and ar.role in ('event_coordinator', 'venue_staff', 'technical_support_staff')
  ));

-- AC3: flag every confirmed booking overlapping a new or moved period.
-- Periods that only touch a booking (one ending as the other starts) do not
-- overlap.
create function public.venue_unavailability_flag_bookings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    delete from public.venue_booking_disruptions d
      where d.unavailability_id = new.unavailability_id
        and not exists (
          select 1 from public.venue_bookings b
          where b.booking_id = d.booking_id and b.venue_id = new.venue_id and b.status = 'confirmed'
            and b.starts_at < new.ends_at and b.ends_at > new.starts_at);
  end if;
  insert into public.venue_booking_disruptions (unavailability_id, booking_id)
    select new.unavailability_id, b.booking_id
    from public.venue_bookings b
    where b.venue_id = new.venue_id and b.status = 'confirmed'
      and b.starts_at < new.ends_at and b.ends_at > new.starts_at
    on conflict do nothing;
  return null;
end;
$$;
revoke all on function public.venue_unavailability_flag_bookings() from public, anon, authenticated;

create trigger venue_unavailability_flag_bookings
  after insert or update of venue_id, starts_at, ends_at on public.venue_unavailability
  for each row execute function public.venue_unavailability_flag_bookings();

-- AC3 backstop: a booking confirmed or moved into an unavailable period by
-- any path (a direct or service write) is flagged too; one that stops being
-- confirmed or moves out is no longer affected.
create function public.venue_booking_flag_disruptions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.venue_booking_disruptions d
    where d.booking_id = new.booking_id
      and not exists (
        select 1 from public.venue_unavailability u
        where u.unavailability_id = d.unavailability_id and new.status = 'confirmed'
          and u.venue_id = new.venue_id and u.starts_at < new.ends_at and u.ends_at > new.starts_at);
  if new.status = 'confirmed' then
    insert into public.venue_booking_disruptions (unavailability_id, booking_id)
      select u.unavailability_id, new.booking_id
      from public.venue_unavailability u
      where u.venue_id = new.venue_id and u.starts_at < new.ends_at and u.ends_at > new.starts_at
      on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke all on function public.venue_booking_flag_disruptions() from public, anon, authenticated;

create trigger venue_booking_flag_disruptions
  after insert or update of venue_id, starts_at, ends_at, status on public.venue_bookings
  for each row execute function public.venue_booking_flag_disruptions();

-- Flag any overlaps that already exist.
insert into public.venue_booking_disruptions (unavailability_id, booking_id)
  select u.unavailability_id, b.booking_id
  from public.venue_unavailability u
  join public.venue_bookings b on b.venue_id = u.venue_id and b.status = 'confirmed'
    and b.starts_at < u.ends_at and b.ends_at > u.starts_at
  on conflict do nothing;

-- AC3/AC5: affected bookings for the availability calendar, read with the
-- caller's own token (security invoker), so the same internal roles see it.
create view public.venue_affected_bookings with (security_invoker = true) as
  select b.booking_id, b.venue_id, b.event_id, b.starts_at, b.ends_at
  from public.venue_bookings b
  where exists (select 1 from public.venue_booking_disruptions d where d.booking_id = b.booking_id);
revoke all on public.venue_affected_bookings from public, anon, authenticated;
grant select on public.venue_affected_bookings to authenticated, service_role;

-- AC1/AC3/AC6: a venue's periods that have not ended by p_after, earliest
-- first, each with its reason, note, recorder and affected events. Venue
-- Staff do not read events or users directly, so this runs as definer and
-- checks the caller's role itself.
create function public.list_venue_unavailability(p_venue_id integer, p_after timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.account_roles ar where ar.user_id = auth.uid() and ar.role = 'venue_staff') then
    raise exception using errcode = '42501', message = 'Only Venue Staff can list venue unavailability.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'unavailability_id', u.unavailability_id,
        'starts_at', u.starts_at,
        'ends_at', u.ends_at,
        'category', u.category,
        'reason', u.reason,
        'created_at', u.created_at,
        'created_by_name', p.name,
        'affected', coalesce((
          select jsonb_agg(jsonb_build_object(
              'booking_id', b.booking_id,
              'event_id', b.event_id,
              'event_name', e.name,
              'event_status', e.status,
              'starts_at', b.starts_at,
              'ends_at', b.ends_at)
            order by b.starts_at, b.booking_id)
          from public.venue_booking_disruptions d
          join public.venue_bookings b on b.booking_id = d.booking_id
          left join public.events e on e.event_id = b.event_id
          where d.unavailability_id = u.unavailability_id), '[]'::jsonb))
      order by u.starts_at, u.unavailability_id)
    from public.venue_unavailability u
    left join public.users p on p.user_id = u.created_by
    where u.venue_id = p_venue_id and u.ends_at > p_after), '[]'::jsonb);
end;
$$;
revoke all on function public.list_venue_unavailability(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.list_venue_unavailability(integer, timestamptz) to authenticated;

commit;
