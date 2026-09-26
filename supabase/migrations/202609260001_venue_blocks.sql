-- Venue blocks: Venue Staff mark a venue unusable for a period (SG2-45) by
-- writing to venue_unavailability, which SG2-44 created read-only. Row level
-- security mirrors the route permission (venues.blocks.manage): only Venue
-- Staff insert or delete. The server writes with the caller's own bearer token
-- (see server/src/db/venueBlocks.ts), so policies -- not just route checks --
-- must enforce this.
begin;

grant insert, delete on table public.venue_unavailability to authenticated;
grant usage on sequence public.venue_unavailability_unavailability_id_seq to authenticated;

create policy venue_unavailability_insert_staff on public.venue_unavailability
  for insert to authenticated
  with check (exists (
    select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid())
      and ar.role = 'venue_staff'
  ));

create policy venue_unavailability_delete_staff on public.venue_unavailability
  for delete to authenticated
  using (exists (
    select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid())
      and ar.role = 'venue_staff'
  ));

-- A period already holding a confirmed booking cannot be blocked. The server
-- checks first so it can name the conflicting booking; this trigger is the
-- backstop for direct PostgREST writes. It runs as definer so the check does
-- not depend on what the caller may read from venue_bookings.
create function public.venue_unavailability_refuse_confirmed_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.venue_bookings b
    where b.venue_id = new.venue_id
      and b.status = 'confirmed'
      and b.starts_at < new.ends_at
      and b.ends_at > new.starts_at
  ) then
    raise exception using
      errcode = '23P01',
      message = 'The period overlaps a confirmed booking for this venue.';
  end if;
  return new;
end;
$$;
revoke all on function public.venue_unavailability_refuse_confirmed_overlap() from public, anon, authenticated;

create trigger venue_unavailability_refuse_confirmed_overlap
  before insert or update on public.venue_unavailability
  for each row execute function public.venue_unavailability_refuse_confirmed_overlap();

commit;
