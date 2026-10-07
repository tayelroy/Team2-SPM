-- Restore the legacy table boundary on projects whose provisioned schema
-- predates the committed policies. Service-owned records still use the API;
-- caller-scoped venue stores retain their existing read/write role split.
begin;

alter table public.users enable row level security;
alter table public.users force row level security;
alter table public.events enable row level security;
alter table public.events force row level security;
alter table public.venues enable row level security;
alter table public.venues force row level security;
alter table public.roles enable row level security;
alter table public.roles force row level security;
alter table public.registrations enable row level security;
alter table public.registrations force row level security;
alter table public.equipment_reservations enable row level security;
alter table public.equipment_reservations force row level security;

revoke all on table public.users, public.events, public.venues, public.roles,
  public.registrations, public.equipment_reservations from public, anon, authenticated;
-- A table-level REVOKE does not remove pre-existing column grants. Clear
-- those too, including additional deployed profile/event columns, before
-- restoring the intended narrow grants below. The table set is fixed.
do $$
declare
  table_name text;
  columns text;
begin
  foreach table_name in array array['users', 'events', 'venues', 'roles', 'registrations', 'equipment_reservations'] loop
    select string_agg(format('%I', attname), ', ' order by attnum) into columns
      from pg_catalog.pg_attribute
      where attrelid = format('public.%I', table_name)::regclass and attnum > 0 and not attisdropped;
    execute format('revoke all (%s) on table public.%I from public, anon, authenticated', columns, table_name);
  end loop;
end $$;

grant select on table public.users, public.events, public.venues to authenticated;
grant insert (name, location, capacity, facilities, accessibility_features, operating_information),
  update (name, location, capacity, facilities, accessibility_features, operating_information)
  on table public.venues to authenticated;
grant select, insert, update, delete on table public.users, public.events, public.venues,
  public.roles, public.registrations, public.equipment_reservations to service_role;

revoke all on sequence public.events_event_id_seq, public.venues_venue_id_seq,
  public.roles_role_id_seq, public.registrations_registration_id_seq,
  public.equipment_reservations_reservation_id_seq from public, anon, authenticated;
grant usage on sequence public.venues_venue_id_seq to authenticated;
grant usage, select on sequence public.events_event_id_seq, public.venues_venue_id_seq,
  public.roles_role_id_seq, public.registrations_registration_id_seq,
  public.equipment_reservations_reservation_id_seq to service_role;

-- Keep the established SG2-26 policy semantics exactly: caller-owned
-- profiles and exact, nonblank organisation membership for organisers.
drop policy if exists users_read_self on public.users;
create policy users_read_self on public.users for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists events_read_organisation on public.events;
create policy events_read_organisation on public.events for select to authenticated
  using (exists (
    select 1 from public.users membership
    join public.account_roles assignment on assignment.user_id = membership.user_id
    where membership.user_id = (select auth.uid())
      and assignment.role = 'event_organiser'
      and btrim(membership.organisation,
        U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') <> ''
      and membership.organisation = events.organisation
  ));
create index if not exists events_organisation_idx on public.events (organisation);

drop policy if exists venues_read_internal on public.venues;
create policy venues_read_internal on public.venues for select to authenticated
  using (exists (select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid())
      and ar.role in ('event_coordinator', 'venue_staff', 'technical_support_staff')));
drop policy if exists venues_insert_staff on public.venues;
create policy venues_insert_staff on public.venues for insert to authenticated
  with check (exists (select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid()) and ar.role = 'venue_staff'));
drop policy if exists venues_update_staff on public.venues;
create policy venues_update_staff on public.venues for update to authenticated
  using (exists (select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid()) and ar.role = 'venue_staff'))
  with check (exists (select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid()) and ar.role = 'venue_staff'));

-- roles, registrations and equipment_reservations intentionally have no
-- ordinary-caller policy. Existing guarded RPCs and their owners are unchanged.
commit;
