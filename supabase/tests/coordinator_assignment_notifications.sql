-- Review trace: SG2-88 assign and reassign events as the Event Coordinator Lead.
-- Numeric AC tags follow the SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- SG2-88 AC4: an assignment notifies the new coordinator, the previous coordinator and
-- the organiser. The server writes the notices with the service role; recipients read
-- only their own through row level security.
-- Disposable local/CI test script. All changes are rolled back.
begin;

insert into auth.users (id) values
  ('a8800000-0000-4000-8000-000000000001'), ('a8800000-0000-4000-8000-000000000002'),
  ('a8800000-0000-4000-8000-000000000003'), ('a8800000-0000-4000-8000-000000000004');
insert into public.users (user_id, name, role_id) values
  ('a8800000-0000-4000-8000-000000000001', 'Notice organiser', 1),
  ('a8800000-0000-4000-8000-000000000002', 'New coordinator', 2),
  ('a8800000-0000-4000-8000-000000000003', 'Previous coordinator', 2),
  ('a8800000-0000-4000-8000-000000000004', 'Unrelated coordinator', 2);
insert into public.account_roles (user_id, role) values
  ('a8800000-0000-4000-8000-000000000001', 'event_organiser'),
  ('a8800000-0000-4000-8000-000000000002', 'event_coordinator'),
  ('a8800000-0000-4000-8000-000000000003', 'event_coordinator'),
  ('a8800000-0000-4000-8000-000000000004', 'event_coordinator');
insert into public.events (event_id, organiser_id, coordinator_id, name, status) values
  (98801, 'a8800000-0000-4000-8000-000000000001', 'a8800000-0000-4000-8000-000000000002', 'Notice Summit', 'submitted');

-- 1. Each assignment notice kind is accepted:
do $$
begin
  insert into public.notifications (recipient_id, event_id, kind, message) values
    ('a8800000-0000-4000-8000-000000000002', 98801, 'coordinator_assigned', 'You are now the Event Coordinator for “Notice Summit”.'),
    ('a8800000-0000-4000-8000-000000000003', 98801, 'coordinator_removed', '“Notice Summit” has been reassigned. You are no longer its Event Coordinator.'),
    ('a8800000-0000-4000-8000-000000000001', 98801, 'event_coordinator_changed', 'New coordinator is now the Event Coordinator for “Notice Summit”.');
  if (select count(*) from public.notifications where event_id = 98801) <> 3 then
    raise exception '[SG2-88:notice-kinds-accepted] [SG2-88:AC4] [NORMAL] The three assignment notice kinds were not all stored';
  end if;
end $$;

-- 2. An unknown kind and an empty message are still refused:
do $$
begin
  begin
    insert into public.notifications (recipient_id, event_id, kind, message)
      values ('a8800000-0000-4000-8000-000000000002', 98801, 'coordinator_promoted', 'x');
    raise exception '[SG2-88:unknown-kind-refused] [SG2-88:AC4] [FAILURE] A notice with an unknown kind was stored';
  exception when check_violation then null;
  end;
  begin
    insert into public.notifications (recipient_id, event_id, kind, message)
      values ('a8800000-0000-4000-8000-000000000002', 98801, 'coordinator_assigned', '');
    raise exception '[SG2-88:empty-message-refused] [SG2-88:AC4] [BOUNDARY] A notice with an empty message was stored';
  exception when check_violation then null;
  end;
end $$;

-- 3. The earlier notice kinds still work (SG2-49, SG2-51):
do $$
begin
  insert into public.notifications (recipient_id, event_id, kind, message)
    values ('a8800000-0000-4000-8000-000000000001', 98801, 'venue_booking_released', 'A venue was released.');
  if not exists (select 1 from public.notifications where event_id = 98801 and kind = 'venue_booking_released') then
    raise exception '[SG2-88:earlier-kinds-kept] [SG2-88:AC4] [NORMAL] An earlier notice kind was no longer accepted';
  end if;
end $$;

-- 4. Recipients read only their own notices, and cannot write any:
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a8800000-0000-4000-8000-000000000003', true);
do $$
begin
  if (select count(*) from public.notifications) <> 1
     or not exists (select 1 from public.notifications where kind = 'coordinator_removed') then
    raise exception '[SG2-88:own-notices-only] [SG2-88:AC4] [FAILURE] The previous coordinator did not see exactly their own notice';
  end if;
  begin
    insert into public.notifications (recipient_id, event_id, kind, message)
      values ('a8800000-0000-4000-8000-000000000003', 98801, 'coordinator_assigned', 'Self-issued');
    raise exception '[SG2-88:no-client-writes] [SG2-88:AC4] [FAILURE] A client wrote a notice directly';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', 'a8800000-0000-4000-8000-000000000004', true);
do $$
begin
  if (select count(*) from public.notifications) <> 0 then
    raise exception '[SG2-88:unrelated-sees-nothing] [SG2-88:AC4] [FAILURE] A coordinator unrelated to the event saw its notices';
  end if;
end $$;
reset role;

rollback;
