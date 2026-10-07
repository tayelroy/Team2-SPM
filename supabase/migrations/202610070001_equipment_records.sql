-- SG2-52: maintain equipment without replacing the identities and labels
-- already referenced by requests, reservations and the internal work queue.
begin;

update public.equipment set quantity_total = greatest(coalesce(quantity_total, 0), 0);
alter table public.equipment
  alter column quantity_total set not null,
  alter column quantity_total set default 0,
  add column description text not null default 'Not recorded',
  add column location text not null default 'Not recorded',
  add column operational_status text not null default 'operational',
  add column version bigint not null default 1,
  add column available_quantity integer generated always as (
    case when operational_status = 'operational' then quantity_total else 0 end
  ) stored,
  add constraint equipment_type_nonblank check (btrim(name) <> ''),
  add constraint equipment_quantity_nonnegative check (quantity_total >= 0),
  add constraint equipment_description_valid check (btrim(description) <> '' and char_length(description) <= 2000),
  add constraint equipment_location_valid check (btrim(location) <> '' and char_length(location) <= 2000),
  add constraint equipment_status_valid check (operational_status in ('operational', 'damaged', 'maintenance')),
  add constraint equipment_version_valid check (version between 1 and 9007199254740991);

-- The caller submits the version it read as an UPDATE predicate. PostgreSQL
-- rechecks that predicate after any concurrent row update, so only one editor
-- wins. The trigger advances the stored version even for direct SQL updates.
create function public.advance_equipment_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;
revoke all on function public.advance_equipment_version() from public, anon, authenticated;
create trigger advance_equipment_version before update on public.equipment
  for each row execute function public.advance_equipment_version();

alter table public.equipment enable row level security;
alter table public.equipment force row level security;
revoke all on table public.equipment from public, anon, authenticated;
grant select on table public.equipment to authenticated;
grant insert (name, description, quantity_total, location, operational_status),
  update (name, description, quantity_total, location, operational_status)
  on table public.equipment to authenticated;
grant select, insert, update, delete on table public.equipment to service_role;
revoke all on sequence public.equipment_equipment_id_seq from public, anon, authenticated;
grant usage on sequence public.equipment_equipment_id_seq to authenticated;
grant usage, select on sequence public.equipment_equipment_id_seq to service_role;

create policy equipment_read on public.equipment for select to authenticated
  using (exists (select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid()) and ar.role = 'technical_support_staff'));
create policy equipment_insert on public.equipment for insert to authenticated
  with check (exists (select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid()) and ar.role = 'technical_support_staff'));
create policy equipment_update on public.equipment for update to authenticated
  using (exists (select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid()) and ar.role = 'technical_support_staff'))
  with check (exists (select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid()) and ar.role = 'technical_support_staff'));

commit;
