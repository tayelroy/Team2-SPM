-- Venue layouts: the room arrangements each venue supports (SG2-43), so
-- layout requirements can be checked when a venue is chosen. Row level
-- security mirrors the route permissions (venues.layouts.read/update):
-- Venue Staff and Event Coordinators read, only Venue Staff write. The
-- server accesses this table with the caller's own bearer token (see
-- server/src/db/venueLayouts.ts), so policies -- not just route checks --
-- must enforce this.
begin;

create type public.venue_layout as enum (
  'classroom', 'theatre', 'boardroom', 'banquet', 'exhibition', 'other'
);

create table public.venue_layouts (
  venue_id          integer not null references public.venues(venue_id) on delete cascade,
  layout            public.venue_layout not null,
  other_description text,
  primary key (venue_id, layout),
  constraint venue_layouts_other_description_consistency
    check (
      (layout = 'other' and other_description is not null)
      or (layout <> 'other' and other_description is null)
    )
);

alter table public.venue_layouts enable row level security;
alter table public.venue_layouts force  row level security;

revoke all on table public.venue_layouts from public, anon, authenticated;
grant select, insert, delete on table public.venue_layouts to authenticated;
grant select, insert, update, delete on table public.venue_layouts to service_role;

create policy venue_layouts_read on public.venue_layouts
  for select to authenticated
  using (exists (
    select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid())
      and ar.role in ('venue_staff', 'event_coordinator')
  ));

-- Only Venue Staff record layouts. The store replaces a venue's complete set
-- with a delete then an insert (server/src/db/venueLayouts.ts), so writers
-- need both grants; there is no update policy since the store never issues one.
create policy venue_layouts_insert on public.venue_layouts
  for insert to authenticated
  with check (exists (
    select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid())
      and ar.role = 'venue_staff'
  ));

create policy venue_layouts_delete on public.venue_layouts
  for delete to authenticated
  using (exists (
    select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid())
      and ar.role = 'venue_staff'
  ));

commit;
