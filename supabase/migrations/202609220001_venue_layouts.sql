-- Venue layouts: the room arrangements each venue supports (SG2-43), so
-- layout requirements can be checked when a venue is chosen. Follows the
-- venues table's existing convention: no RLS, route-layer enforcement.
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

commit;
