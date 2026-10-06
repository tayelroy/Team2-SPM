-- SG2-48: run only in disposable CI/local PostgreSQL. Everything rolls back.
--
-- A coordinator's venue request carries its period, layout and the event's
-- venue requirements, reaches Venue Staff through the work queue, and never
-- touches venue_bookings. An event may ask for several venues, but the same
-- venue over an overlapping period only once while a request is live.
begin;
insert into auth.users (id) values
  ('c0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000002');
insert into public.users (user_id, name, role_id) values
  ('c0000000-0000-4000-8000-000000000001', 'Request organiser', 1),
  ('c0000000-0000-4000-8000-000000000002', 'Request coordinator', 2);
insert into public.venues (venue_id, name, location, capacity) values
  (94801, 'Request Hall', 'Level 1', 200),
  (94802, 'Request Room', 'Level 2', 40);
insert into public.events (event_id, organiser_id, coordinator_id, name, status, expected_attendance, venue_requirements)
  values
  (94801, 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'Request forum', 'approved', 120, 'A stage'),
  (94802, 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'Other forum', 'planning', 30, null);

set local role service_role;
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, layout, venue_requirements, requested_by)
  values (94801, 94801, 94801, '2030-06-15T02:00Z', '2030-06-15T10:00Z', 'theatre', 'A stage', 'c0000000-0000-4000-8000-000000000002');

do $$
begin
  if not exists (select 1 from public.venue_booking_requests where request_id = 94801
      and status = 'pending' and layout = 'theatre' and venue_requirements = 'A stage'
      and requested_by = 'c0000000-0000-4000-8000-000000000002' and requested_at is not null) then
    raise exception '[SG2-48:request-carries-details] [SG2-48:AC1] [NORMAL] The request must keep its layout, requirements, requester and time, and start pending';
  end if;
  if not exists (select 1 from public.internal_work_items where kind = 'venue' and item_id = 94801
      and audience = 'venue_staff' and status = 'pending'
      and starts_at = '2030-06-15T02:00Z' and ends_at = '2030-06-15T10:00Z'
      and details @> '{"layout":"theatre","venue_requirements":"A stage","requested_by":"Request coordinator"}'::jsonb) then
    raise exception '[SG2-48:reaches-venue-staff] [SG2-48:AC2] [NORMAL] Venue Staff must see the pending request with its period, layout, requirements and requester';
  end if;
  if exists (select 1 from public.venue_bookings where venue_id = 94801) then
    raise exception '[SG2-48:no-hold-while-pending] [SG2-48:AC3] [NORMAL] A pending request must not hold the venue';
  end if;

  -- Several venues for one event, and the same venue for another event.
  insert into public.venue_booking_requests (event_id, venue_id, starts_at, ends_at, layout, requested_by)
    values (94801, 94802, '2030-06-15T02:00Z', '2030-06-15T10:00Z', 'classroom', 'c0000000-0000-4000-8000-000000000002');
  insert into public.venue_booking_requests (event_id, venue_id, starts_at, ends_at, layout, requested_by)
    values (94802, 94801, '2030-06-15T02:00Z', '2030-06-15T10:00Z', 'boardroom', 'c0000000-0000-4000-8000-000000000002');
  if (select count(*) from public.venue_booking_requests where event_id = 94801) <> 2 then
    raise exception '[SG2-48:several-venues-per-event] [SG2-48:AC4] [NORMAL] An event must be able to request several different venues';
  end if;
  if (select count(*) from public.venue_booking_requests where venue_id = 94801 and status = 'pending') <> 2 then
    raise exception '[SG2-48:pending-does-not-block-others] [SG2-48:AC3] [NORMAL] A pending request must not stop another event requesting the venue';
  end if;

  -- A tentative hold (SG2-84) creates its own request without a requester; it
  -- is not a coordinator's duplicate.
  insert into public.venue_booking_requests (event_id, venue_id, starts_at, ends_at, notes)
    values (94801, 94802, '2030-06-15T03:00Z', '2030-06-15T04:00Z', 'Tentative hold — approval required');
  if (select count(*) from public.venue_booking_requests where event_id = 94801 and venue_id = 94802 and status = 'pending') <> 2 then
    raise exception '[SG2-48:hold-not-duplicate] [SG2-48:AC4] [BOUNDARY] A hold''s own request must not be refused as a duplicate of a coordinator request';
  end if;

  -- The next period may start exactly when the earlier one ends.
  insert into public.venue_booking_requests (event_id, venue_id, starts_at, ends_at, layout, requested_by)
    values (94801, 94801, '2030-06-15T10:00Z', '2030-06-15T12:00Z', 'theatre', 'c0000000-0000-4000-8000-000000000002');
  if (select count(*) from public.venue_booking_requests where event_id = 94801 and venue_id = 94801) <> 2 then
    raise exception '[SG2-48:adjacent-period-allowed] [SG2-48:AC4] [BOUNDARY] A period starting as the earlier one ends is not a duplicate';
  end if;

  begin
    -- The same coordinator submitting the same request twice at once.
    insert into public.venue_booking_requests (event_id, venue_id, starts_at, ends_at, layout, requested_by)
      values (94801, 94801, '2030-06-15T09:59Z', '2030-06-15T11:00Z', 'theatre', 'c0000000-0000-4000-8000-000000000002');
    raise exception '[SG2-48:duplicate-overlap-refused] [SG2-48:AC4] [CONFLICT] A second request for the same venue and an overlapping period was accepted';
  exception when exclusion_violation then null; end;

  update public.venue_booking_requests set status = 'approved', decided_by = 'c0000000-0000-4000-8000-000000000002', decided_at = now() where request_id = 94801;
  begin
    insert into public.venue_booking_requests (event_id, venue_id, starts_at, ends_at, layout, requested_by)
      values (94801, 94801, '2030-06-15T03:00Z', '2030-06-15T04:00Z', 'theatre', 'c0000000-0000-4000-8000-000000000002');
    raise exception '[SG2-48:duplicate-of-approved-refused] [SG2-48:AC4] [CONFLICT] A request duplicating an approved one was accepted';
  exception when exclusion_violation then null; end;

  update public.venue_booking_requests set status = 'rejected', decision_reason = 'Room under repair' where request_id = 94801;
  insert into public.venue_booking_requests (event_id, venue_id, starts_at, ends_at, layout, requested_by)
    values (94801, 94801, '2030-06-15T03:00Z', '2030-06-15T04:00Z', 'theatre', 'c0000000-0000-4000-8000-000000000002');
  if (select count(*) from public.venue_booking_requests where event_id = 94801 and venue_id = 94801 and status = 'pending') <> 2 then
    raise exception '[SG2-48:re-request-after-rejection] [SG2-48:AC4] [BOUNDARY] A venue must be requestable again once the earlier request was rejected';
  end if;

  begin
    insert into public.venue_booking_requests (event_id, venue_id, starts_at, ends_at, requested_by)
      values (94802, 94802, '2030-07-01T02:00Z', '2030-07-01T04:00Z', 'c0000000-0000-4000-8000-000000000002');
    raise exception '[SG2-48:layout-required] [SG2-48:AC1] [FAILURE] A coordinator request without a layout was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.venue_booking_requests (event_id, venue_id, starts_at, ends_at, layout, requested_by)
      values (94802, 94802, '2030-07-01T02:00Z', '2030-07-01T04:00Z', 'ballroom', 'c0000000-0000-4000-8000-000000000002');
    raise exception '[SG2-48:known-layout-only] [SG2-48:AC1] [FAILURE] A layout outside the venue layout list was accepted';
  exception when invalid_text_representation then null; end;
  begin
    insert into public.venue_booking_requests (event_id, venue_id, starts_at, ends_at, layout, requested_by)
      values (94802, 94802, '2030-07-01T02:00Z', '2030-07-01T04:00Z', 'theatre', 'c0000000-0000-4000-8000-000000000009');
    raise exception '[SG2-48:known-requester] [SG2-48:AC1] [FAILURE] A request from an unknown account was accepted';
  exception when foreign_key_violation then null; end;
end $$;

reset role;
do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if has_table_privilege(role_name, 'public.venue_booking_requests', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception '[SG2-48:no-direct-client-access] [SG2-48:AC1] [FAILURE] Direct client access bypasses the API request checks: %', role_name;
    end if;
  end loop;
end $$;

rollback;
