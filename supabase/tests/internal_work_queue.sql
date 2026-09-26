-- SG2-41: run only in disposable CI/local PostgreSQL. Everything rolls back.
begin;
insert into auth.users (id) values
  ('c0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000002');
insert into public.users (user_id, name, role_id) values
  ('c0000000-0000-4000-8000-000000000001', 'Queue organiser', 1),
  ('c0000000-0000-4000-8000-000000000002', 'Queue coordinator', 2);
insert into public.venues (venue_id, name, location, capacity) values (94101, 'Queue Hall', 'Level 2', 120);
insert into public.equipment (equipment_id, name, quantity_total) values (94101, 'Queue microphones', 10);
insert into public.events (event_id, organiser_id, coordinator_id, name, status, expected_attendance, description, registration_needed)
select 94100 + n, 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
  'Event ' || n, state::public.event_status, 80, 'Full event description', true
from (values (1, 'draft'), (2, 'submitted'), (3, 'under_review'), (4, 'approved'), (5, 'planning'),
  (6, 'confirmed'), (7, 'completed'), (8, 'cancelled'), (9, 'rejected')) states(n, state);
insert into public.events (event_id, organiser_id, name, status) values
  (94110, 'c0000000-0000-4000-8000-000000000001', 'Shared review', 'submitted'),
  (94111, 'c0000000-0000-4000-8000-000000000001', 'Unassigned planning', 'planning'),
  (94112, 'c0000000-0000-4000-8000-000000000001', '', 'submitted');

set local role service_role;
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, notes)
select event_id, event_id, 94101, '2030-06-15T02:00Z', '2030-06-15T10:00Z', 'Setup at 10am SGT'
from public.events where event_id between 94101 and 94109;
insert into public.equipment_requests (request_id, event_id, equipment_id, quantity, starts_at, ends_at, notes)
select event_id, event_id, 94101, 4, '2030-06-15T02:00Z', '2030-06-15T10:00Z', 'Four microphones'
from public.events where event_id between 94101 and 94109;
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, status)
select 94200 + n, 94102, 94101, '2030-06-15T02:00Z', '2030-06-15T10:00Z', status
from (values (1, 'approved'), (2, 'rejected'), (3, 'cancelled')) decisions(n, status);
insert into public.equipment_requests (request_id, event_id, equipment_id, quantity, starts_at, ends_at, status)
select 94200 + n, 94102, 94101, 1, '2030-06-15T02:00Z', '2030-06-15T10:00Z', status
from (values (1, 'approved'), (2, 'rejected'), (3, 'cancelled')) decisions(n, status);

do $$
declare kind_name text;
begin
  if (select array_agg(item_id order by item_id) from public.internal_work_items where kind = 'event')
      is distinct from array[94102,94103,94104,94105,94106,94110,94112]::bigint[] then
    raise exception 'Coordinator view must contain reviews and active assigned events only';
  end if;
  if (select array_agg(item_id order by item_id) from public.internal_work_items where category = 'assigned')
      is distinct from array[94104,94105,94106]::bigint[] then
    raise exception 'Assigned category must exclude reviews and unassigned events';
  end if;
  if (select array_agg(item_id order by item_id) from public.internal_work_items where audience = 'event_coordinator' and assigned_to is null)
      is distinct from array[94110,94112]::bigint[] then
    raise exception 'Only unassigned reviews enter the shared coordinator pool';
  end if;
  if (select title from public.internal_work_items where kind = 'event' and item_id = 94112) <> 'Untitled event' then
    raise exception 'Unnamed records still need a selectable title';
  end if;
  if (select details from public.internal_work_items where kind = 'event' and item_id = 94102)
      @> '{"description":"Full event description","expected_attendance":80,"registration_needed":true}'::jsonb is not true then
    raise exception 'Event detail lost stored values';
  end if;
  foreach kind_name in array array['venue', 'equipment'] loop
    if (select array_agg(item_id order by item_id) from public.internal_work_items where kind = kind_name)
        is distinct from array[94102,94103,94104,94105,94106]::bigint[] then
      raise exception 'Request queue % included decided requests or inactive events', kind_name;
    end if;
  end loop;
  if not exists (select 1 from public.internal_work_items where kind = 'venue' and item_id = 94102
    and audience = 'venue_staff' and title = 'Queue Hall' and event_name = 'Event 2'
    and starts_at = '2030-06-15T02:00Z' and ends_at = '2030-06-15T10:00Z'
    and details @> '{"capacity":120,"location":"Level 2","notes":"Setup at 10am SGT"}'::jsonb) then
    raise exception 'Booking identity, window or detail does not match storage';
  end if;
  if not exists (select 1 from public.internal_work_items where kind = 'equipment' and item_id = 94102
    and audience = 'technical_support_staff' and title = 'Queue microphones'
    and details @> '{"quantity":4,"notes":"Four microphones"}'::jsonb) then
    raise exception 'Equipment identity or quantity does not match storage';
  end if;

  update public.venue_booking_requests set status = 'approved' where request_id = 94102;
  update public.equipment_requests set status = 'rejected' where request_id = 94102;
  if exists (select 1 from public.internal_work_items where item_id = 94102 and kind <> 'event') then
    raise exception 'Decided requests must leave the queue immediately';
  end if;
  update public.events set status = 'cancelled' where event_id = 94103;
  if exists (select 1 from public.internal_work_items where event_id = 94103) then
    raise exception 'Cancelled event work must leave every queue';
  end if;
end $$;

-- These invalid storage states would make request details misleading.
do $$
begin
  begin
    insert into public.equipment_requests (event_id,equipment_id,quantity,starts_at,ends_at)
      values (94102,94101,0,'2030-06-15T02:00Z','2030-06-15T10:00Z');
    raise exception 'Zero quantity accepted';
  exception when check_violation then null; end;
  begin
    insert into public.venue_booking_requests (event_id,venue_id,starts_at,ends_at)
      values (94102,94101,'2030-06-15T02:00Z','2030-06-15T02:00Z');
    raise exception 'Empty booking interval accepted';
  exception when check_violation then null; end;
  begin
    insert into public.equipment_requests (event_id,equipment_id,quantity,starts_at,ends_at)
      values (94102,94101,1,'2030-06-15T10:00Z','2030-06-15T02:00Z');
    raise exception 'Backwards equipment interval accepted';
  exception when check_violation then null; end;
  begin
    insert into public.venue_booking_requests (event_id,venue_id,starts_at,ends_at,status)
      values (94102,94101,'2030-06-15T02:00Z','2030-06-15T10:00Z','unknown');
    raise exception 'Invalid booking status accepted';
  exception when check_violation then null; end;
  begin
    insert into public.equipment_requests (event_id,equipment_id,quantity,starts_at,ends_at,status)
      values (94102,94101,1,'2030-06-15T02:00Z','2030-06-15T10:00Z','unknown');
    raise exception 'Invalid equipment status accepted';
  exception when check_violation then null; end;
  begin
    insert into public.venue_booking_requests (event_id,venue_id,starts_at,ends_at)
      values (-1,94101,'2030-06-15T02:00Z','2030-06-15T10:00Z');
    raise exception 'Orphan booking accepted';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.equipment_requests (event_id,equipment_id,quantity,starts_at,ends_at)
      values (94102,-1,1,'2030-06-15T02:00Z','2030-06-15T10:00Z');
    raise exception 'Unknown equipment accepted';
  exception when foreign_key_violation then null; end;
end $$;

reset role;
do $$
declare role_name text; object_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    foreach object_name in array array['venue_booking_requests', 'equipment_requests', 'internal_work_items'] loop
      if has_table_privilege(role_name, 'public.' || object_name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
        raise exception 'Direct client access bypasses the API work-queue boundary: % %', role_name, object_name;
      end if;
    end loop;
  end loop;
  if exists (select 1 from pg_class where oid in ('public.venue_booking_requests'::regclass, 'public.equipment_requests'::regclass)
    and (not relrowsecurity or not relforcerowsecurity)) then
    raise exception 'Request tables must enforce RLS';
  end if;
end $$;
rollback;
