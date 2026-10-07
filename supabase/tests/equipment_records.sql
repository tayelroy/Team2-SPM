-- SG2-52: real constraints, generated availability, concurrent-edit predicate
-- and role policies. The suite is disposable and rolls every row back.
begin;

insert into auth.users (id) values
  ('d5200000-0000-4000-8000-000000000001'),
  ('d5200000-0000-4000-8000-000000000002'),
  ('d5200000-0000-4000-8000-000000000003'),
  ('d5200000-0000-4000-8000-000000000004'),
  ('d5200000-0000-4000-8000-000000000005'),
  ('d5200000-0000-4000-8000-000000000006'),
  ('d5200000-0000-4000-8000-000000000007');
insert into public.account_roles (user_id, role) values
  ('d5200000-0000-4000-8000-000000000001', 'technical_support_staff'),
  ('d5200000-0000-4000-8000-000000000002', 'event_organiser'),
  ('d5200000-0000-4000-8000-000000000003', 'event_coordinator'),
  ('d5200000-0000-4000-8000-000000000004', 'venue_staff'),
  ('d5200000-0000-4000-8000-000000000005', 'attendee'),
  ('d5200000-0000-4000-8000-000000000006', 'event_coordinator_lead'),
  ('d5200000-0000-4000-8000-000000000007', 'safety_officer');
insert into public.equipment (equipment_id, name, description, quantity_total, location)
  values (95201, 'Projector', 'Portable 4K projector', 8, 'Store A');

-- Maintained fields and effective stock.
do $$
begin
  if not exists (select 1 from public.equipment where equipment_id = 95201
      and name = 'Projector' and description = 'Portable 4K projector'
      and quantity_total = 8 and location = 'Store A' and operational_status = 'operational'
      and available_quantity = 8 and version = 1) then
    raise exception '[NORMAL] [SG2-52:db-stored-fields] [SG2-52:AC1] [SG2-52:AC2] Every field and operational quantity must persist';
  end if;
  update public.equipment set operational_status = 'damaged' where equipment_id = 95201;
  if not exists (select 1 from public.equipment where equipment_id = 95201 and available_quantity = 0 and quantity_total = 8) then
    raise exception '[NORMAL] [SG2-52:db-damaged-stock] [SG2-52:AC2] Damaged stock must be excluded without losing quantity held';
  end if;
  update public.equipment set operational_status = 'maintenance' where equipment_id = 95201;
  if not exists (select 1 from public.equipment where equipment_id = 95201 and available_quantity = 0) then
    raise exception '[NORMAL] [SG2-52:db-maintenance-stock] [SG2-52:AC2] Stock under maintenance must be excluded';
  end if;
  update public.equipment set operational_status = 'operational', quantity_total = 0 where equipment_id = 95201;
  if not exists (select 1 from public.equipment where equipment_id = 95201 and available_quantity = 0 and version = 4) then
    raise exception '[BOUNDARY] [SG2-52:db-zero-stock] [SG2-52:AC1] [SG2-52:AC2] Zero stock must be accepted and every update increments the version';
  end if;
  update public.equipment set quantity_total = 2147483647, name = repeat('🎤', 255),
    description = repeat('🎤', 2000), location = repeat('🎤', 2000) where equipment_id = 95201;
  if not exists (select 1 from public.equipment where equipment_id = 95201 and available_quantity = 2147483647) then
    raise exception '[BOUNDARY] [SG2-52:db-exact-limits] [SG2-52:AC1] Exact database integer and Unicode text limits must be accepted';
  end if;
  begin
    update public.equipment set quantity_total = -1 where equipment_id = 95201;
    raise exception '[BOUNDARY] [SG2-52:db-negative-quantity] [SG2-52:AC1] Negative held quantities must be rejected';
  exception when check_violation then null; end;
  begin
    update public.equipment set quantity_total = null where equipment_id = 95201;
    raise exception '[FAILURE] [SG2-52:db-null-quantity] [SG2-52:AC1] Null quantities must be rejected';
  exception when not_null_violation then null; end;
  begin
    update public.equipment set name = ' ' where equipment_id = 95201;
    raise exception '[BOUNDARY] [SG2-52:db-blank-type] [SG2-52:AC1] Blank types must be rejected';
  exception when check_violation then null; end;
  begin
    update public.equipment set description = repeat('x', 2001) where equipment_id = 95201;
    raise exception '[BOUNDARY] [SG2-52:db-description-limit] [SG2-52:AC1] Overlong descriptions must be rejected';
  exception when check_violation then null; end;
  begin
    update public.equipment set location = repeat('x', 2001) where equipment_id = 95201;
    raise exception '[BOUNDARY] [SG2-52:db-location-limit] [SG2-52:AC1] Overlong locations must be rejected';
  exception when check_violation then null; end;
  begin
    update public.equipment set operational_status = 'unknown' where equipment_id = 95201;
    raise exception '[FAILURE] [SG2-52:db-invalid-status] [SG2-52:AC2] Unknown operational statuses must be rejected';
  exception when check_violation then null; end;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd5200000-0000-4000-8000-000000000001', true);
do $$
declare
  new_id integer;
  changed integer;
begin
  insert into public.equipment (name, description, quantity_total, location, operational_status)
    values ('Speaker', 'Portable speaker', 5, 'Store B', 'operational') returning equipment_id into new_id;
  if not exists (select 1 from public.equipment where equipment_id = new_id and version = 1 and available_quantity = 5) then
    raise exception '[NORMAL] [SG2-52:db-staff-create] [SG2-52:AC1] [SG2-52:AC3] Technical Support Staff must create and read equipment';
  end if;
  update public.equipment set name = 'Updated speaker', description = 'Revised description', quantity_total = 7,
    location = 'Store C', operational_status = 'maintenance' where equipment_id = new_id and version = 1;
  if not exists (select 1 from public.equipment where equipment_id = new_id and name = 'Updated speaker'
      and description = 'Revised description' and quantity_total = 7 and location = 'Store C'
      and operational_status = 'maintenance' and available_quantity = 0 and version = 2) then
    raise exception '[NORMAL] [SG2-52:db-staff-update] [SG2-52:AC1] [SG2-52:AC2] [SG2-52:AC3] Staff update every field and availability';
  end if;
  update public.equipment set quantity_total = 99 where equipment_id = new_id and version = 1;
  get diagnostics changed = row_count;
  if changed <> 0 or not exists (select 1 from public.equipment where equipment_id = new_id and quantity_total = 7 and version = 2) then
    raise exception '[CONFLICT] [SG2-52:db-stale-version] [SG2-52:AC1] A stale editor must not overwrite a saved change';
  end if;
  begin
    update public.equipment set version = 999 where equipment_id = new_id;
    raise exception '[FAILURE] [SG2-52:db-version-protected] [SG2-52:AC1] Staff cannot write version metadata';
  exception when insufficient_privilege then null; end;
  begin
    update public.equipment set available_quantity = 999 where equipment_id = new_id;
    raise exception '[FAILURE] [SG2-52:db-availability-protected] [SG2-52:AC2] Staff cannot override generated availability';
  exception when insufficient_privilege or generated_always then null; end;
  begin
    delete from public.equipment where equipment_id = new_id;
    raise exception '[FAILURE] [SG2-52:db-delete-denied] [SG2-52:AC3] Equipment deletion has no grant';
  exception when insufficient_privilege then null; end;
end $$;

-- All six other roles cannot bypass API authorization
-- by calling the data API directly. Changing claims is confined to this test.
do $$
declare
  actor uuid;
  changed integer;
begin
  foreach actor in array array[
    'd5200000-0000-4000-8000-000000000002'::uuid, 'd5200000-0000-4000-8000-000000000003'::uuid,
    'd5200000-0000-4000-8000-000000000004'::uuid, 'd5200000-0000-4000-8000-000000000005'::uuid,
    'd5200000-0000-4000-8000-000000000006'::uuid, 'd5200000-0000-4000-8000-000000000007'::uuid
  ] loop
    perform set_config('request.jwt.claim.sub', actor::text, true);
    if exists (select 1 from public.equipment) then
      raise exception '[FAILURE] [SG2-52:db-other-roles-read] [SG2-52:AC3] Other roles cannot read the staff inventory: %', actor;
    end if;
    update public.equipment set quantity_total = 999 where equipment_id = 95201;
    get diagnostics changed = row_count;
    if changed <> 0 then
      raise exception '[FAILURE] [SG2-52:db-other-roles-update] [SG2-52:AC3] Other roles cannot update equipment: %', actor;
    end if;
    begin
      insert into public.equipment (name, description, quantity_total, location)
        values ('Forbidden', 'Unauthorized equipment', 1, 'Store X');
      raise exception '[FAILURE] [SG2-52:db-other-roles-create] [SG2-52:AC3] Other roles cannot create equipment: %', actor;
    exception when insufficient_privilege then null; end;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  update public.equipment set quantity_total = 999 where equipment_id = 95201;
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception '[FAILURE] [SG2-52:db-no-role-update] [SG2-52:AC3] Accounts without a role cannot update equipment';
  end if;
end $$;
reset role;
set local role anon;
do $$
begin
  begin
    select equipment_id from public.equipment;
    raise exception '[FAILURE] [SG2-52:db-anonymous-read] [SG2-52:AC3] Anonymous callers have no equipment read grant';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.equipment (name, description, quantity_total, location) values ('Anonymous', 'Blocked', 1, 'Store X');
    raise exception '[FAILURE] [SG2-52:db-anonymous-write] [SG2-52:AC3] Anonymous callers have no equipment write grant';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
