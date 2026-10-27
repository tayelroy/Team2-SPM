-- SG2-63: disposable rollback tests for the registration picture and the
-- organiser's registration settings.
begin;
insert into auth.users(id, email) values
 ('e6300000-0000-4000-8000-000000000001', 'owner@reg.test'),
 ('e6300000-0000-4000-8000-000000000002', 'colleague@reg.test'),
 ('e6300000-0000-4000-8000-000000000003', 'outsider@reg.test'),
 ('e6300000-0000-4000-8000-000000000004', 'coordinator@reg.test'),
 ('e6300000-0000-4000-8000-000000000005', 'ana@attendee.test'),
 ('e6300000-0000-4000-8000-000000000006', 'ben@attendee.test'),
 ('e6300000-0000-4000-8000-000000000007', 'cai@attendee.test');
insert into public.users(user_id, name, organisation, role_id, phone) values
 ('e6300000-0000-4000-8000-000000000001', 'Reg owner', 'Reg org', 1, null),
 ('e6300000-0000-4000-8000-000000000002', 'Reg colleague', 'Reg org', 1, null),
 ('e6300000-0000-4000-8000-000000000003', 'Reg outsider', 'Other org', 1, null),
 ('e6300000-0000-4000-8000-000000000004', 'Reg coordinator', null, 1, null),
 ('e6300000-0000-4000-8000-000000000005', 'Ana Attendee', 'Guests Ltd', 1, '+65 6000 0001'),
 ('e6300000-0000-4000-8000-000000000006', 'Ben Attendee', null, 1, null),
 ('e6300000-0000-4000-8000-000000000007', 'Cai Attendee', null, 1, null);
insert into public.account_roles(user_id, role) values
 ('e6300000-0000-4000-8000-000000000001', 'event_organiser'),
 ('e6300000-0000-4000-8000-000000000002', 'event_organiser'),
 ('e6300000-0000-4000-8000-000000000003', 'event_organiser'),
 ('e6300000-0000-4000-8000-000000000004', 'event_coordinator'),
 ('e6300000-0000-4000-8000-000000000005', 'attendee'),
 ('e6300000-0000-4000-8000-000000000006', 'attendee'),
 ('e6300000-0000-4000-8000-000000000007', 'attendee');
-- 96301 planning, 96302 confirmed and open, 96303 cancelled, 96304 no
-- registration, 96305 already started, 96306 confirmed and not yet open,
-- 96307 confirmed and past its closing time with no coordinator (only the
-- organiser is told; SG2-104 forbids organising and coordinating the same
-- event), 96308 planning inside its window.
insert into public.events(event_id, organiser_id, coordinator_id, organisation, status, name, proposed_date,
  registration_needed, registration_capacity, registration_opens_at, registration_closes_at) values
 (96301, 'e6300000-0000-4000-8000-000000000001', 'e6300000-0000-4000-8000-000000000004', 'Reg org', 'planning',
  'Planning forum', now() + interval '30 days', true, null, null, null),
 (96302, 'e6300000-0000-4000-8000-000000000001', 'e6300000-0000-4000-8000-000000000004', 'Reg org', 'confirmed',
  'Open forum', now() + interval '30 days', true, 2, now() - interval '1 day', now() + interval '10 days'),
 (96303, 'e6300000-0000-4000-8000-000000000001', null, 'Reg org', 'cancelled',
  'Cancelled forum', now() + interval '30 days', true, 10, null, null),
 (96304, 'e6300000-0000-4000-8000-000000000001', null, 'Reg org', 'planning',
  'Walk-in forum', now() + interval '30 days', false, null, null, null),
 (96305, 'e6300000-0000-4000-8000-000000000001', null, 'Reg org', 'confirmed',
  'Started forum', now() - interval '1 hour', true, 10, now() - interval '3 days', now() - interval '2 hours'),
 (96306, 'e6300000-0000-4000-8000-000000000001', 'e6300000-0000-4000-8000-000000000004', 'Reg org', 'confirmed',
  '', now() + interval '30 days', true, 10, now() + interval '2 days', now() + interval '9 days'),
 (96307, 'e6300000-0000-4000-8000-000000000001', null, 'Reg org', 'confirmed',
  'Closed forum', now() + interval '30 days', true, 10, now() - interval '5 days', now() - interval '1 day'),
 (96308, 'e6300000-0000-4000-8000-000000000001', 'e6300000-0000-4000-8000-000000000004', 'Reg org', 'planning',
  'Unconfirmed forum', now() + interval '30 days', true, 10, now() - interval '1 day', now() + interval '9 days');
-- What was announced when it happened: the open event's opening and the
-- started event's closing.
update public.events set registration_announced = 'open' where event_id = 96302;
update public.events set registration_announced = 'closed' where event_id = 96305;
insert into public.registrations(event_id, attendee_id, status, registered_at) values
 (96302, 'e6300000-0000-4000-8000-000000000006', 'registered', now() - interval '2 hours'),
 (96302, 'e6300000-0000-4000-8000-000000000005', 'registered', now() - interval '3 hours'),
 (96302, 'e6300000-0000-4000-8000-000000000007', 'cancelled', now() - interval '4 hours');
insert into public.venues(venue_id, name, capacity) values
 (96351, 'Reg hall', 120), (96352, 'Reg annex', 40), (96353, 'Reg dropped room', 999);
insert into public.venue_booking_requests(event_id, venue_id, starts_at, ends_at, status) values
 (96302, 96351, now() + interval '30 days', now() + interval '30 days 3 hours', 'approved'),
 (96302, 96352, now() + interval '30 days', now() + interval '30 days 3 hours', 'pending'),
 (96302, 96353, now() + interval '30 days', now() + interval '30 days 3 hours', 'rejected');

do $$
declare
  owner constant uuid := 'e6300000-0000-4000-8000-000000000001';
  colleague constant uuid := 'e6300000-0000-4000-8000-000000000002';
  outsider constant uuid := 'e6300000-0000-4000-8000-000000000003';
  coordinator constant uuid := 'e6300000-0000-4000-8000-000000000004';
  overview jsonb;
  result jsonb;
  invalid jsonb;
  opens_at text := to_char((now() + interval '3 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  closes_at text := to_char((now() + interval '20 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  audit_count integer;
  announced integer;
begin
  -- AC1, AC2, AC4, AC7: the picture.
  overview := public.event_registration_overview(96302);
  if jsonb_array_length(overview -> 'attendees') is distinct from 2
      or overview #>> '{attendees,0,name}' is distinct from 'Ana Attendee'
      or overview #>> '{attendees,0,email}' is distinct from 'ana@attendee.test'
      or overview #>> '{attendees,0,phone}' is distinct from '+65 6000 0001'
      or overview #>> '{attendees,1,name}' is distinct from 'Ben Attendee'
      or (overview #>> '{event,registration_capacity}')::integer is distinct from 2 then
    raise exception '[SG2-63:overview-registered] [NORMAL] [SG2-63:AC1] [SG2-63:AC2] Only active registrations are listed, earliest first, with contact details for the server to filter: %', overview;
  end if;
  if overview -> 'venues' is distinct from
      '[{"venue_id": 96351, "name": "Reg hall", "capacity": 120}, {"venue_id": 96352, "name": "Reg annex", "capacity": 40}]'::jsonb then
    raise exception '[SG2-63:overview-venues] [NORMAL] [SG2-63:AC7] Only venues with a pending or approved booking are compared: %', overview -> 'venues';
  end if;
  if public.event_registration_overview(96301) -> 'attendees' is distinct from '[]'::jsonb
      or public.event_registration_overview(96301) -> 'venues' is distinct from '[]'::jsonb then
    raise exception '[SG2-63:overview-empty] [BOUNDARY] [SG2-63:AC1] An event with no registrations or bookings reads empty lists';
  end if;
  if public.event_registration_overview(96399) is not null then
    raise exception '[SG2-63:overview-missing] [FAILURE] [SG2-63:AC3] A missing event reads nothing';
  end if;

  -- AC5, AC9: the organiser sets the settings while planning.
  result := public.update_registration_settings(96301, owner, jsonb_build_object(
    'registration_capacity', 150, 'registration_opens_at', opens_at, 'registration_closes_at', closes_at), false);
  if result ->> 'outcome' is distinct from 'ok'
      or (select registration_capacity from public.events where event_id = 96301) is distinct from 150
      or (select registration_opens_at from public.events where event_id = 96301) is distinct from opens_at::timestamptz
      or (select registration_closes_at from public.events where event_id = 96301) is distinct from closes_at::timestamptz then
    raise exception '[SG2-63:settings-set] [NORMAL] [SG2-63:AC5] The organiser sets capacity, opening and closing times: %', result;
  end if;
  if (select count(*) from public.event_audit_logs where event_id = 96301 and actor_id = owner and old_value is null
      and (field_name, new_value) in (('registration_capacity', '150'),
        ('registration_opens_at', to_char(opens_at::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
        ('registration_closes_at', to_char(closes_at::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))) <> 3 then
    raise exception '[SG2-63:settings-history] [NORMAL] [SG2-63:AC9] Each setting changed is recorded with who changed it';
  end if;
  result := public.update_registration_settings(96301, owner, '{"registration_capacity": 150}', false);
  select count(*) into audit_count from public.event_audit_logs where event_id = 96301;
  if result -> 'changed' is distinct from '[]'::jsonb or audit_count <> 3 then
    raise exception '[SG2-63:settings-unchanged] [BOUNDARY] [SG2-63:AC9] Saving the same value records nothing new';
  end if;
  result := public.update_registration_settings(96301, owner, '{"registration_capacity": 151}', false);
  if result -> 'changed' is distinct from '["registration_capacity"]'::jsonb or not exists(
      select 1 from public.event_audit_logs where event_id = 96301 and field_name = 'registration_capacity'
        and old_value = '150' and new_value = '151') then
    raise exception '[SG2-63:settings-history-old] [NORMAL] [SG2-63:AC9] A change keeps the value it replaced';
  end if;
  -- 96308 is in Planning but inside its window: registration is not open to attendees yet.
  result := public.update_registration_settings(96308, owner, '{"registration_capacity": 12}', false);
  if result ->> 'outcome' is distinct from 'ok'
      or exists(select 1 from public.notifications where event_id in (96301, 96308))
      or (select registration_announced from public.events where event_id = 96308) is not null then
    raise exception '[SG2-63:planning-no-notice] [BOUNDARY] [SG2-63:AC10] Settings on an unconfirmed event announce nothing';
  end if;

  -- AC7: above every booked venue's capacity is allowed (the server warns).
  result := public.update_registration_settings(96302, owner, '{"registration_capacity": 500}', false);
  if result ->> 'outcome' is distinct from 'ok' or (select registration_capacity from public.events where event_id = 96302) IS DISTINCT FROM 500 then
    raise exception '[SG2-63:capacity-above-venue] [BOUNDARY] [SG2-63:AC5] [SG2-63:AC7] A confirmed event takes a capacity above its venues';
  end if;

  -- Once confirmed, a setting cannot be cleared (that would end registration
  -- with no notice); before confirmation it can (96308, in Planning).
  foreach invalid in array array['{"registration_capacity": null}'::jsonb, '{"registration_opens_at": null}',
      '{"registration_closes_at": null}'] loop
    if public.update_registration_settings(96302, owner, invalid, false) ->> 'outcome' is distinct from 'invalid' then
      raise exception '[SG2-63:confirmed-not-cleared] [FAILURE] [SG2-63:AC10] % must be refused on a confirmed event', invalid;
    end if;
  end loop;
  if (select registration_closes_at from public.events where event_id = 96302) is null
      or public.update_registration_settings(96308, owner, '{"registration_capacity": null}', false) ->> 'outcome' is distinct from 'ok'
      or public.update_registration_settings(96308, owner, '{"registration_capacity": 12}', false) ->> 'outcome' is distinct from 'ok' then
    raise exception '[SG2-63:planning-may-clear] [BOUNDARY] [SG2-63:AC5] Before confirmation a setting can still be cleared';
  end if;

  -- Nobody already registered loses their place: 96302 holds two.
  if public.update_registration_settings(96302, owner, '{"registration_capacity": 1}', false)
      is distinct from '{"outcome": "below_registered", "registered": 2}'::jsonb
      or (select registration_capacity from public.events where event_id = 96302) IS DISTINCT FROM 500
      or public.update_registration_settings(96302, owner, '{"registration_capacity": 2}', false) ->> 'outcome' is distinct from 'ok'
      or public.update_registration_settings(96302, owner, '{"registration_capacity": 500}', false) ->> 'outcome' is distinct from 'ok' then
    raise exception '[SG2-63:capacity-not-below-registered] [BOUNDARY] [SG2-63:AC5] Capacity can come down to the registered count but not below it';
  end if;

  -- AC3, AC5, AC8: only the creating organiser.
  foreach invalid in array array[to_jsonb(colleague), to_jsonb(outsider), to_jsonb(coordinator)] loop
    result := public.update_registration_settings(96301, (invalid #>> '{}')::uuid, '{"registration_capacity": 9}', false);
    if result ->> 'outcome' is distinct from 'missing' then
      raise exception '[SG2-63:settings-only-owner] [FAILURE] [SG2-63:AC8] % must not change the settings', invalid;
    end if;
  end loop;
  if public.update_registration_settings(96301, null, '{"registration_capacity": 9}', false) ->> 'outcome' is distinct from 'missing'
      or public.update_registration_settings(96399, owner, '{"registration_capacity": 9}', false) ->> 'outcome' is distinct from 'missing' then
    raise exception '[SG2-63:settings-missing] [FAILURE] [SG2-63:AC5] No actor or a missing event reads as missing';
  end if;
  if public.update_registration_settings(96303, owner, '{"registration_capacity": 9}', false)
      is distinct from '{"outcome": "closed", "status": "cancelled"}'::jsonb then
    raise exception '[SG2-63:settings-terminal] [CONFLICT] [SG2-63:AC5] A cancelled event keeps its settings';
  end if;
  if public.update_registration_settings(96304, owner, '{"registration_capacity": 9}', false) ->> 'outcome' is distinct from 'not_needed' then
    raise exception '[SG2-63:settings-not-needed] [CONFLICT] [SG2-63:AC5] An event without registration has no settings';
  end if;
  if public.update_registration_settings(96305, owner, '{"registration_capacity": 9}', false) ->> 'outcome' is distinct from 'started'
      or public.update_registration_settings(96305, owner, '{}', true) ->> 'outcome' is distinct from 'started' then
    raise exception '[SG2-63:settings-started] [BOUNDARY] [SG2-63:AC5] Settings are refused once the event has started';
  end if;
  if (select registration_capacity from public.events where event_id = 96301) IS DISTINCT FROM 151 then
    raise exception '[SG2-63:settings-refused-no-write] [FAILURE] [SG2-63:AC8] A refused change writes nothing';
  end if;

  foreach invalid in array array[
    '{}'::jsonb, '{"registration_capacity": 0}', '{"registration_capacity": 1.5}', '{"registration_capacity": "9"}',
    '{"registration_capacity": 2147483648}', '{"planning_notes": "x"}', '{"registration_opens_at": "soon"}',
    '{"registration_closes_at": 5}',
    jsonb_build_object('registration_closes_at', opens_at, 'registration_opens_at', closes_at),
    jsonb_build_object('registration_closes_at', to_char((now() - interval '1 minute') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    jsonb_build_object('registration_closes_at', to_char((now() + interval '31 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))] loop
    if public.update_registration_settings(96301, owner, invalid, false) ->> 'outcome' is distinct from 'invalid' then
      raise exception '[SG2-63:settings-invalid] [FAILURE] [SG2-63:AC5] % must be refused', invalid;
    end if;
  end loop;
  -- Open since yesterday, so only the rule that a new closing time is in the future refuses this.
  if public.update_registration_settings(96302, owner, jsonb_build_object('registration_closes_at',
      to_jsonb(now() - interval '1 minute')), false) ->> 'outcome' is distinct from 'invalid' then
    raise exception '[SG2-63:closes-in-past] [BOUNDARY] [SG2-63:AC6] A new closing time already past is refused; closing now is its own action';
  end if;
  if public.update_registration_settings(96302, owner, '{"registration_capacity": 3}', true) ->> 'outcome' is distinct from 'invalid' then
    raise exception '[SG2-63:close-now-alone] [FAILURE] [SG2-63:AC6] Closing now carries no other change';
  end if;
  select count(*) into audit_count from public.event_audit_logs where event_id = 96301;
  if audit_count <> 4 or (select registration_capacity from public.events where event_id = 96301) IS DISTINCT FROM 151 then
    raise exception '[SG2-63:settings-invalid-no-write] [FAILURE] [SG2-63:AC5] A refused change writes nothing';
  end if;
  if public.update_registration_settings(96301, owner, jsonb_build_object('registration_closes_at',
      to_jsonb(now() + interval '30 days')), false) ->> 'outcome' is distinct from 'invalid' then
    raise exception '[SG2-63:closes-at-start] [BOUNDARY] [SG2-63:AC5] Registration closing as the event starts is refused';
  end if;
  result := public.update_registration_settings(96301, owner, jsonb_build_object('registration_closes_at',
    to_jsonb(now() + interval '30 days' - interval '1 millisecond')), false);
  if result ->> 'outcome' is distinct from 'ok' then
    raise exception '[SG2-63:closes-before-start] [BOUNDARY] [SG2-63:AC5] Registration may close just before the event starts: %', result;
  end if;

  -- AC6, AC10: close early, then reopen; both are announced once.
  result := public.update_registration_settings(96302, owner, '{}', true);
  if result ->> 'outcome' is distinct from 'ok'
      or (select registration_closes_at from public.events where event_id = 96302) > clock_timestamp()
      or (select registration_announced from public.events where event_id = 96302) is distinct from 'closed' then
    raise exception '[SG2-63:close-early] [NORMAL] [SG2-63:AC6] The organiser closes registration now: %', result;
  end if;
  if (select array_agg(recipient_id::text order by recipient_id) from public.notifications
        where event_id = 96302 and kind = 'registration_closed'
          and message = 'Registration for Open forum was closed early by the organiser.')
      is distinct from array[owner::text, coordinator::text] then
    raise exception '[SG2-63:close-early-notice] [NORMAL] [SG2-63:AC10] The organiser and the coordinator are told it closed early';
  end if;
  if public.update_registration_settings(96302, owner, '{}', true) ->> 'outcome' is distinct from 'not_open'
      or public.update_registration_settings(96306, owner, '{}', true) ->> 'outcome' is distinct from 'not_open'
      or public.update_registration_settings(96308, owner, '{}', true) ->> 'outcome' is distinct from 'not_open' then
    raise exception '[SG2-63:close-not-open] [CONFLICT] [SG2-63:AC6] Only open registration can be closed early';
  end if;
  result := public.update_registration_settings(96302, owner, jsonb_build_object('registration_closes_at', closes_at), false);
  if result ->> 'outcome' is distinct from 'ok'
      or (select count(*) from public.notifications where event_id = 96302 and kind = 'registration_opened'
        and message = 'Registration for Open forum is now open.') <> 2 then
    raise exception '[SG2-63:reopen] [NORMAL] [SG2-63:AC6] [SG2-63:AC10] Reopening is announced to both: %', result;
  end if;
  result := public.update_registration_settings(96302, owner, jsonb_build_object('registration_closes_at',
    to_char((now() + interval '25 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), false);
  if result ->> 'outcome' is distinct from 'ok' or (select count(*) from public.notifications where event_id = 96302) <> 4 then
    raise exception '[SG2-63:extend-quiet] [BOUNDARY] [SG2-63:AC6] [SG2-63:AC10] Extending open registration announces nothing new';
  end if;

  -- AC10 on schedule.
  update public.events set registration_announced = null where event_id = 96302;
  announced := public.process_registration_windows();
  if announced <> 2
      or (select count(*) from public.notifications where event_id = 96302 and kind = 'registration_opened') <> 4
      or (select array_agg(recipient_id::text) from public.notifications where event_id = 96307)
        is distinct from array[owner::text]
      or (select message from public.notifications where event_id = 96307) is distinct from 'Registration for Closed forum has closed.' then
    raise exception '[SG2-63:sweep-announces] [NORMAL] [SG2-63:AC10] Scheduled opening and closing are announced, once per person: %', announced;
  end if;
  if public.process_registration_windows() IS DISTINCT FROM 0 or exists(
      select 1 from public.notifications where event_id in (96301, 96304, 96306, 96308)) then
    raise exception '[SG2-63:sweep-once] [BOUNDARY] [SG2-63:AC10] Nothing is announced twice, early, or for an unconfirmed event';
  end if;
  update public.events set registration_opens_at = now() - interval '1 minute' where event_id = 96306;
  perform public.process_registration_windows();
  if (select message from public.notifications where event_id = 96306 limit 1) is distinct from 'Registration for Untitled event is now open.' then
    raise exception '[SG2-63:sweep-untitled] [BOUNDARY] [SG2-63:AC10] An unnamed event is announced as Untitled event';
  end if;

  -- Vocabulary and access.
  insert into public.registrations(event_id, attendee_id) values (96301, 'e6300000-0000-4000-8000-000000000005');
  if (select status from public.registrations where event_id = 96301) is distinct from 'registered'
      or jsonb_array_length(public.event_registration_overview(96301) -> 'attendees') IS DISTINCT FROM 1 then
    raise exception '[SG2-63:registration-default] [BOUNDARY] [SG2-63:AC1] A new registration holds a place';
  end if;
  -- As SG2-66 counts: only a cancelled registration, in any case, gives its place back.
  insert into public.registrations(event_id, attendee_id, status) values
    (96301, 'e6300000-0000-4000-8000-000000000006', null),
    (96301, 'e6300000-0000-4000-8000-000000000007', 'CANCELLED');
  if jsonb_array_length(public.event_registration_overview(96301) -> 'attendees') IS DISTINCT FROM 2 then
    raise exception '[SG2-63:registration-cancelled] [BOUNDARY] [SG2-63:AC1] Any registration not cancelled holds a place, as SG2-66 counts it';
  end if;
  if exists(select 1 from unnest(array['anon', 'authenticated']) role_name
      where has_function_privilege(role_name, 'public.update_registration_settings(integer, uuid, jsonb, boolean)', 'execute')
        or has_function_privilege(role_name, 'public.event_registration_overview(integer)', 'execute')
        or has_function_privilege(role_name, 'public.process_registration_windows()', 'execute')
        or has_function_privilege(role_name, 'public.announce_registration_window(integer, boolean)', 'execute'))
      or has_function_privilege('service_role', 'public.announce_registration_window(integer, boolean)', 'execute') then
    raise exception '[SG2-63:functions-server-only] [FAILURE] [SG2-63:AC3] [SG2-63:AC4] Only the server reads or changes registration settings';
  end if;
end;
$$;
-- Probe the installed notification constraint through real inserts. The literal
-- supported kinds are the oracle; SQL definition formatting is irrelevant.
-- equipment_reserved alone requires a valid reservation receipt.
reset role;
insert into public.equipment(equipment_id,name,quantity_total)
 values(96399,'Notice constraint fixture',1);
insert into public.equipment_reservations(reservation_id,event_id,equipment_id,quantity_reserved)
 values(96399,96301,96399,1);
do $$
declare
 notice_kind text;
 stored_kind text;
 kinds_stored_unchanged boolean := true;
 rejected_constraint text;
 invalid_kind_refused boolean := false;
begin
 foreach notice_kind in array array[
  'venue_request_approved','venue_request_rejected','venue_booking_released','equipment_reserved',
  'venue_booking_clash','event_confirmed','event_submitted','coordinator_assigned','clarification_requested',
  'event_approved','event_rejected','venue_unavailable','event_returned_to_planning','safety_decision',
  'outstanding_arrangements','registration_opened','registration_closed','venue_booking_cancelled',
  'venue_change_requested','cancellation_requested','event_cancelled','registration_confirmed',
  'change_requested','registration_withdrawn'
 ] loop
  insert into public.notifications(recipient_id,event_id,kind,message,equipment_reservation_id)
   values('e6300000-0000-4000-8000-000000000001',96301,notice_kind,'Allowed notification kind',
    case when notice_kind='equipment_reserved' then 96399 else null end)
   returning kind into stored_kind;
  kinds_stored_unchanged := kinds_stored_unchanged and (stored_kind is not distinct from notice_kind);
 end loop;
 begin
  insert into public.notifications(recipient_id,event_id,kind,message)
   values('e6300000-0000-4000-8000-000000000001',96301,'unsupported_notice_kind','Invalid notification kind');
 exception when check_violation then
  get stacked diagnostics rejected_constraint = constraint_name;
  invalid_kind_refused := rejected_constraint is not distinct from 'notifications_kind_check';
 end;
 if not kinds_stored_unchanged or not invalid_kind_refused then
  raise exception '[SG2-63:notice-kinds] [NORMAL] [FAILURE] [SG2-63:AC10] [SG2-66:AC7] [SG2-92:AC5] All supported notice kinds must store unchanged and the kind constraint must reject an unsupported kind';
 end if;
end;
$$;
rollback;
