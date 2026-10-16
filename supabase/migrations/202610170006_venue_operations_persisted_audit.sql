-- SG2-77 AC6: ON CONFLICT runs BEFORE INSERT even when it updates a row.
-- Stamp persisted metadata before the write, but audit only the actual
-- INSERT/UPDATE afterward. Existing history and values are deliberately kept.
begin;

create or replace function public.venue_operations_stamp_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.venue_operations_record_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
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


revoke all on function public.venue_operations_stamp_change() from public, anon, authenticated;
revoke all on function public.venue_operations_record_change() from public, anon, authenticated;

drop trigger if exists venue_operations_record_change on public.venue_operations;
drop trigger if exists venue_operations_stamp_change on public.venue_operations;
create trigger venue_operations_stamp_change
  before insert or update on public.venue_operations
  for each row execute function public.venue_operations_stamp_change();
create trigger venue_operations_record_change
  after insert or update on public.venue_operations
  for each row execute function public.venue_operations_record_change();

commit;
