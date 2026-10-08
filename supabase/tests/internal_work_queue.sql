-- Review trace: original PR #39.
-- Numeric AC tags follow verified SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
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
insert into public.events (event_id, organiser_id, coordinator_id, name, status, expected_attendance, description, registration_needed, decision_reason, completed_by, completed_at)
select 94100 + n, 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
  'Event ' || n, state::public.event_status, 80, 'Full event description', true,
  -- SG2-37: a rejected event must record why it was rejected
  -- (events_rejection_requires_reason), so the fixture supplies one.
  case when state = 'rejected' then 'Rejected during fixture setup' end,
  -- SG2-100: a completed event must record who and when
  -- (events_completed_requires_record / events_completion_recorded_together).
  case when state = 'completed' then 'c0000000-0000-4000-8000-000000000002'::uuid end,
  case when state = 'completed' then '2026-10-01T00:00:00+00'::timestamptz end
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
-- SG2-48 AC4: an approved request for the same venue and an overlapping
-- period would duplicate the pending one above, so decided ones use another day.
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, status)
select 94200 + n, 94102, 94101, '2030-06-20T02:00Z', '2030-06-20T10:00Z', status
from (values (1, 'approved'), (2, 'rejected'), (3, 'cancelled')) decisions(n, status);
insert into public.equipment_requests (request_id, event_id, equipment_id, quantity, starts_at, ends_at, status)
select 94200 + n, 94102, 94101, 1, '2030-06-15T02:00Z', '2030-06-15T10:00Z', status
from (values (1, 'approved'), (2, 'rejected'), (3, 'cancelled')) decisions(n, status);

do $$
declare kind_name text;
begin
  if (select array_agg(item_id order by item_id) from public.internal_work_items where kind = 'event')
      is distinct from array[94102,94103,94104,94105,94106,94110,94112]::bigint[] then
    raise exception '[SG2-41:coordinator-event-states] [SG2-41:AC1] [SG2-29:AC4] [NORMAL] Coordinator view must contain reviews and active assigned events only';
  end if;
  if (select array_agg(item_id order by item_id) from public.internal_work_items where category = 'assigned')
      is distinct from array[94104,94105,94106]::bigint[] then
    raise exception '[SG2-41:assigned-work-category] [SG2-41:AC1] [NORMAL] Assigned category must exclude reviews and unassigned events';
  end if;
  if (select array_agg(item_id order by item_id) from public.internal_work_items where audience = 'event_coordinator' and assigned_to is null)
      is distinct from array[94110,94112]::bigint[] then
    raise exception '[SG2-41:shared-review-pool] [SG2-41:AC1] [NORMAL] Only unassigned reviews enter the shared coordinator pool';
  end if;
  if (select title from public.internal_work_items where kind = 'event' and item_id = 94112) is distinct from 'Untitled event' then
    raise exception '[SG2-41:empty-event-title] [SG2-41:AC1] [BOUNDARY] Unnamed records still need a selectable title';
  end if;
  if (select details from public.internal_work_items where kind = 'event' and item_id = 94102)
      @> '{"description":"Full event description","expected_attendance":80,"registration_needed":true}'::jsonb is not true then
    raise exception '[SG2-41:event-detail-values] [SG2-41:AC4] [NORMAL] Event detail lost stored values';
  end if;
  foreach kind_name in array array['venue', 'equipment'] loop
    if (select array_agg(item_id order by item_id) from public.internal_work_items where kind = kind_name)
        is distinct from array[94102,94103,94104,94105,94106]::bigint[] then
      raise exception '[SG2-41:pending-request-states] [SG2-41:AC2] [SG2-41:AC3] [NORMAL] Request queue % included decided requests or inactive events', kind_name;
    end if;
  end loop;
  if not exists (select 1 from public.internal_work_items where kind = 'venue' and item_id = 94102
    and audience = 'venue_staff' and title = 'Queue Hall' and event_name = 'Event 2'
    and starts_at = '2030-06-15T02:00Z' and ends_at = '2030-06-15T10:00Z'
    and details @> '{"capacity":120,"location":"Level 2","notes":"Setup at 10am SGT"}'::jsonb) then
    raise exception '[SG2-41:booking-detail-values] [SG2-41:AC2] [NORMAL] Booking identity, window or detail does not match storage';
  end if;
  if not exists (select 1 from public.internal_work_items where kind = 'equipment' and item_id = 94102
    and audience = 'technical_support_staff' and title = 'Queue microphones'
    and details @> '{"quantity":4,"notes":"Four microphones"}'::jsonb) then
    raise exception '[SG2-41:equipment-detail-values] [SG2-41:AC3] [NORMAL] Equipment identity or quantity does not match storage';
  end if;

  update public.venue_booking_requests set status = 'approved' where request_id = 94102;
  update public.equipment_requests set status = 'rejected' where request_id = 94102;
  if exists (select 1 from public.internal_work_items where item_id = 94102 and kind <> 'event') then
    raise exception '[SG2-41:decided-request-removal] [SG2-41:AC2] [SG2-41:AC3] [CONFLICT] Decided requests must leave the queue immediately';
  end if;
  update public.events set status = 'cancelled' where event_id = 94103;
  if exists (select 1 from public.internal_work_items where event_id = 94103) then
    raise exception '[SG2-41:cancelled-event-removal] [SG2-41:AC1] [SG2-41:AC2] [SG2-41:AC3] [CONFLICT] Cancelled event work must leave every queue';
  end if;
end $$;

-- These invalid storage states would make request details misleading.
do $$
begin
  insert into public.equipment_requests (request_id,event_id,equipment_id,quantity,starts_at,ends_at)
    values (94301,94102,94101,1,'2030-07-01T02:00Z','2030-07-01T02:00:00.000001Z');
  insert into public.venue_booking_requests (request_id,event_id,venue_id,starts_at,ends_at)
    values (94301,94102,94101,'2030-07-01T02:00Z','2030-07-01T02:00:00.000001Z');
  if not exists (select 1 from public.internal_work_items where kind = 'equipment' and item_id = 94301
      and status = 'pending' and details @> '{"quantity":1}'::jsonb
      and starts_at = '2030-07-01T02:00Z' and ends_at = '2030-07-01T02:00:00.000001Z')
    or not exists (select 1 from public.internal_work_items where kind = 'venue' and item_id = 94301
      and status = 'pending' and starts_at = '2030-07-01T02:00Z' and ends_at = '2030-07-01T02:00:00.000001Z') then
    raise exception '[SG2-41:minimum-request-values] [BOUNDARY] Quantity one and one-microsecond request periods must enter the pending queue';
  end if;
  begin
    insert into public.equipment_requests (event_id,equipment_id,quantity,starts_at,ends_at)
      values (94102,94101,1,'2030-06-15T02:00Z','2030-06-15T02:00Z');
    raise exception '[SG2-41:empty-equipment-window] [BOUNDARY] Equal equipment request start and end must be rejected';
  exception when check_violation then null; end;
  begin
    insert into public.equipment_requests (event_id,equipment_id,quantity,starts_at,ends_at)
      values (94102,94101,0,'2030-06-15T02:00Z','2030-06-15T10:00Z');
    raise exception '[SG2-41:zero-equipment-quantity] [BOUNDARY] Zero quantity accepted';
  exception when check_violation then null; end;
  begin
    insert into public.venue_booking_requests (event_id,venue_id,starts_at,ends_at)
      values (94102,94101,'2030-06-15T02:00Z','2030-06-15T02:00Z');
    raise exception '[SG2-41:empty-booking-window] [BOUNDARY] Empty booking interval accepted';
  exception when check_violation then null; end;
  begin
    insert into public.equipment_requests (event_id,equipment_id,quantity,starts_at,ends_at)
      values (94102,94101,1,'2030-06-15T10:00Z','2030-06-15T02:00Z');
    raise exception '[SG2-41:backwards-equipment-window] [FAILURE] Backwards equipment interval accepted';
  exception when check_violation then null; end;
  begin
    insert into public.venue_booking_requests (event_id,venue_id,starts_at,ends_at,status)
      values (94102,94101,'2030-06-15T02:00Z','2030-06-15T10:00Z','unknown');
    raise exception '[SG2-41:invalid-booking-status] [FAILURE] Invalid booking status accepted';
  exception when check_violation then null; end;
  begin
    insert into public.equipment_requests (event_id,equipment_id,quantity,starts_at,ends_at,status)
      values (94102,94101,1,'2030-06-15T02:00Z','2030-06-15T10:00Z','unknown');
    raise exception '[SG2-41:invalid-equipment-status] [FAILURE] Invalid equipment status accepted';
  exception when check_violation then null; end;
  begin
    insert into public.venue_booking_requests (event_id,venue_id,starts_at,ends_at)
      values (-1,94101,'2030-06-15T02:00Z','2030-06-15T10:00Z');
    raise exception '[SG2-41:booking-event-reference] [FAILURE] Orphan booking accepted';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.equipment_requests (event_id,equipment_id,quantity,starts_at,ends_at)
      values (94102,-1,1,'2030-06-15T02:00Z','2030-06-15T10:00Z');
    raise exception '[SG2-41:equipment-reference] [FAILURE] Unknown equipment accepted';
  exception when foreign_key_violation then null; end;
end $$;

reset role;
do $$
declare role_name text; object_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    execute format('set local role %I', role_name);
    foreach object_name in array array['venue_booking_requests', 'equipment_requests', 'internal_work_items'] loop
      begin
        execute format('select 1 from public.%I limit 1', object_name);
        raise exception '[SG2-41:direct-client-read] [FAILURE] Direct client % must not read %', role_name, object_name;
      exception when insufficient_privilege then null;
      end;
      if object_name <> 'internal_work_items' then
        begin
          execute format('truncate table public.%I', object_name);
          raise exception '[SG2-41:direct-client-truncate] [FAILURE] Direct client % must not truncate %', role_name, object_name;
        exception when insufficient_privilege then null;
        end;
        begin
          execute format('update public.%I set status = ''approved'' where request_id = 94301', object_name);
          raise exception '[SG2-41:direct-client-update] [FAILURE] Direct client % must not update %', role_name, object_name;
        exception when insufficient_privilege then null;
        end;
        begin
          execute format('delete from public.%I where request_id = 94301', object_name);
          raise exception '[SG2-41:direct-client-delete] [FAILURE] Direct client % must not delete %', role_name, object_name;
        exception when insufficient_privilege then null;
        end;
        begin
          if object_name = 'venue_booking_requests' then
            insert into public.venue_booking_requests (event_id,venue_id,starts_at,ends_at)
              values (94102,94101,'2030-07-02T02:00Z','2030-07-02T03:00Z');
          else
            insert into public.equipment_requests (event_id,equipment_id,quantity,starts_at,ends_at)
              values (94102,94101,1,'2030-07-02T02:00Z','2030-07-02T03:00Z');
          end if;
          raise exception '[SG2-41:direct-client-insert] [FAILURE] Direct client % must not insert into %', role_name, object_name;
        exception when insufficient_privilege then null;
        end;
      end if;
    end loop;
    execute 'reset role';
  end loop;
end $$;
rollback;
