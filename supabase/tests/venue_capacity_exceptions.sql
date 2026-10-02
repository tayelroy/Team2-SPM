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
    raise exception '[SG2-47:approval-history] [SG2-47:AC3] [NORMAL] Every approval must be kept as history';
  end if;
  if (select approved_at from public.venue_capacity_exceptions where request_id = 94701 limit 1) is null then
    raise exception '[SG2-47:approval-time] [SG2-47:AC3] [NORMAL] Approval time must be recorded';
  end if;
  if (select status from public.venue_booking_requests where request_id = 94701) <> 'pending' then
    raise exception '[SG2-47:booking-left-pending] [SG2-47:AC5] [NORMAL] Approving an exception must not decide the booking';
  end if;

  begin
    insert into public.venue_capacity_exceptions (request_id, approved_by, approver_role, expected_attendance)
      values (94701, 'c0000000-0000-4000-8000-000000000002', 'event_coordinator', 80);
    raise exception '[SG2-47:coordinator-cannot-approve] [SG2-47:AC3] [FAILURE] A coordinator was recorded as approving an exception';
  exception when check_violation then null; end;
  begin
    insert into public.venue_capacity_exceptions (request_id, approved_by, approver_role, expected_attendance)
      values (94701, 'c0000000-0000-4000-8000-000000000002', 'venue_staff', 0);
    raise exception '[SG2-47:attendance-positive] [SG2-47:AC3] [BOUNDARY] An exception for zero attendance was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.venue_capacity_exceptions (request_id, approved_by, approver_role, expected_attendance)
      values (-1, 'c0000000-0000-4000-8000-000000000002', 'venue_staff', 80);
    raise exception '[SG2-47:needs-booking-request] [SG2-47:AC3] [FAILURE] An exception for no booking request was accepted';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.venue_capacity_exceptions (request_id, approved_by, approver_role, expected_attendance)
      values (94701, 'c0000000-0000-4000-8000-000000000009', 'venue_staff', 85);
    raise exception '[SG2-47:needs-known-approver] [SG2-47:AC3] [FAILURE] An exception without a known approver was accepted';
  exception when foreign_key_violation then null; end;
  begin
    -- A second approver acting at the same time as the first.
    insert into public.venue_capacity_exceptions (request_id, approved_by, approver_role, expected_attendance)
      values (94701, 'c0000000-0000-4000-8000-000000000002', 'venue_staff', 80);
    raise exception '[SG2-47:concurrent-duplicate-approval] [SG2-47:AC3] [CONFLICT] The same approval was recorded twice';
  exception when unique_violation then null; end;

  delete from public.venue_booking_requests where request_id = 94701;
  if exists (select 1 from public.venue_capacity_exceptions where request_id = 94701) then
    raise exception '[SG2-47:cascade-with-request] [SG2-47:AC3] [NORMAL] Exceptions must go with their booking request';
  end if;
end $$;

reset role;
do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if has_table_privilege(role_name, 'public.venue_capacity_exceptions', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception '[SG2-47:no-direct-client-access] [SG2-47:AC3] [FAILURE] Direct client access bypasses the API approval checks: %', role_name;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.venue_capacity_exceptions', 'UPDATE,DELETE') then
    raise exception '[SG2-47:approvals-immutable] [SG2-47:AC3] [FAILURE] Recorded approvals must not be edited or removed';
  end if;
  if not (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.venue_capacity_exceptions'::regclass) then
    raise exception '[SG2-47:rls-forced] [SG2-47:AC3] [FAILURE] Row level security must be enabled and forced';
  end if;
end $$;

rollback;
