-- Review trace: SG2-104 one account holding several roles, acting as one role per request.
-- Numeric AC tags follow the SPM Jira criteria; descriptive tags identify supporting contracts.
-- Disposable local/CI test script. All changes are rolled back.
begin;

-- Identities (d1040000-0000-4000-8000-0000000000NN):
-- 01 coordinator + organiser      02 coordinator + attendee
-- 03 venue staff + coordinator    04, 05 technical support staff
-- 06 organiser                    07 event coordinator lead
-- 08 safety officer               09 coordinator
-- 10 all seven roles              11 venue staff
-- 12 a signed-up user with no role
insert into auth.users (id)
  select ('d1040000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 12) n;
insert into public.users (user_id, name, organisation, role_id)
  select ('d1040000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Multi ' || n, 'Acme Corp', 1
  from generate_series(1, 12) n;
insert into public.account_roles (user_id, role) values
  ('d1040000-0000-4000-8000-000000000001', 'event_coordinator'),
  ('d1040000-0000-4000-8000-000000000001', 'event_organiser'),
  ('d1040000-0000-4000-8000-000000000002', 'event_coordinator'),
  ('d1040000-0000-4000-8000-000000000002', 'attendee'),
  ('d1040000-0000-4000-8000-000000000003', 'venue_staff'),
  ('d1040000-0000-4000-8000-000000000003', 'event_coordinator'),
  ('d1040000-0000-4000-8000-000000000004', 'technical_support_staff'),
  ('d1040000-0000-4000-8000-000000000005', 'technical_support_staff'),
  ('d1040000-0000-4000-8000-000000000006', 'event_organiser'),
  ('d1040000-0000-4000-8000-000000000007', 'event_coordinator_lead'),
  ('d1040000-0000-4000-8000-000000000008', 'safety_officer'),
  ('d1040000-0000-4000-8000-000000000009', 'event_coordinator'),
  ('d1040000-0000-4000-8000-000000000011', 'venue_staff');
insert into public.account_roles (user_id, role)
  select 'd1040000-0000-4000-8000-000000000010', role
  from unnest(array['event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff',
    'attendee', 'event_coordinator_lead', 'safety_officer']) role;

-- Events: 104001 coordinated by 03; 104002 by 09; 104003 organised by 01;
-- 104004 and 104005 coordinated by 01; 104006 is 01's draft; 104007 is at its safety check.
insert into public.events (event_id, organiser_id, coordinator_id, organisation, name, status, expected_attendance) values
  (104001, 'd1040000-0000-4000-8000-000000000006', 'd1040000-0000-4000-8000-000000000003', 'Acme Corp', 'Venue-run forum', 'planning', 50),
  (104002, 'd1040000-0000-4000-8000-000000000006', 'd1040000-0000-4000-8000-000000000009', 'Acme Corp', 'Other forum', 'planning', 50),
  (104003, 'd1040000-0000-4000-8000-000000000001', 'd1040000-0000-4000-8000-000000000009', 'Acme Corp', 'Own forum', 'approved', 50),
  (104004, 'd1040000-0000-4000-8000-000000000006', 'd1040000-0000-4000-8000-000000000001', 'Acme Corp', 'Ready forum', 'preparation', 50),
  (104005, 'd1040000-0000-4000-8000-000000000006', 'd1040000-0000-4000-8000-000000000001', 'Acme Corp', 'Kit forum', 'planning', 50),
  (104006, 'd1040000-0000-4000-8000-000000000001', null, 'Acme Corp', 'Draft forum', 'draft', 50),
  (104007, 'd1040000-0000-4000-8000-000000000006', 'd1040000-0000-4000-8000-000000000009', 'Acme Corp', 'Safety forum', 'awaiting_safety_check', 50);
-- SG2-94: an event in Preparation holds the Safety Officer's approval.
insert into public.event_safety_decisions (event_id, decision, decided_by)
  values (104004, 'approve', 'd1040000-0000-4000-8000-000000000008');
insert into public.venues (venue_id, name, capacity) values (104, 'Multi Hall', 100);
insert into public.venue_bookings (booking_id, venue_id, event_id, starts_at, ends_at, status) values
  (104101, 104, 104002, '2031-01-10T02:00Z', '2031-01-10T04:00Z', 'confirmed'),
  (104102, 104, 104001, '2031-01-11T02:00Z', '2031-01-11T04:00Z', 'confirmed');
-- 104201 was raised by account 03 as 104001's coordinator; 104202 by 09.
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, layout, requested_by) values
  (104201, 104001, 104, '2031-02-01T02:00Z', '2031-02-01T04:00Z', 'theatre', 'd1040000-0000-4000-8000-000000000003'),
  (104202, 104002, 104, '2031-02-02T02:00Z', '2031-02-02T04:00Z', 'theatre', 'd1040000-0000-4000-8000-000000000009');
insert into public.equipment (equipment_id, name, description, quantity_total, location)
  values (104, 'Multi mic', 'Handheld microphone', 4, 'Store A');
insert into public.equipment_requests (request_id, event_id, equipment_id, quantity, starts_at, ends_at)
  values (104301, 104005, 104, 1, '2031-03-01T02:00Z', '2031-03-01T04:00Z');
insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value) values
  (104001, 'd1040000-0000-4000-8000-000000000006', 'name', 'Draft', 'Venue-run forum'),
  (104002, 'd1040000-0000-4000-8000-000000000006', 'name', 'Draft', 'Other forum'),
  (104003, 'd1040000-0000-4000-8000-000000000001', 'name', 'Draft', 'Own forum'),
  (104003, 'd1040000-0000-4000-8000-000000000009', 'planning_notes', null, 'Coordinator-only note'),
  (104005, 'd1040000-0000-4000-8000-000000000006', 'name', 'Draft', 'Kit forum'),
  (104006, 'd1040000-0000-4000-8000-000000000001', 'name', null, 'Draft forum'),
  (104007, 'd1040000-0000-4000-8000-000000000006', 'name', 'Draft', 'Safety forum');

-- 1. AC1: an account stores several of the seven roles, each at most once.
do $$
begin
  if (select array_agg(role order by role) from public.account_roles
      where user_id = 'd1040000-0000-4000-8000-000000000001')
      is distinct from array['event_coordinator', 'event_organiser'] then
    raise exception '[SG2-104:two-roles-stored] [SG2-104:AC1] [NORMAL] An account must keep both of its roles';
  end if;
  if (select count(*) from public.account_roles where user_id = 'd1040000-0000-4000-8000-000000000010') <> 7 then
    raise exception '[SG2-104:all-seven-roles-stored] [SG2-104:AC1] [BOUNDARY] An account must be able to hold all seven roles';
  end if;
  begin
    insert into public.account_roles values ('d1040000-0000-4000-8000-000000000001', 'event_organiser');
    raise exception '[SG2-104:duplicate-role-refused] [SG2-104:AC1] [BOUNDARY] An account held the same role twice';
  exception when unique_violation then null;
  end;
  begin
    insert into public.account_roles values ('d1040000-0000-4000-8000-000000000010', 'administrator');
    raise exception '[SG2-104:eighth-role-refused] [SG2-104:AC1] [BOUNDARY] A role outside the seven was stored';
  exception when check_violation then null;
  end;
end $$;

-- 2. AC3/AC2: a signed-in account reads exactly its own roles and cannot add one.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1040000-0000-4000-8000-000000000001', true);
do $$
begin
  if (select array_agg(role order by role) from public.account_roles)
      is distinct from array['event_coordinator', 'event_organiser'] then
    raise exception '[SG2-104:own-roles-visible] [SG2-104:AC3] [NORMAL] An account must read every role it holds and no one else''s';
  end if;
  begin
    insert into public.account_roles values ('d1040000-0000-4000-8000-000000000001', 'venue_staff');
    raise exception '[SG2-104:self-add-refused-direct] [SG2-104:AC2] [FAILURE] An account added a role to itself';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 3. acting_role(): the X-Acting-Role header, checked against the caller's own roles.
do $$
declare
  value text;
begin
  perform set_config('request.headers', '{"x-acting-role":"event_coordinator"}', true);
  if public.acting_role() is distinct from 'event_coordinator'
      or public.lock_acting_role() is distinct from 'event_coordinator' then
    raise exception '[SG2-104:acting-role-selects-held] [SG2-104:AC1] [NORMAL] A held role named in the header must be the acting role';
  end if;
  perform set_config('request.headers', '{"x-acting-role":"event_organiser"}', true);
  if public.acting_role() is distinct from 'event_organiser' then
    raise exception '[SG2-104:acting-role-switches] [SG2-104:AC1] [NORMAL] Naming the other held role must switch the acting role';
  end if;
  perform set_config('request.headers', '{"x-acting-role":"venue_staff"}', true);
  if public.acting_role() is not null or public.lock_acting_role() is not null then
    raise exception '[SG2-104:header-spoof-refused] [SG2-104:AC2] [FAILURE] A role the account does not hold must never become its acting role';
  end if;
  foreach value in array array['Event_Coordinator', ' event_coordinator', 'event_coordinator ', 'event_coordinators', 'coordinator', ''] loop
    perform set_config('request.headers', jsonb_build_object('x-acting-role', value)::text, true);
    if public.acting_role() is not null then
      raise exception '[SG2-104:header-exact-match] [SG2-104:AC2] [FAILURE] Header value "%" must not match a held role', value;
    end if;
  end loop;
  perform set_config('request.headers', '{}', true);
  if public.acting_role() is not null then
    raise exception '[SG2-104:multi-role-requires-header] [SG2-104:AC1] [BOUNDARY] With several roles and no header the database must not guess';
  end if;
  perform set_config('request.headers', 'not json', true);
  if public.acting_role() is not null or public.lock_acting_role() is not null then
    raise exception '[SG2-104:malformed-headers] [SG2-104:AC2] [BOUNDARY] Malformed request headers must give no acting role';
  end if;

  perform set_config('request.jwt.claim.sub', 'd1040000-0000-4000-8000-000000000011', true);
  perform set_config('request.headers', '', true);
  if public.acting_role() is distinct from 'venue_staff' then
    raise exception '[SG2-104:single-role-fallback] [SG2-104:AC4] [BOUNDARY] A single-role account must act as its role without a header';
  end if;
  perform set_config('request.headers', '{"x-acting-role":"event_coordinator"}', true);
  if public.acting_role() is not null then
    raise exception '[SG2-104:single-role-spoof-refused] [SG2-104:AC4] [FAILURE] A single-role account must not act as a role it lacks';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.headers', '{"x-acting-role":"venue_staff"}', true);
  if public.acting_role() is not null then
    raise exception '[SG2-104:anonymous-acting-role] [SG2-104:AC2] [FAILURE] An anonymous caller must have no acting role';
  end if;
end $$;

-- A role removed mid-session stops being usable on the very next call.
reset role;
delete from public.account_roles
  where user_id = 'd1040000-0000-4000-8000-000000000001' and role = 'event_coordinator';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1040000-0000-4000-8000-000000000001', true);
do $$
begin
  perform set_config('request.headers', '{"x-acting-role":"event_coordinator"}', true);
  if public.acting_role() is not null then
    raise exception '[SG2-104:removed-role-not-acting] [SG2-104:AC2] [CONFLICT] A role removed from the account must not stay its acting role';
  end if;
  perform set_config('request.headers', '', true);
  if public.acting_role() is distinct from 'event_organiser' then
    raise exception '[SG2-104:removed-role-falls-back] [SG2-104:AC4] [CONFLICT] An account left with one role must act as it without a header';
  end if;
end $$;
reset role;
insert into public.account_roles values ('d1040000-0000-4000-8000-000000000001', 'event_coordinator');

-- 4. AC2: every function that reads the caller's role acts as the acting role,
-- and the per-event checks of that role still apply.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1040000-0000-4000-8000-000000000003', true);
do $$
declare
  result jsonb;
begin
  -- Account 03 coordinates 104001, not 104002 (booking 104101).
  perform set_config('request.headers', '{"x-acting-role":"event_coordinator"}', true);
  result := public.release_venue_booking(104101, 'Room no longer needed');
  if result ->> 'outcome' is distinct from 'missing'
      or (select status from public.venue_bookings where booking_id = 104101) <> 'confirmed' then
    raise exception '[SG2-104:release-scoped-by-acting-role] [SG2-104:AC2] [FAILURE] Acting as coordinator must only release bookings of assigned events: %', result;
  end if;
  perform set_config('request.headers', '{"x-acting-role":"attendee"}', true);
  begin
    perform public.release_venue_booking(104101, 'Room no longer needed');
    raise exception '[SG2-104:release-unheld-role-refused] [SG2-104:AC2] [FAILURE] Acting as a role not held must be refused';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.headers', '{"x-acting-role":"venue_staff"}', true);
  result := public.release_venue_booking(104101, 'Room no longer needed');
  if result ->> 'outcome' is distinct from 'released' then
    raise exception '[SG2-104:release-as-venue-staff] [SG2-104:AC1] [NORMAL] Acting as Venue Staff must release any booking: %', result;
  end if;
end $$;

select set_config('request.jwt.claim.sub', 'd1040000-0000-4000-8000-000000000002', true);
do $$
begin
  perform set_config('request.headers', '{"x-acting-role":"attendee"}', true);
  begin
    perform public.list_venue_holds();
    raise exception '[SG2-104:holds-list-acting-role] [SG2-104:AC2] [FAILURE] Acting as Attendee must not list venue holds';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.headers', '{"x-acting-role":"event_coordinator"}', true);
  if jsonb_typeof(public.list_venue_holds()) is distinct from 'array' then
    raise exception '[SG2-104:holds-list-as-coordinator] [SG2-104:AC1] [NORMAL] Acting as coordinator must list venue holds';
  end if;
end $$;

select set_config('request.jwt.claim.sub', 'd1040000-0000-4000-8000-000000000001', true);
do $$
declare
  result jsonb;
begin
  perform set_config('request.headers', '{"x-acting-role":"event_organiser"}', true);
  begin
    perform public.manage_equipment_requirements('read', 104005);
    raise exception '[SG2-104:requirements-acting-role] [SG2-104:AC2] [FAILURE] Acting as organiser must not read equipment requirements';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.manage_equipment_reservations('read', 104005);
    raise exception '[SG2-104:reservations-acting-role] [SG2-104:AC2] [FAILURE] Acting as organiser must not read equipment reservations';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.confirm_event(104004);
    raise exception '[SG2-104:confirm-acting-role] [SG2-104:AC2] [FAILURE] Acting as organiser must not confirm an event';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.headers', '{"x-acting-role":"event_coordinator"}', true);
  result := public.manage_equipment_requirements('read', 104005);
  if (result ->> 'can_request')::boolean is distinct from true then
    raise exception '[SG2-104:requirements-as-coordinator] [SG2-104:AC1] [NORMAL] Acting as the assigned coordinator must request equipment: %', result;
  end if;
  result := public.confirm_event(104004);
  if result ->> 'outcome' is distinct from 'outstanding' or result -> 'outstanding' <> '["venue"]'::jsonb then
    raise exception '[SG2-104:confirm-as-coordinator] [SG2-104:AC1] [NORMAL] Acting as the assigned coordinator must reach the confirmation check: %', result;
  end if;
end $$;

-- update_event_request_draft() is service-only: the actor must hold event_organiser.
reset role;
do $$
declare
  result jsonb;
begin
  result := public.update_event_request_draft(104006, 'd1040000-0000-4000-8000-000000000001', '{"name":"Renamed draft"}');
  if result ->> 'outcome' is distinct from 'updated' then
    raise exception '[SG2-104:draft-save-multi-role-organiser] [SG2-104:AC1] [NORMAL] An organiser who also coordinates must save their own draft: %', result;
  end if;
  result := public.update_event_request_draft(104006, 'd1040000-0000-4000-8000-000000000002', '{"name":"Taken over"}');
  if result ->> 'outcome' is distinct from 'not_found' then
    raise exception '[SG2-104:draft-save-needs-organiser] [SG2-104:AC2] [FAILURE] An account without the organiser role must not save a draft: %', result;
  end if;
end $$;

-- 5. Separation of duties.
-- (a) An event's own organiser is never its coordinator.
do $$
begin
  begin
    update public.events set coordinator_id = organiser_id where event_id = 104003;
    raise exception '[SG2-104:organiser-not-coordinator] [SG2-104:AC2] [FAILURE] An event''s organiser was made its coordinator';
  exception when check_violation then null;
  end;
  update public.events set coordinator_id = null where event_id = 104003;
  update public.events set coordinator_id = 'd1040000-0000-4000-8000-000000000009' where event_id = 104003;
  if (select coordinator_id from public.events where event_id = 104003) <> 'd1040000-0000-4000-8000-000000000009' then
    raise exception '[SG2-104:other-coordinator-allowed] [SG2-104:AC2] [BOUNDARY] No coordinator, or someone other than the organiser, must stay allowed';
  end if;
end $$;

-- Deciding needs Venue Staff as the acting role, not just a held one.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1040000-0000-4000-8000-000000000003', true);
do $$
declare
  header text;
  refused integer := 0;
begin
  foreach header in array array['{"x-acting-role":"event_coordinator"}', '{}'] loop
    perform set_config('request.headers', header, true);
    begin
      perform public.decide_venue_booking_request(104202, 'reject', 'Hall closed');
    exception when insufficient_privilege then
      refused := refused + 1;
    end;
  end loop;
  if refused <> 2 then
    raise exception '[SG2-104:decide-needs-acting-venue-staff] [SG2-104:AC2] [FAILURE] Holding Venue Staff while acting as another role, or with no acting role, must not decide a venue request; % of 2 refused', refused;
  end if;
end $$;

-- (b) Venue Staff never decide a venue request they raised themselves.
select set_config('request.headers', '{"x-acting-role":"venue_staff"}', true);
do $$
declare
  result jsonb;
begin
  result := public.decide_venue_booking_request(104201, 'reject', 'Not needed');
  perform set_config('sg2104.own_result', result::text, true);
  result := public.decide_venue_booking_request(104202, 'reject', 'Hall closed');
  if result ->> 'outcome' is distinct from 'updated' then
    raise exception '[SG2-104:venue-staff-decides-others] [SG2-104:AC1] [NORMAL] Venue Staff must still decide requests other people raised: %', result;
  end if;
end $$;
-- Checked as the owner: clients cannot read requests or history directly.
reset role;
do $$
begin
  if current_setting('sg2104.own_result')::jsonb ->> 'outcome' is distinct from 'own_request'
      or (select status from public.venue_booking_requests where request_id = 104201) <> 'pending'
      or exists (select 1 from public.event_audit_logs where event_id = 104001 and field_name = 'venue_booking_request')
      or exists (select 1 from public.notifications where request_id = 104201) then
    raise exception '[SG2-104:venue-staff-own-request-refused] [SG2-104:AC2] [FAILURE] Venue Staff must not decide a request they raised, and nothing may change: %',
      current_setting('sg2104.own_result');
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1040000-0000-4000-8000-000000000011', true);
do $$
declare
  result jsonb;
begin
  result := public.decide_venue_booking_request(104201, 'reject', 'Not needed');
  if result ->> 'outcome' is distinct from 'updated' then
    raise exception '[SG2-104:other-staff-decide-own-request] [SG2-104:AC2] [BOUNDARY] Another Venue Staff member must decide the request: %', result;
  end if;
end $$;

-- (c) Role administration: Technical Support only, never their own roles,
-- never an account's last role; callable by the server's service role only.
do $$
begin
  begin
    perform public.change_account_roles('d1040000-0000-4000-8000-000000000004',
      'd1040000-0000-4000-8000-000000000006', 'add', 'attendee');
    raise exception '[SG2-104:role-admin-service-only] [SG2-104:AC2] [FAILURE] A signed-in client called the role administration function';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role service_role;
do $$
declare
  ts1 uuid := 'd1040000-0000-4000-8000-000000000004';
  ts2 uuid := 'd1040000-0000-4000-8000-000000000005';
  organiser uuid := 'd1040000-0000-4000-8000-000000000006';
  action text;
  result jsonb;
begin
  foreach action in array array['add', 'remove', 'replace'] loop
    result := public.change_account_roles(ts1, ts1, action, 'venue_staff');
    if result ->> 'outcome' is distinct from 'self' then
      raise exception '[SG2-104:self-role-change-refused] [SG2-104:AC2] [FAILURE] Technical Support changed their own roles with %: %', action, result;
    end if;
  end loop;
  if (select array_agg(role) from public.account_roles where user_id = ts1) is distinct from array['technical_support_staff'] then
    raise exception '[SG2-104:self-role-change-no-write] [SG2-104:AC2] [FAILURE] A refused self-change still altered roles';
  end if;

  result := public.change_account_roles('d1040000-0000-4000-8000-000000000001', organiser, 'add', 'attendee');
  if result ->> 'outcome' is distinct from 'forbidden' then
    raise exception '[SG2-104:role-admin-tech-support-only] [SG2-104:AC2] [FAILURE] An account without Technical Support changed roles: %', result;
  end if;

  result := public.change_account_roles(ts1, organiser, 'add', 'event_organiser');
  if result ->> 'outcome' is distinct from 'unchanged' then
    raise exception '[SG2-104:add-held-role-noop] [SG2-104:AC1] [BOUNDARY] Adding a role already held must change nothing: %', result;
  end if;
  result := public.change_account_roles(ts1, organiser, 'add', 'attendee');
  if result ->> 'outcome' is distinct from 'changed'
      or result -> 'roles' is distinct from '["attendee", "event_organiser"]'::jsonb then
    raise exception '[SG2-104:add-role] [SG2-104:AC1] [NORMAL] Technical Support must add a second role: %', result;
  end if;
  result := public.change_account_roles(ts2, organiser, 'remove', 'attendee');
  if result ->> 'outcome' is distinct from 'changed' or result -> 'roles' is distinct from '["event_organiser"]'::jsonb then
    raise exception '[SG2-104:remove-one-of-two] [SG2-104:AC1] [NORMAL] Technical Support must remove one of two roles: %', result;
  end if;
  result := public.change_account_roles(ts1, organiser, 'remove', 'event_organiser');
  if result ->> 'outcome' is distinct from 'last_role'
      or not exists (select 1 from public.account_roles where user_id = organiser and role = 'event_organiser') then
    raise exception '[SG2-104:last-role-kept] [SG2-104:AC1] [BOUNDARY] An account''s last role must never be removed: %', result;
  end if;
  result := public.change_account_roles(ts1, organiser, 'remove', 'venue_staff');
  if result ->> 'outcome' is distinct from 'unchanged' then
    raise exception '[SG2-104:remove-unheld-noop] [SG2-104:AC1] [BOUNDARY] Removing a role not held must change nothing: %', result;
  end if;
  result := public.change_account_roles(ts1, 'd1040000-0000-4000-8000-000000000010', 'replace', 'attendee');
  if result ->> 'outcome' is distinct from 'changed' or result -> 'roles' is distinct from '["attendee"]'::jsonb then
    raise exception '[SG2-104:replace-collapses-to-one] [SG2-104:AC1] [NORMAL] Replacing must leave exactly the one role: %', result;
  end if;
  result := public.change_account_roles(ts1, 'd1040000-0000-4000-8000-000000000012', 'add', 'attendee');
  if result ->> 'outcome' is distinct from 'missing' then
    raise exception '[SG2-104:role-admin-missing-account] [SG2-104:AC2] [FAILURE] An account without roles must be reported missing: %', result;
  end if;
  foreach action in array array['grant', null] loop
    if public.change_account_roles(ts1, organiser, action, 'attendee') ->> 'outcome' is distinct from 'invalid' then
      raise exception '[SG2-104:role-admin-invalid-input] [SG2-104:AC2] [FAILURE] Action % must be refused as invalid', action;
    end if;
  end loop;
  if public.change_account_roles(ts1, organiser, 'add', 'administrator') ->> 'outcome' is distinct from 'invalid'
      or public.change_account_roles(ts1, organiser, 'add', 'Attendee') ->> 'outcome' is distinct from 'invalid' then
    raise exception '[SG2-104:role-admin-invalid-role] [SG2-104:AC2] [FAILURE] A role outside the seven codes must be refused as invalid';
  end if;
end $$;

-- 6. AC6: reading an event's history needs a relationship to that event.
reset role;
set local role authenticated;
select set_config('request.headers', '', true);
do $$
begin
  -- Coordinator 09: assigned to 104002 and 104007, not 104001.
  perform set_config('request.jwt.claim.sub', 'd1040000-0000-4000-8000-000000000009', true);
  if not exists (select 1 from public.event_audit_logs where event_id = 104002) then
    raise exception '[SG2-104:assigned-coordinator-history] [SG2-104:AC6] [NORMAL] The assigned coordinator must read the event history';
  end if;
  if exists (select 1 from public.event_audit_logs where event_id = 104001) then
    raise exception '[SG2-104:unrelated-coordinator-history-hidden] [SG2-104:AC6] [FAILURE] A coordinator not assigned to the event read its history';
  end if;
  -- Venue Staff 11: 104001 and 104002 have venue requests, 104003 has none.
  perform set_config('request.jwt.claim.sub', 'd1040000-0000-4000-8000-000000000011', true);
  if not exists (select 1 from public.event_audit_logs where event_id = 104001) then
    raise exception '[SG2-104:venue-staff-history-with-request] [SG2-104:AC6] [NORMAL] Venue Staff must read the history of an event with a venue request';
  end if;
  if exists (select 1 from public.event_audit_logs where event_id = 104003) then
    raise exception '[SG2-104:venue-staff-history-without-request] [SG2-104:AC6] [BOUNDARY] Venue Staff read the history of an event with no venue work';
  end if;
  -- Technical Support 04: 104005 has an equipment request, 104002 has none.
  perform set_config('request.jwt.claim.sub', 'd1040000-0000-4000-8000-000000000004', true);
  if not exists (select 1 from public.event_audit_logs where event_id = 104005)
      or exists (select 1 from public.event_audit_logs where event_id = 104002) then
    raise exception '[SG2-104:support-history-by-equipment] [SG2-104:AC6] [BOUNDARY] Technical Support must read exactly the histories of events with equipment requests';
  end if;
  -- Lead 07: every submitted event, never a draft.
  perform set_config('request.jwt.claim.sub', 'd1040000-0000-4000-8000-000000000007', true);
  if not exists (select 1 from public.event_audit_logs where event_id = 104001)
      or exists (select 1 from public.event_audit_logs where event_id = 104006) then
    raise exception '[SG2-104:lead-history-draft-hidden] [SG2-104:AC6] [BOUNDARY] The Lead must read submitted events'' history but not a draft''s';
  end if;
  -- Safety Officer 08: at or past the safety check only.
  perform set_config('request.jwt.claim.sub', 'd1040000-0000-4000-8000-000000000008', true);
  if not exists (select 1 from public.event_audit_logs where event_id = 104007)
      or exists (select 1 from public.event_audit_logs where event_id = 104001) then
    raise exception '[SG2-104:safety-history-at-check] [SG2-104:AC6] [BOUNDARY] The Safety Officer must read an event''s history from its safety check, not before';
  end if;
  -- Account 01 organises 104003 and coordinates other events: as 104003's
  -- organiser only, so never its coordinator-only planning notes.
  perform set_config('request.jwt.claim.sub', 'd1040000-0000-4000-8000-000000000001', true);
  if not exists (select 1 from public.event_audit_logs where event_id = 104003 and field_name = 'name')
      or exists (select 1 from public.event_audit_logs where event_id = 104003 and field_name = 'planning_notes') then
    raise exception '[SG2-104:union-does-not-leak-internal-fields] [SG2-104:AC6] [CONFLICT] Holding a coordinator role must not reveal another event''s internal fields to its organiser';
  end if;
  if private.event_relationship_exists(104002, 'venue_staff') then
    raise exception '[SG2-104:relationship-needs-held-role] [SG2-104:AC6] [FAILURE] The relationship check answered for a role the caller does not hold';
  end if;
  -- Only reachable through the history policy: not in an API-exposed schema,
  -- and never callable by anonymous clients.
  if to_regprocedure('public.event_relationship_exists(integer, text)') is not null
      or to_regnamespace('private') is null
      or has_function_privilege('anon', 'private.event_relationship_exists(integer, text)', 'execute')
      or has_schema_privilege('anon', 'private', 'usage') then
    raise exception '[SG2-104:relationship-check-not-exposed] [SG2-104:AC6] [FAILURE] The relationship check must not be callable through the Data API';
  end if;
end $$;

-- A reassigned coordinator loses access immediately.
reset role;
update public.events set coordinator_id = 'd1040000-0000-4000-8000-000000000003' where event_id = 104002;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1040000-0000-4000-8000-000000000009', true);
do $$
begin
  if exists (select 1 from public.event_audit_logs where event_id = 104002) then
    raise exception '[SG2-104:reassigned-coordinator-loses-history] [SG2-104:AC6] [CONFLICT] A coordinator taken off the event still read its history';
  end if;
end $$;
select set_config('request.jwt.claim.sub', 'd1040000-0000-4000-8000-000000000003', true);
do $$
begin
  if not exists (select 1 from public.event_audit_logs where event_id = 104002) then
    raise exception '[SG2-104:new-coordinator-gains-history] [SG2-104:AC6] [NORMAL] The newly assigned coordinator must read the event history';
  end if;
end $$;

reset role;
rollback;
