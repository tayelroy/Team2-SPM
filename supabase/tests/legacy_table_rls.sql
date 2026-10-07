-- SG2-25: legacy direct-data access must honor server-owned records and
-- caller-scoped venue roles. Disposable local/CI fixtures only; all roll back.
begin;

-- Check the actual enforcement flags and ACLs, including per-column grants.
do $$
declare
  relation_name text;
  column_name text;
  sequence_name text;
  definition record;
  writable boolean;
begin
  foreach relation_name in array array['users', 'events', 'venues', 'roles', 'registrations', 'equipment_reservations'] loop
    if not exists (select 1 from pg_catalog.pg_class c
        where c.oid = format('public.%I', relation_name)::regclass and c.relrowsecurity and c.relforcerowsecurity) then
      raise exception '[FAILURE] [SG2-25:legacy-rls-flags] [SG2-25:AC1] [SG2-25:AC2] RLS must be enabled and forced on %', relation_name;
    end if;
    if has_table_privilege('anon', format('public.%I', relation_name), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_table_privilege('authenticated', format('public.%I', relation_name), 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception '[FAILURE] [SG2-25:legacy-table-acls] [SG2-25:AC2] Ordinary clients must not retain table-wide writes or anonymous reads on %', relation_name;
    end if;
    if has_table_privilege('authenticated', format('public.%I', relation_name), 'SELECT')
        is distinct from (relation_name in ('users', 'events', 'venues')) then
      raise exception '[FAILURE] [SG2-25:legacy-read-acls] [SG2-25:AC1] Ordinary read grants must match the caller-scoped tables: %', relation_name;
    end if;
    for column_name in select attname from pg_catalog.pg_attribute
        where attrelid = format('public.%I', relation_name)::regclass and attnum > 0 and not attisdropped loop
      writable := relation_name = 'venues' and column_name <> 'venue_id';
      if has_column_privilege('authenticated', format('public.%I', relation_name), column_name, 'INSERT') is distinct from writable
          or has_column_privilege('authenticated', format('public.%I', relation_name), column_name, 'UPDATE') is distinct from writable
          or has_column_privilege('authenticated', format('public.%I', relation_name), column_name, 'REFERENCES')
          or has_column_privilege('anon', format('public.%I', relation_name), column_name, 'SELECT,INSERT,UPDATE,REFERENCES') then
        raise exception '[FAILURE] [SG2-25:legacy-column-acls] [SG2-25:AC2] Only the six editable venue columns may have ordinary write grants: %.%', relation_name, column_name;
      end if;
    end loop;
  end loop;
  foreach sequence_name in array array['events_event_id_seq', 'venues_venue_id_seq', 'roles_role_id_seq',
      'registrations_registration_id_seq', 'equipment_reservations_reservation_id_seq'] loop
    if has_sequence_privilege('anon', format('public.%I', sequence_name), 'USAGE,SELECT,UPDATE')
        or has_sequence_privilege('authenticated', format('public.%I', sequence_name), 'SELECT,UPDATE')
        or has_sequence_privilege('authenticated', format('public.%I', sequence_name), 'USAGE') is distinct from (sequence_name = 'venues_venue_id_seq')
        or not has_sequence_privilege('service_role', format('public.%I', sequence_name), 'USAGE') then
      raise exception '[FAILURE] [SG2-25:legacy-sequence-acls] [SG2-25:AC2] Client sequence access must be limited to venue allocation: %', sequence_name;
    end if;
  end loop;
  if (select count(*) from pg_catalog.pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in (
        'change_venue_hold', 'create_venue_hold', 'decide_venue_booking_request', 'is_clarification_participant',
        'list_venue_hold_notifications', 'list_venue_holds', 'venue_hold_occupancy', 'venue_hold_options')) <> 8 then
    raise exception '[NORMAL] [SG2-25:legacy-guarded-rpc-presence] [SG2-25:AC1] All eight existing guarded RPCs must remain present';
  end if;
  for definition in select p.* from pg_catalog.pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in (
        'change_venue_hold', 'create_venue_hold', 'decide_venue_booking_request', 'is_clarification_participant',
        'list_venue_hold_notifications', 'list_venue_holds', 'venue_hold_occupancy', 'venue_hold_options') loop
    if not definition.prosecdef or not exists (select 1 from pg_catalog.pg_roles r
        where r.oid = definition.proowner and (r.rolsuper or r.rolbypassrls))
        or not has_function_privilege('authenticated', definition.oid, 'EXECUTE')
        or has_function_privilege('anon', definition.oid, 'EXECUTE') then
      raise exception '[NORMAL] [SG2-25:legacy-guarded-rpc-contract] [SG2-25:AC1] The existing guarded RPC contract must remain intact: %', definition.proname;
    end if;
  end loop;
end $$;

insert into auth.users (id)
  select ('a2500000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 9) n;
insert into public.users (user_id, name, organisation, role_id)
  select ('a2500000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
    'Legacy role ' || n, case when n = 8 then 'Legacy B' else 'Legacy A' end, case when n = 8 then 1 else n end
  from generate_series(1, 8) n;
insert into public.account_roles (user_id, role) values
  ('a2500000-0000-4000-8000-000000000001', 'event_organiser'),
  ('a2500000-0000-4000-8000-000000000002', 'event_coordinator'),
  ('a2500000-0000-4000-8000-000000000003', 'venue_staff'),
  ('a2500000-0000-4000-8000-000000000004', 'technical_support_staff'),
  ('a2500000-0000-4000-8000-000000000005', 'attendee'),
  ('a2500000-0000-4000-8000-000000000006', 'event_coordinator_lead'),
  ('a2500000-0000-4000-8000-000000000007', 'safety_officer'),
  ('a2500000-0000-4000-8000-000000000008', 'event_organiser');
insert into public.events (event_id, organiser_id, organisation, name) values
  (92591, 'a2500000-0000-4000-8000-000000000001', 'Legacy A', 'First organisation event'),
  (92592, 'a2500000-0000-4000-8000-000000000008', 'Legacy B', 'Second organisation event');
insert into public.venues (venue_id, name, location, capacity, facilities, accessibility_features, operating_information)
  values (92590, 'Legacy Hall', 'Level 1', 100, 'Stage', 'Lift', '09:00-18:00');
insert into public.equipment (equipment_id, name, quantity_total) values (92590, 'Legacy speakers', 5);
insert into public.equipment_reservations (reservation_id, event_id, equipment_id, quantity_reserved)
  values (92590, 92591, 92590, 2);
insert into public.registrations (registration_id, event_id, attendee_id, status)
  values (92590, 92591, 'a2500000-0000-4000-8000-000000000005', 'registered');

set local role authenticated;
do $$
declare
  n integer;
  identity uuid;
  relation_name text;
  changed integer;
  created_id integer;
begin
  for n in 1..7 loop
    identity := ('a2500000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
    perform set_config('request.jwt.claim.sub', identity::text, true);
    if (select array_agg(user_id) from public.users) is distinct from array[identity] then
      raise exception '[NORMAL] [SG2-25:legacy-self-profile] [SG2-25:AC1] Each of the seven roles must see exactly its own profile';
    end if;
    if (select count(*) from public.events) <> (case when n = 1 then 1 else 0 end)
        or exists (select 1 from public.events where event_id = 92592) then
      raise exception '[FAILURE] [SG2-25:legacy-role-event-read] [SG2-25:AC2] Only the organiser may read its exact organisation events';
    end if;
    if (select count(*) from public.venues where venue_id = 92590) <> (case when n in (2, 3, 4) then 1 else 0 end) then
      raise exception '[NORMAL] [SG2-25:legacy-role-venue-read] [SG2-25:AC1] Coordinator, Venue Staff and Technical Support must retain venue reads';
    end if;
    begin
      insert into public.venues (name, location, capacity, facilities, accessibility_features, operating_information)
        values ('Caller-created venue', 'Level 2', 50, 'Screen', 'Ramp', '08:00-17:00') returning venue_id into created_id;
      if n <> 3 or not exists (select 1 from public.venues where venue_id = created_id and name = 'Caller-created venue'
          and location = 'Level 2' and capacity = 50 and facilities = 'Screen' and accessibility_features = 'Ramp'
          and operating_information = '08:00-17:00') then
        raise exception '[NORMAL] [SG2-25:legacy-staff-venue-create] [SG2-25:AC1] Only Venue Staff may persist all six editable venue fields';
      end if;
    exception when insufficient_privilege then
      if n = 3 then
        raise exception '[NORMAL] [SG2-25:legacy-staff-venue-insert-grant] [SG2-25:AC1] Venue Staff must retain sequence-backed inserts';
      end if;
    end;
    update public.venues set name = 'Updated legacy hall', location = 'Level 3', capacity = 125,
      facilities = 'Stage and screen', accessibility_features = 'Lift and ramp', operating_information = '07:00-20:00'
      where venue_id = 92590;
    get diagnostics changed = row_count;
    if changed <> (case when n = 3 then 1 else 0 end) then
      raise exception '[FAILURE] [SG2-25:legacy-role-venue-update] [SG2-25:AC2] Only Venue Staff may update existing venue records';
    end if;
    if n = 3 and not exists (select 1 from public.venues where venue_id = 92590
        and name = 'Updated legacy hall' and location = 'Level 3' and capacity = 125
        and facilities = 'Stage and screen' and accessibility_features = 'Lift and ramp'
        and operating_information = '07:00-20:00') then
      raise exception '[NORMAL] [SG2-25:legacy-staff-venue-fields] [SG2-25:AC1] Venue Staff must retain persistence of every editable venue field';
    end if;
    begin
      update public.venues set venue_id = 999999 where venue_id = 92590;
      raise exception '[FAILURE] [SG2-25:legacy-venue-primary-key] [SG2-25:AC2] No ordinary role may change a venue primary key';
    exception when insufficient_privilege then null; end;
    foreach relation_name in array array['users', 'events', 'venues', 'roles', 'registrations', 'equipment_reservations'] loop
      begin
        execute format('delete from public.%I where false', relation_name);
        raise exception '[FAILURE] [SG2-25:legacy-role-delete] [SG2-25:AC2] No ordinary role may delete from %', relation_name;
      exception when insufficient_privilege then null; end;
      begin
        execute format('truncate table public.%I cascade', relation_name);
        raise exception '[FAILURE] [SG2-25:legacy-role-truncate] [SG2-25:AC2] No ordinary role may truncate %', relation_name;
      exception when insufficient_privilege then null; end;
    end loop;
    foreach relation_name in array array['roles', 'registrations', 'equipment_reservations'] loop
      begin
        execute format('select 1 from public.%I limit 1', relation_name);
        raise exception '[FAILURE] [SG2-25:legacy-service-table-read] [SG2-25:AC2] All seven ordinary roles must be refused service-owned %', relation_name;
      exception when insufficient_privilege then null; end;
    end loop;
    begin
      update public.users set organisation = 'Legacy B' where user_id = identity;
      raise exception '[FAILURE] [SG2-25:legacy-client-membership-write] [SG2-25:AC2] No role may edit its server-owned organisation directly';
    exception when insufficient_privilege then null; end;
    begin
      update public.events set name = 'Direct edit' where event_id = 92591;
      raise exception '[FAILURE] [SG2-25:legacy-client-event-write] [SG2-25:AC2] No ordinary role may bypass the event API';
    exception when insufficient_privilege then null; end;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  if exists (select 1 from public.users) or exists (select 1 from public.events) or exists (select 1 from public.venues) then
    raise exception '[BOUNDARY] [SG2-25:legacy-missing-identity] [SG2-25:AC2] Missing identity must expose no caller-scoped records';
  end if;
end $$;

-- A role change must take effect with the same JWT identity, immediately.
set local role service_role;
update public.account_roles set role = 'event_organiser'
  where user_id = 'a2500000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2500000-0000-4000-8000-000000000003', true);
do $$
declare changed integer;
begin
  update public.venues set name = 'Stale venue role' where venue_id = 92590;
  get diagnostics changed = row_count;
  if changed <> 0 or exists (select 1 from public.venues) or (select count(*) from public.events) <> 1 then
    raise exception '[CONFLICT] [SG2-25:legacy-current-role] [SG2-25:AC2] Current stored role must replace the previous role grants';
  end if;
  begin
    insert into public.venues (name) values ('Stale staff insert');
    raise exception '[CONFLICT] [SG2-25:legacy-changed-role-insert] [SG2-25:AC2] A former Venue Staff account must lose direct insert access';
  exception when insufficient_privilege then null; end;
end $$;

set local role anon;
do $$
declare relation_name text;
begin
  foreach relation_name in array array['users', 'events', 'venues', 'roles', 'registrations', 'equipment_reservations'] loop
    begin
      execute format('select 1 from public.%I limit 1', relation_name);
      raise exception '[FAILURE] [SG2-25:legacy-anonymous-read] [SG2-25:AC2] [SG2-25:AC3] Anonymous callers must not read %', relation_name;
    exception when insufficient_privilege then null; end;
    begin
      execute format('delete from public.%I where false', relation_name);
      raise exception '[FAILURE] [SG2-25:legacy-anonymous-delete] [SG2-25:AC2] [SG2-25:AC3] Anonymous callers must not delete %', relation_name;
    exception when insufficient_privilege then null; end;
    begin
      execute format('truncate table public.%I cascade', relation_name);
      raise exception '[FAILURE] [SG2-25:legacy-anonymous-truncate] [SG2-25:AC2] [SG2-25:AC3] Anonymous callers must not truncate %', relation_name;
    exception when insufficient_privilege then null; end;
  end loop;
  begin
    insert into public.venues (name) values ('Anonymous venue');
    raise exception '[FAILURE] [SG2-25:legacy-anonymous-insert] [SG2-25:AC2] [SG2-25:AC3] Anonymous callers must not create venue records';
  exception when insufficient_privilege then null; end;
end $$;

-- API/service-owned CRUD and sequence allocation must stay available.
set local role service_role;
do $$
declare
  created_event integer;
  created_venue integer;
  created_role integer;
  created_registration integer;
  created_reservation integer;
begin
  if (select count(*) from public.users) <> 8 or (select count(*) from public.events) <> 2
      or not exists (select 1 from public.registrations where registration_id = 92590)
      or not exists (select 1 from public.equipment_reservations where reservation_id = 92590)
      or (select count(*) from public.roles) <> 7 then
    raise exception '[NORMAL] [SG2-25:legacy-service-read] [SG2-25:AC1] Privileged API operations must retain all six table reads';
  end if;
  insert into public.roles (role_name) values ('Disposable validation role') returning role_id into created_role;
  update public.roles set description = 'Service-owned role' where role_id = created_role;
  insert into public.users (user_id, name, role_id) values ('a2500000-0000-4000-8000-000000000009', 'Service-created profile', 5);
  update public.users set department = 'Operations' where user_id = 'a2500000-0000-4000-8000-000000000009';
  insert into public.events (organiser_id, organisation, name)
    values ('a2500000-0000-4000-8000-000000000001', 'Legacy A', 'Service event') returning event_id into created_event;
  update public.events set name = 'Service-updated event' where event_id = created_event;
  insert into public.venues (name, capacity) values ('Service venue', 10) returning venue_id into created_venue;
  update public.venues set name = 'Service-updated venue' where venue_id = created_venue;
  insert into public.registrations (event_id, attendee_id, status)
    values (created_event, 'a2500000-0000-4000-8000-000000000005', 'registered') returning registration_id into created_registration;
  update public.registrations set status = 'confirmed' where registration_id = created_registration;
  insert into public.equipment_reservations (event_id, equipment_id, quantity_reserved)
    values (created_event, 92590, 1) returning reservation_id into created_reservation;
  update public.equipment_reservations set quantity_reserved = 3 where reservation_id = created_reservation;
  if not exists (select 1 from public.roles where role_id = created_role and description = 'Service-owned role')
      or not exists (select 1 from public.users where user_id = 'a2500000-0000-4000-8000-000000000009' and department = 'Operations')
      or not exists (select 1 from public.events where event_id = created_event and name = 'Service-updated event')
      or not exists (select 1 from public.venues where venue_id = created_venue and name = 'Service-updated venue')
      or not exists (select 1 from public.registrations where registration_id = created_registration and status = 'confirmed')
      or not exists (select 1 from public.equipment_reservations where reservation_id = created_reservation and quantity_reserved = 3) then
    raise exception '[NORMAL] [SG2-25:legacy-service-create-update] [SG2-25:AC1] Service CRUD must persist on every protected table';
  end if;
  delete from public.roles where role_id = created_role;
  delete from public.registrations where registration_id = created_registration;
  delete from public.equipment_reservations where reservation_id = created_reservation;
  delete from public.events where event_id = created_event;
  delete from public.venues where venue_id = created_venue;
  delete from public.users where user_id = 'a2500000-0000-4000-8000-000000000009';
  if exists (select 1 from public.roles where role_id = created_role)
      or exists (select 1 from public.registrations where registration_id = created_registration)
      or exists (select 1 from public.equipment_reservations where reservation_id = created_reservation)
      or exists (select 1 from public.events where event_id = created_event)
      or exists (select 1 from public.venues where venue_id = created_venue)
      or exists (select 1 from public.users where user_id = 'a2500000-0000-4000-8000-000000000009') then
    raise exception '[NORMAL] [SG2-25:legacy-service-delete] [SG2-25:AC1] Privileged API deletions must remain effective on every protected table';
  end if;
end $$;
reset role;
rollback;
