-- Venue setup, turnaround and safety details (SG2-77, Week 7 customer
-- changes #1 and #6). Venue Staff record how long each venue needs before an
-- event to prepare and after it to reset, plus its emergency access
-- arrangements and known restrictions for the Safety Officer.
--
-- Kept in its own table, like venue_layouts (SG2-43): a venue without a row
-- has 0 minutes of setup and turnaround and no safety details recorded. The
-- server reads and writes with the caller's own bearer token (see
-- server/src/db/venueOperations.ts), so these policies, not only the route
-- checks, enforce who may read and change the values.
begin;

create table public.venue_operations (
  venue_id           integer primary key references public.venues(venue_id) on delete cascade,
  setup_minutes      integer not null default 0,
  turnaround_minutes integer not null default 0,
  emergency_access   text,
  known_restrictions text,
  updated_by         uuid references public.users(user_id),
  updated_at         timestamptz not null default now(),
  constraint venue_operations_setup_range check (setup_minutes between 0 and 1440),
  constraint venue_operations_turnaround_range check (turnaround_minutes between 0 and 1440),
  constraint venue_operations_emergency_access_length check (char_length(emergency_access) <= 2000),
  constraint venue_operations_known_restrictions_length check (char_length(known_restrictions) <= 2000)
);

-- Every change is kept with who made it and when (SG2-77 AC6). Written only
-- by the trigger below, so the history cannot be edited through the API.
create table public.venue_operation_history (
  history_id  bigserial primary key,
  venue_id    integer not null references public.venues(venue_id) on delete cascade,
  field_name  text not null,
  old_value   text,
  new_value   text,
  changed_by  uuid references public.users(user_id),
  changed_at  timestamptz not null default now()
);
create index venue_operation_history_venue_idx
  on public.venue_operation_history (venue_id, changed_at);

create function public.venue_operations_record_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  new.updated_by := actor;
  new.updated_at := now();
  if tg_op = 'INSERT' or new.setup_minutes is distinct from old.setup_minutes then
    insert into public.venue_operation_history (venue_id, field_name, old_value, new_value, changed_by)
    values (new.venue_id, 'setup_minutes',
      case when tg_op = 'INSERT' then null else old.setup_minutes::text end, new.setup_minutes::text, actor);
  end if;
  if tg_op = 'INSERT' or new.turnaround_minutes is distinct from old.turnaround_minutes then
    insert into public.venue_operation_history (venue_id, field_name, old_value, new_value, changed_by)
    values (new.venue_id, 'turnaround_minutes',
      case when tg_op = 'INSERT' then null else old.turnaround_minutes::text end, new.turnaround_minutes::text, actor);
  end if;
  if (tg_op = 'INSERT' and new.emergency_access is not null)
      or (tg_op = 'UPDATE' and new.emergency_access is distinct from old.emergency_access) then
    insert into public.venue_operation_history (venue_id, field_name, old_value, new_value, changed_by)
    values (new.venue_id, 'emergency_access',
      case when tg_op = 'INSERT' then null else old.emergency_access end, new.emergency_access, actor);
  end if;
  if (tg_op = 'INSERT' and new.known_restrictions is not null)
      or (tg_op = 'UPDATE' and new.known_restrictions is distinct from old.known_restrictions) then
    insert into public.venue_operation_history (venue_id, field_name, old_value, new_value, changed_by)
    values (new.venue_id, 'known_restrictions',
      case when tg_op = 'INSERT' then null else old.known_restrictions end, new.known_restrictions, actor);
  end if;
  return new;
end;
$$;

revoke all on function public.venue_operations_record_change() from public, anon, authenticated;

create trigger venue_operations_record_change
  before insert or update on public.venue_operations
  for each row execute function public.venue_operations_record_change();

alter table public.venue_operations enable row level security;
alter table public.venue_operations force row level security;
alter table public.venue_operation_history enable row level security;
alter table public.venue_operation_history force row level security;

revoke all on table public.venue_operations, public.venue_operation_history from public, anon, authenticated;
grant select, insert, update on table public.venue_operations to authenticated;
grant select on table public.venue_operation_history to authenticated;
grant select, insert, update, delete on table public.venue_operations, public.venue_operation_history to service_role;
revoke all on sequence public.venue_operation_history_history_id_seq from public, anon, authenticated;
grant usage, select on sequence public.venue_operation_history_history_id_seq to service_role;

-- Read by the roles that view venue availability and search venues, since
-- setup and turnaround times change what counts as available (SG2-78).
create policy venue_operations_read on public.venue_operations
  for select to authenticated
  using (exists (
    select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid())
      and ar.role in ('venue_staff', 'event_coordinator', 'technical_support_staff')
  ));

-- The store saves with an upsert, so Venue Staff need insert and update.
create policy venue_operations_insert on public.venue_operations
  for insert to authenticated
  with check (exists (
    select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid()) and ar.role = 'venue_staff'
  ));

create policy venue_operations_update on public.venue_operations
  for update to authenticated
  using (exists (
    select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid()) and ar.role = 'venue_staff'
  ))
  with check (exists (
    select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid()) and ar.role = 'venue_staff'
  ));

create policy venue_operation_history_read on public.venue_operation_history
  for select to authenticated
  using (exists (
    select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid()) and ar.role = 'venue_staff'
  ));

commit;
