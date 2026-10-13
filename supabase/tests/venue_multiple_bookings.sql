-- Review trace: SG2-82 book more than one venue for an event.
-- Numeric AC tags follow the SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- SG2-82: one event asks for several venues; each is checked and decided on
-- its own, a refusal at one does not stop the others, and the coordinator
-- withdraws a request the event no longer needs so its arrangement can be
-- ready (withdraw_venue_booking_request()).
-- Disposable local/CI test script. All changes are rolled back.
begin;

insert into auth.users (id) values
  ('e8200000-0000-4000-8000-000000000001'), ('e8200000-0000-4000-8000-000000000002'),
  ('e8200000-0000-4000-8000-000000000003'), ('e8200000-0000-4000-8000-000000000004');
insert into public.users (user_id, name, role_id) values
  ('e8200000-0000-4000-8000-000000000001', 'Multi staff', 3),
  ('e8200000-0000-4000-8000-000000000002', 'Multi coordinator', 2),
  ('e8200000-0000-4000-8000-000000000003', 'Multi organiser', 1),
  ('e8200000-0000-4000-8000-000000000004', 'Other coordinator', 2);
insert into public.account_roles (user_id, role) values
  ('e8200000-0000-4000-8000-000000000001', 'venue_staff'),
  ('e8200000-0000-4000-8000-000000000002', 'event_coordinator'),
  ('e8200000-0000-4000-8000-000000000003', 'event_organiser'),
  ('e8200000-0000-4000-8000-000000000004', 'event_coordinator');
-- An auditorium with no setup or turnaround, and two breakout rooms; Breakout
-- One needs an hour between bookings (SG2-78).
insert into public.venues (venue_id, name) values
  (98201, 'Multi Auditorium'), (98202, 'Multi Breakout One'), (98203, 'Multi Breakout Two'), (98204, 'Multi Breakout Three');
insert into public.venue_operations (venue_id, setup_minutes, turnaround_minutes) values (98202, 30, 30);
insert into public.events (event_id, organiser_id, coordinator_id, name, status) values
  (98201, 'e8200000-0000-4000-8000-000000000003', 'e8200000-0000-4000-8000-000000000002', 'Multi Congress', 'planning'),
  (98202, 'e8200000-0000-4000-8000-000000000003', 'e8200000-0000-4000-8000-000000000004', 'Neighbour Talk', 'planning');
-- Another event ends 15 minutes before the congress starts, at both the
-- auditorium and Breakout One.
insert into public.venue_bookings (booking_id, venue_id, event_id, starts_at, ends_at, status) values
  (98201, 98201, 98202, '2030-10-01 00:00+00', '2030-10-01 00:45+00', 'confirmed'),
  (98202, 98202, 98202, '2030-10-01 00:00+00', '2030-10-01 00:45+00', 'confirmed');

-- 1. One event raises several requests, each linked to it:
do $$
begin
  insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, layout, requested_by) values
    (98201, 98201, 98201, '2030-10-01 01:00+00', '2030-10-01 05:00+00', 'theatre', 'e8200000-0000-4000-8000-000000000002'),
    (98202, 98201, 98202, '2030-10-01 01:00+00', '2030-10-01 05:00+00', 'classroom', 'e8200000-0000-4000-8000-000000000002'),
    (98203, 98201, 98203, '2030-10-01 01:00+00', '2030-10-01 05:00+00', 'classroom', 'e8200000-0000-4000-8000-000000000002');
  if (select count(*) from public.venue_booking_requests where event_id = 98201 and status = 'pending') <> 3 then
    raise exception '[SG2-82:several-requests] [SG2-82:AC1] [NORMAL] An event must hold several pending venue requests at once, each linked to it';
  end if;
  begin
    insert into public.venue_booking_requests (event_id, venue_id, starts_at, ends_at, layout, requested_by)
      values (98201, 98203, '2030-10-01 04:00+00', '2030-10-01 06:00+00', 'classroom', 'e8200000-0000-4000-8000-000000000002');
    raise exception '[SG2-82:same-venue-twice] [SG2-82:AC1] [CONFLICT] An event requested the same venue twice over an overlapping period';
  exception when exclusion_violation then null;
  end;
end $$;

-- 2. Each venue is checked on its own, with its own setup and turnaround:
select set_config('request.jwt.claim.sub', 'e8200000-0000-4000-8000-000000000001', true);
do $$
declare result jsonb;
begin
  result := public.decide_venue_booking_request(98202, 'approve', null);
  if result->>'outcome' <> 'conflict' or result->>'kind' <> 'booking'
      or (select status from public.venue_booking_requests where request_id = 98202) <> 'pending' then
    raise exception '[SG2-82:own-turnaround] [SG2-82:AC2] [CONFLICT] Breakout One''s hour of setup and turnaround must refuse a booking 15 minutes after another: %', result;
  end if;
  result := public.decide_venue_booking_request(98201, 'approve', null);
  if result->>'outcome' <> 'updated' then
    raise exception '[SG2-82:independent-check] [SG2-82:AC2] [SG2-82:AC3] [NORMAL] The auditorium has no setup or turnaround, so the same gap must not refuse it: %', result;
  end if;
  if (select venue_booking_id from public.events where event_id = 98201) <> (result->>'venue_booking_id')::bigint then
    raise exception '[SG2-82:first-venue-kept] [SG2-82:AC1] [NORMAL] The event''s first approved venue must be its main venue';
  end if;
end $$;

-- 3. A refusal at one venue does not stop the others:
do $$
declare result jsonb;
begin
  result := public.decide_venue_booking_request(98202, 'reject', 'Breakout One needs its reset time');
  if result->>'outcome' <> 'updated' then
    raise exception '[SG2-82:reject-one] [SG2-82:AC3] [NORMAL] One of the event''s venues could not be rejected: %', result;
  end if;
  result := public.decide_venue_booking_request(98203, 'approve', null);
  if result->>'outcome' <> 'updated' then
    raise exception '[SG2-82:approve-another] [SG2-82:AC3] [NORMAL] Rejecting one venue blocked approving another for the same event: %', result;
  end if;
  if (select count(*) from public.venue_bookings where event_id = 98201 and status = 'confirmed') <> 2
      or (select count(distinct venue_booking_id) from public.venue_booking_requests where event_id = 98201 and status = 'approved') <> 2 then
    raise exception '[SG2-82:each-booking-linked] [SG2-82:AC1] [SG2-82:AC4] [NORMAL] Each approved venue must have its own confirmed booking for the event';
  end if;
end $$;
-- A further venue can still be requested after the rejection.
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, layout, requested_by) values
  (98204, 98201, 98204, '2030-10-01 01:00+00', '2030-10-01 05:00+00', 'classroom', 'e8200000-0000-4000-8000-000000000002');

-- 4. Who may withdraw, and what cannot be withdrawn:
do $$
begin
  begin
    perform public.withdraw_venue_booking_request(98202);
    raise exception '[SG2-82:staff-cannot-withdraw] [SG2-82:AC5] [FAILURE] Venue Staff withdrew a coordinator''s request';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', 'e8200000-0000-4000-8000-000000000004', true);
do $$
declare result jsonb;
begin
  result := public.withdraw_venue_booking_request(98202);
  if result->>'outcome' <> 'missing' or (select status from public.venue_booking_requests where request_id = 98202) <> 'rejected' then
    raise exception '[SG2-82:unassigned-coordinator-refused] [SG2-82:AC5] [FAILURE] A coordinator withdrew a request for an event not assigned to them: %', result;
  end if;
end $$;
select set_config('request.jwt.claim.sub', 'e8200000-0000-4000-8000-000000000002', true);
do $$
declare result jsonb;
begin
  result := public.withdraw_venue_booking_request(98201);
  if result->>'outcome' <> 'inactive' or result->>'status' <> 'approved' then
    raise exception '[SG2-82:approved-not-withdrawn] [SG2-82:AC5] [BOUNDARY] An approved request was withdrawn instead of its booking being released: %', result;
  end if;
  if public.withdraw_venue_booking_request(-1)->>'outcome' <> 'missing' then
    raise exception '[SG2-82:unknown-request] [SG2-82:AC5] [FAILURE] An unknown request was not reported missing';
  end if;
end $$;

-- 5. The coordinator withdraws the rejected venue and a pending one:
do $$
declare result jsonb;
begin
  result := public.withdraw_venue_booking_request(98202);
  if result->>'outcome' <> 'withdrawn' then
    raise exception '[SG2-82:withdraw-rejected] [SG2-82:AC5] [NORMAL] The coordinator could not withdraw a rejected request: %', result;
  end if;
  if not exists (select 1 from public.venue_booking_requests where request_id = 98202 and status = 'cancelled'
      and withdrawn_by = 'e8200000-0000-4000-8000-000000000002' and withdrawn_at is not null
      and decision_reason = 'Breakout One needs its reset time') then
    raise exception '[SG2-82:withdrawal-recorded] [SG2-82:AC4] [NORMAL] The withdrawal, who made it and when must be kept, alongside the earlier rejection';
  end if;
  if not exists (select 1 from public.event_audit_logs where event_id = 98201 and field_name = 'venue_booking_request'
      and actor_id = 'e8200000-0000-4000-8000-000000000002'
      and old_value = 'Rejected: Multi Breakout One (request 98202)' and new_value = 'Withdrawn: Multi Breakout One (request 98202)') then
    raise exception '[SG2-82:withdrawal-in-history] [SG2-82:AC4] [NORMAL] The withdrawal must appear in the event history with its actor';
  end if;
  result := public.withdraw_venue_booking_request(98202);
  if result->>'outcome' <> 'inactive' or result->>'status' <> 'cancelled' then
    raise exception '[SG2-82:second-withdrawal-refused] [SG2-82:AC5] [CONFLICT] A request already withdrawn was withdrawn again: %', result;
  end if;
  result := public.withdraw_venue_booking_request(98204);
  if result->>'outcome' <> 'withdrawn' or (select old_value from public.event_audit_logs
      where event_id = 98201 and new_value = 'Withdrawn: Multi Breakout Three (request 98204)') <> 'Pending: Multi Breakout Three (request 98204)' then
    raise exception '[SG2-82:withdraw-pending] [SG2-82:AC5] [NORMAL] The coordinator could not withdraw a pending request: %', result;
  end if;
  -- A withdrawn venue can be asked for again.
  insert into public.venue_booking_requests (event_id, venue_id, starts_at, ends_at, layout, requested_by)
    values (98201, 98204, '2030-10-01 01:00+00', '2030-10-01 05:00+00', 'classroom', 'e8200000-0000-4000-8000-000000000002');
end $$;

-- 6. A withdrawn request is not decided afterwards (a withdrawal and a
-- decision at once cannot both succeed: each locks the request first):
select set_config('request.jwt.claim.sub', 'e8200000-0000-4000-8000-000000000001', true);
do $$
declare result jsonb;
begin
  result := public.decide_venue_booking_request(98204, 'approve', null);
  if result->>'outcome' <> 'decided' or result->>'status' <> 'cancelled' then
    raise exception '[SG2-82:withdrawn-not-decided] [SG2-82:AC5] [CONFLICT] A withdrawn request was decided: %', result;
  end if;
end $$;

-- 7. A request belonging to a tentative hold is released through the hold:
do $$
declare result jsonb; held bigint;
begin
  result := public.create_venue_hold(98201, 98204, '2030-10-02 01:00+00', '2030-10-02 05:00+00', '2030-09-30 00:00+00');
  if result->>'outcome' <> 'created' then
    raise exception '[SG2-82:hold-fixture] [SG2-82:AC5] [FAILURE] The hold fixture could not be placed: %', result;
  end if;
  held := (result->'hold'->>'request_id')::bigint;
  perform set_config('request.jwt.claim.sub', 'e8200000-0000-4000-8000-000000000002', true);
  result := public.withdraw_venue_booking_request(held);
  if result->>'outcome' <> 'hold' or (select status from public.venue_booking_requests where request_id = held) <> 'pending' then
    raise exception '[SG2-82:hold-not-withdrawn] [SG2-82:AC5] [BOUNDARY] A tentative hold''s request was withdrawn instead of released: %', result;
  end if;
end $$;

-- 8. Confirming the event (SG2-58) waits until every venue it needs is
-- approved: a rejected venue blocks it until the coordinator withdraws it.
insert into public.events (event_id, organiser_id, coordinator_id, name, status, registration_needed) values
  (98203, 'e8200000-0000-4000-8000-000000000003', 'e8200000-0000-4000-8000-000000000002', 'Multi Gala', 'preparation', false);
insert into public.venue_bookings (booking_id, venue_id, event_id, starts_at, ends_at, status) values
  (98203, 98201, 98203, '2030-10-05 01:00+00', '2030-10-05 05:00+00', 'confirmed');
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, layout, requested_by,
    status, decided_by, decided_at, decision_reason, venue_booking_id) values
  (98205, 98203, 98201, '2030-10-05 01:00+00', '2030-10-05 05:00+00', 'theatre', 'e8200000-0000-4000-8000-000000000002',
    'approved', 'e8200000-0000-4000-8000-000000000001', now(), null, 98203),
  (98206, 98203, 98203, '2030-10-05 01:00+00', '2030-10-05 05:00+00', 'classroom', 'e8200000-0000-4000-8000-000000000002',
    'rejected', 'e8200000-0000-4000-8000-000000000001', now(), 'Room closed for repairs', null);
select set_config('request.jwt.claim.sub', 'e8200000-0000-4000-8000-000000000002', true);
do $$
declare result jsonb;
begin
  result := public.confirm_event(98203);
  if result is distinct from '{"outcome":"outstanding","outstanding":["venue"]}'::jsonb
      or (select status from public.events where event_id = 98203) <> 'preparation' then
    raise exception '[SG2-82:rejected-venue-blocks-confirmation] [SG2-82:AC5] [CONFLICT] An event with one venue approved and another rejected was confirmed: %', result;
  end if;
  if public.withdraw_venue_booking_request(98206)->>'outcome' <> 'withdrawn' then
    raise exception '[SG2-82:withdraw-before-confirming] [SG2-82:AC5] [NORMAL] The coordinator could not withdraw the rejected venue';
  end if;
  result := public.confirm_event(98203);
  if result->>'outcome' <> 'ok' or (select status from public.events where event_id = 98203) <> 'confirmed' then
    raise exception '[SG2-82:confirm-once-every-venue-approved] [SG2-82:AC5] [NORMAL] Once the rejected venue was withdrawn, the event with every needed venue approved must confirm: %', result;
  end if;
end $$;

-- 9. Direct writes cannot mark a live request withdrawn:
reset role;
do $$
begin
  begin
    update public.venue_booking_requests set withdrawn_at = now() where request_id = 98201;
    raise exception '[SG2-82:withdrawn-must-be-cancelled] [SG2-82:AC5] [FAILURE] An approved request was marked withdrawn';
  exception when check_violation then null;
  end;
end $$;

-- 10. Clients cannot withdraw by writing the table, nor anonymously:
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e8200000-0000-4000-8000-000000000002', true);
do $$
begin
  begin
    update public.venue_booking_requests set status = 'cancelled' where request_id = 98201;
    raise exception '[SG2-82:no-direct-withdrawal] [SG2-82:AC5] [FAILURE] A client cancelled a venue request directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role anon;
do $$
begin
  begin
    perform public.withdraw_venue_booking_request(98201);
    raise exception '[SG2-82:anonymous-refused] [SG2-82:AC5] [FAILURE] An anonymous caller ran the withdrawal';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
