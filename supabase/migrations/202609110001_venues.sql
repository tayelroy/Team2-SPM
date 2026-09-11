-- SG2-42: column definitions match the core schema captured on SG2-44.
-- Bootstrap only this table on branches where the core migration is not merged.
-- On the provisioned Supabase project, preserve existing rows and column types.
begin;
create table if not exists public.venues (
  venue_id serial primary key,
  name varchar(255) not null,
  location text,
  capacity integer,
  facilities text,
  accessibility_features text,
  operating_information text
);
alter table public.venues enable row level security;
alter table public.venues force row level security;
revoke all on public.venues from public, anon, authenticated;
grant select, insert, update on public.venues to authenticated;
grant usage on sequence public.venues_venue_id_seq to authenticated;
grant all on public.venues to service_role;
grant usage, select on sequence public.venues_venue_id_seq to service_role;

create policy venues_read on public.venues for select to authenticated using (
  exists (select 1 from public.account_roles where user_id = (select auth.uid()) and role in ('venue_staff', 'event_coordinator'))
);
create policy venues_create on public.venues for insert to authenticated with check (
  exists (select 1 from public.account_roles where user_id = (select auth.uid()) and role = 'venue_staff')
);
create policy venues_update on public.venues for update to authenticated using (
  exists (select 1 from public.account_roles where user_id = (select auth.uid()) and role = 'venue_staff')
) with check (
  exists (select 1 from public.account_roles where user_id = (select auth.uid()) and role = 'venue_staff')
);
commit;
