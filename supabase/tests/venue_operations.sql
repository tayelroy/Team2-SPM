-- Review trace: SG2-77 venue setup, turnaround and safety details.
-- Numeric AC tags follow the SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- SG2-77: venue_operations values, change history and access policies.
-- Disposable local/CI test script. All changes are rolled back.
begin;

-- Seed test identities:
-- 1: venue staff   2: event coordinator   3: technical support staff
-- 4: event organiser   5: attendee   6: second venue staff member
insert into auth.users (id) values
  ('e0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000003'),
  ('e0000000-0000-4000-8000-000000000004'),
  ('e0000000-0000-4000-8000-000000000005'),
  ('e0000000-0000-4000-8000-000000000006');

insert into public.users (user_id, name, organisation, role_id) values
  ('e0000000-0000-4000-8000-000000000001', 'Venue Staff V', 'ConnectSphere', 3),
  ('e0000000-0000-4000-8000-000000000002', 'Coordinator C', 'ConnectSphere', 2),
  ('e0000000-0000-4000-8000-000000000003', 'Tech Support T', 'ConnectSphere', 4),
  ('e0000000-0000-4000-8000-000000000004', 'Organiser O', 'Acme Corp', 1),
  ('e0000000-0000-4000-8000-000000000005', 'Attendee A', 'Acme Corp', 5),
  ('e0000000-0000-4000-8000-000000000006', 'Venue Staff W', 'ConnectSphere', 3);

insert into public.account_roles (user_id, role) values
  ('e0000000-0000-4000-8000-000000000001', 'venue_staff'),
  ('e0000000-0000-4000-8000-000000000002', 'event_coordinator'),
  ('e0000000-0000-4000-8000-000000000003', 'technical_support_staff'),
  ('e0000000-0000-4000-8000-000000000004', 'event_organiser'),
  ('e0000000-0000-4000-8000-000000000005', 'attendee'),
  ('e0000000-0000-4000-8000-000000000006', 'venue_staff');

insert into public.venues (venue_id, name, location, capacity, facilities, accessibility_features, operating_information) values
  (97701, 'Main Hall', 'Level 1', 200, 'Stage', 'Step-free', '08:00-22:00'),
  (97702, 'Quiet Room', 'Level 2', 20, 'Whiteboard', 'Lift', '09:00-18:00');

-- 1. Values and limits:
do $$
begin
  insert into public.venue_operations (venue_id, setup_minutes, turnaround_minutes, emergency_access, known_restrictions)
    values (97701, 30, 45, 'Two exits to the car park', 'No open flames');
  if not exists (select 1 from public.venue_operations where venue_id = 97701
      and setup_minutes = 30 and turnaround_minutes = 45
      and emergency_access = 'Two exits to the car park' and known_restrictions = 'No open flames') then
    raise exception '[SG2-77:stored-operations] [SG2-77:AC1] [SG2-77:AC5] [NORMAL] Setup, turnaround and safety details must be stored against the venue';
  end if;
  insert into public.venue_operations (venue_id) values (97702);
  if not exists (select 1 from public.venue_operations where venue_id = 97702
      and setup_minutes = 0 and turnaround_minutes = 0 and emergency_access is null and known_restrictions is null) then
    raise exception '[SG2-77:default-zero-minutes] [SG2-77:AC3] [BOUNDARY] A venue with no values must default to 0 minutes and no safety details';
  end if;
  update public.venue_operations set setup_minutes = 1440, turnaround_minutes = 1440 where venue_id = 97702;
  if not exists (select 1 from public.venue_operations where venue_id = 97702 and setup_minutes = 1440 and turnaround_minutes = 1440) then
    raise exception '[SG2-77:maximum-minutes] [SG2-77:AC1] [BOUNDARY] 1440 minutes (24 hours) must be accepted';
  end if;
  begin
    update public.venue_operations set setup_minutes = -1 where venue_id = 97702;
    raise exception '[SG2-77:negative-setup] [SG2-77:AC4] [BOUNDARY] A negative setup time should have been refused';
  exception when check_violation then null;
  end;
  begin
    update public.venue_operations set turnaround_minutes = 1441 where venue_id = 97702;
    raise exception '[SG2-77:turnaround-over-limit] [SG2-77:AC4] [BOUNDARY] A turnaround time above 1440 minutes should have been refused';
  exception when check_violation then null;
  end;
  begin
    update public.venue_operations set emergency_access = repeat('x', 2001) where venue_id = 97702;
    raise exception '[SG2-77:safety-text-limit] [SG2-77:AC5] [BOUNDARY] Safety details over 2000 characters should have been refused';
  exception when check_violation then null;
  end;
  begin
    insert into public.venue_operations (venue_id) values (-1);
    raise exception '[SG2-77:operations-venue-reference] [FAILURE] Operations must reference an existing venue';
  exception when foreign_key_violation then null;
  end;
end $$;

-- 2. Venue Staff change values; the change is recorded with who and when:
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
begin
  update public.venue_operations set turnaround_minutes = 60 where venue_id = 97701;
  if not exists (select 1 from public.venue_operations where venue_id = 97701 and turnaround_minutes = 60
      and updated_by = 'e0000000-0000-4000-8000-000000000001') then
    raise exception '[SG2-77:staff-update] [SG2-77:AC6] [NORMAL] Venue Staff must be able to change a venue''s turnaround time';
  end if;
  if not exists (select 1 from public.venue_operation_history where venue_id = 97701
      and field_name = 'turnaround_minutes' and old_value = '45' and new_value = '60'
      and changed_by = 'e0000000-0000-4000-8000-000000000001' and changed_at is not null) then
    raise exception '[SG2-77:change-recorded] [SG2-77:AC6] [NORMAL] Each change must be recorded with the old and new value, who made it and when';
  end if;
  if exists (select 1 from public.venue_operation_history where venue_id = 97701
      and field_name = 'setup_minutes' and old_value = '30' and new_value = '30') then
    raise exception '[SG2-77:unchanged-not-recorded] [SG2-77:AC6] [BOUNDARY] Fields that did not change must not add history';
  end if;
  -- A second staff member edits the same venue straight after: the last save
  -- stands and both edits stay in the history, each with its own author.
  update public.venue_operations set setup_minutes = 20 where venue_id = 97701;
  perform set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000006', true);
  update public.venue_operations set setup_minutes = 15 where venue_id = 97701;
  if not exists (select 1 from public.venue_operations where venue_id = 97701 and setup_minutes = 15
      and updated_by = 'e0000000-0000-4000-8000-000000000006')
     or (select count(*) from public.venue_operation_history where venue_id = 97701 and field_name = 'setup_minutes'
      and ((old_value = '30' and new_value = '20' and changed_by = 'e0000000-0000-4000-8000-000000000001')
        or (old_value = '20' and new_value = '15' and changed_by = 'e0000000-0000-4000-8000-000000000006'))) <> 2 then
    raise exception '[SG2-77:sequential-staff-edits] [SG2-77:AC6] [CONFLICT] Two staff edits in a row must keep the last value and record both, each with its author';
  end if;
  perform set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000001', true);
  begin
    insert into public.venue_operation_history (venue_id, field_name, new_value)
      values (97701, 'setup_minutes', '0');
    raise exception '[SG2-77:history-forgery] [SG2-77:AC6] [FAILURE] Nobody may write change history directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 3. Coordinators and Technical Support Staff read but cannot change values:
do $$
declare reader uuid;
begin
  foreach reader in array array[
    'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003'
  ]::uuid[] loop
    perform set_config('request.jwt.claim.sub', reader::text, true);
    if (select count(*) from public.venue_operations where venue_id in (97701, 97702)) <> 2 then
      raise exception '[SG2-77:internal-read] [SG2-77:AC1] [NORMAL] Reader % should see every venue''s setup and turnaround times', reader;
    end if;
    update public.venue_operations set setup_minutes = 5 where venue_id = 97701;
    if exists (select 1 from public.venue_operations where venue_id = 97701 and setup_minutes = 5) then
      raise exception '[SG2-77:non-staff-update] [SG2-77:AC6] [FAILURE] Reader % must not change a venue''s setup time', reader;
    end if;
    if exists (select 1 from public.venue_operation_history) then
      raise exception '[SG2-77:history-staff-only] [SG2-77:AC6] [FAILURE] Reader % must not read change history', reader;
    end if;
  end loop;
end $$;

-- 4. Organisers and attendees see nothing:
do $$
declare caller uuid;
begin
  foreach caller in array array[
    'e0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000005'
  ]::uuid[] loop
    perform set_config('request.jwt.claim.sub', caller::text, true);
    if exists (select 1 from public.venue_operations) then
      raise exception '[SG2-77:external-read] [SG2-77:AC6] [FAILURE] External user % must not read venue operations', caller;
    end if;
    begin
      insert into public.venue_operations (venue_id, setup_minutes) values (97701, 1)
        on conflict (venue_id) do update set setup_minutes = 1;
      raise exception '[SG2-77:external-write] [SG2-77:AC6] [FAILURE] External user % must not change venue operations', caller;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;

-- 5. Anonymous callers have no access:
set local role anon;
do $$
begin
  begin
    perform * from public.venue_operations;
    raise exception '[SG2-77:anonymous-read] [SG2-77:AC6] [FAILURE] Anonymous caller should not read venue operations';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 6. Losing the Venue Staff role removes write access straight away:
reset role;
select set_config('venue_operations.before_revocation',
  (select to_jsonb(operation)::text from public.venue_operations operation where venue_id = 97701), true);
set local role service_role;
update public.account_roles set role = 'attendee'
  where user_id = 'e0000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare changed integer;
begin
  update public.venue_operations set setup_minutes = 10 where venue_id = 97701;
  get diagnostics changed = row_count;
  -- The revoked caller cannot read this row. Inspect unchanged storage using
  -- the fixture owner so a hidden row cannot conceal an unauthorized write.
  reset role;
  if changed <> 0 or (select to_jsonb(operation) from public.venue_operations operation where venue_id = 97701)
      is distinct from current_setting('venue_operations.before_revocation')::jsonb then
    raise exception '[SG2-77:revoked-staff-update] [SG2-77:AC6] [CONFLICT] A revoked staff update must affect zero rows and preserve the complete stored record';
  end if;
end $$;
reset role;
rollback;
