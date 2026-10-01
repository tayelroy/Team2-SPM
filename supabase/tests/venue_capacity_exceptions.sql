-- SG2-47: run only in disposable CI/local PostgreSQL. Everything rolls back.
--
-- Capacity exceptions are recorded only through the API, against a real
-- booking request and approver, by one of the three approving roles. Clients
-- cannot read or write them directly, and approving one leaves the booking
-- request's own status untouched.
begin;
insert into auth.users (id) values
  ('c0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000002');
insert into public.users (user_id, name, role_id) values
  ('c0000000-0000-4000-8000-000000000001', 'Exception organiser', 1),
  ('c0000000-0000-4000-8000-000000000002', 'Exception venue staff', 3);
insert into public.venues (venue_id, name, capacity) values (94701, 'Small Hall', 50);
insert into public.events (event_id, organiser_id, name, status, expected_attendance)
  values (94701, 'c0000000-0000-4000-8000-000000000001', 'Big event', 'approved', 80);

set local role service_role;
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at)
  values (94701, 94701, 94701, '2030-06-15T02:00Z', '2030-06-15T10:00Z');

do $$
begin
  insert into public.venue_capacity_exceptions (request_id, approved_by, approver_role, expected_attendance, venue_capacity)
    values (94701, 'c0000000-0000-4000-8000-000000000002', 'venue_staff', 80, 50);
  insert into public.venue_capacity_exceptions (request_id, approved_by, approver_role, expected_attendance, venue_capacity)
    values (94701, 'c0000000-0000-4000-8000-000000000001', 'event_organiser', 90, 50);
  if (select count(*) from public.venue_capacity_exceptions where request_id = 94701) <> 2 then
    raise exception 'Every approval must be kept as history';
  end if;
  if (select approved_at from public.venue_capacity_exceptions where request_id = 94701 limit 1) is null then
    raise exception 'Approval time must be recorded';
  end if;
  if (select status from public.venue_booking_requests where request_id = 94701) <> 'pending' then
    raise exception 'Approving an exception must not decide the booking';
  end if;

  begin
    insert into public.venue_capacity_exceptions (request_id, approved_by, approver_role, expected_attendance)
      values (94701, 'c0000000-0000-4000-8000-000000000002', 'event_coordinator', 80);
    raise exception 'A coordinator was recorded as approving an exception';
  exception when check_violation then null; end;
  begin
    insert into public.venue_capacity_exceptions (request_id, approved_by, approver_role, expected_attendance)
      values (94701, 'c0000000-0000-4000-8000-000000000002', 'venue_staff', 0);
    raise exception 'An exception without an attendance was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.venue_capacity_exceptions (request_id, approved_by, approver_role, expected_attendance)
      values (-1, 'c0000000-0000-4000-8000-000000000002', 'venue_staff', 80);
    raise exception 'An exception for no booking request was accepted';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.venue_capacity_exceptions (request_id, approved_by, approver_role, expected_attendance)
      values (94701, 'c0000000-0000-4000-8000-000000000009', 'venue_staff', 80);
    raise exception 'An exception without a known approver was accepted';
  exception when foreign_key_violation then null; end;

  delete from public.venue_booking_requests where request_id = 94701;
  if exists (select 1 from public.venue_capacity_exceptions where request_id = 94701) then
    raise exception 'Exceptions must go with their booking request';
  end if;
end $$;

reset role;
do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if has_table_privilege(role_name, 'public.venue_capacity_exceptions', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'Direct client access bypasses the API approval checks: %', role_name;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.venue_capacity_exceptions', 'UPDATE,DELETE') then
    raise exception 'Recorded approvals must not be edited or removed';
  end if;
  if not (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.venue_capacity_exceptions'::regclass) then
    raise exception 'Row level security must be enabled and forced';
  end if;
end $$;

rollback;
