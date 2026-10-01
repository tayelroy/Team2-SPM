-- Review trace: original PR #32.
-- Numeric AC tags follow verified SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- SG2-26 regression checks for a disposable local/CI database only.
-- All fixtures and permission changes are rolled back.
begin;

insert into auth.users (id)
select ('b0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
from generate_series(1, 13) n;

insert into public.users (user_id, name, organisation, role_id) values
  ('b0000000-0000-4000-8000-000000000001', 'Organiser A', 'Example A', 1),
  ('b0000000-0000-4000-8000-000000000002', 'Colleague A', 'Example A', 1),
  ('b0000000-0000-4000-8000-000000000003', 'Organiser B', 'Example B', 1),
  ('b0000000-0000-4000-8000-000000000004', 'Missing organisation', null, 1),
  ('b0000000-0000-4000-8000-000000000005', 'Empty organisation', '', 1),
  ('b0000000-0000-4000-8000-000000000006', 'Blank organisation', E' \t\n', 1),
  ('b0000000-0000-4000-8000-000000000007', 'Attendee A', 'Example A', 5),
  ('b0000000-0000-4000-8000-000000000008', 'Unassigned role A', 'Example A', 1),
  ('b0000000-0000-4000-8000-000000000010', 'Unicode blank organisation', U&'\00A0\2003\FEFF', 1),
  ('b0000000-0000-4000-8000-000000000011', 'Coordinator A', 'Example A', 2),
  ('b0000000-0000-4000-8000-000000000012', 'Venue staff A', 'Example A', 3),
  ('b0000000-0000-4000-8000-000000000013', 'Technical support A', 'Example A', 4);
-- The ninth identity deliberately has no profile.
insert into public.account_roles (user_id, role)
select id, case id
  when 'b0000000-0000-4000-8000-000000000007'::uuid then 'attendee'
  when 'b0000000-0000-4000-8000-000000000011'::uuid then 'event_coordinator'
  when 'b0000000-0000-4000-8000-000000000012'::uuid then 'venue_staff'
  when 'b0000000-0000-4000-8000-000000000013'::uuid then 'technical_support_staff'
  else 'event_organiser' end
from auth.users
where id::text like 'b0000000-0000-4000-8000-%'
  and id <> 'b0000000-0000-4000-8000-000000000008'::uuid;

insert into public.events (event_id, organiser_id, organisation, name) values
  (92601, 'b0000000-0000-4000-8000-000000000001', 'Example A', 'A first event'),
  (92602, 'b0000000-0000-4000-8000-000000000002', 'Example A', 'A colleague event'),
  (92603, 'b0000000-0000-4000-8000-000000000003', 'Example B', 'B event'),
  (92604, 'b0000000-0000-4000-8000-000000000001', null, 'Missing organisation'),
  (92605, 'b0000000-0000-4000-8000-000000000001', '', 'Empty organisation'),
  (92606, 'b0000000-0000-4000-8000-000000000001', E' \t\n', 'Blank organisation'),
  (92607, 'b0000000-0000-4000-8000-000000000001', 'example a', 'Different case'),
  (92608, 'b0000000-0000-4000-8000-000000000001', ' Example A ', 'Different spaces'),
  (92609, 'b0000000-0000-4000-8000-000000000001', U&'\00A0\2003\FEFF', 'Unicode blank organisation');

set local role authenticated;
do $$
declare
  identity uuid;
  n integer;
begin
  -- Both colleagues see the same organisation-wide list, regardless of author.
  foreach identity in array array[
    'b0000000-0000-4000-8000-000000000001'::uuid,
    'b0000000-0000-4000-8000-000000000002'::uuid
  ] loop
    perform set_config('request.jwt.claim.sub', identity::text, true);
    if (select array_agg(event_id order by event_id) from public.events)
        is distinct from array[92601, 92602] then
      raise exception '[SG2-26:colleague-event-list] [SG2-26:AC3] [NORMAL] Colleagues must see exactly their organisation events';
    end if;
    if exists (select 1 from public.events where event_id = 92603) then
      raise exception '[SG2-26:other-organisation-lookup] [SG2-26:AC2] [FAILURE] Direct lookup exposed another organisation event';
    end if;
    if exists (select 1 from public.events where event_id in (92607, 92608)) then
      raise exception '[SG2-26:exact-tenant-identifier] [SG2-26:AC1] [BOUNDARY] Different case or surrounding spaces must not grant access to a similarly named organisation';
    end if;
    if (select array_agg(user_id) from public.users) is distinct from array[identity] then
      raise exception '[SG2-26:self-profile] [NORMAL] Profile reads must expose only the caller';
    end if;
  end loop;

  perform set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000003', true);
  if (select array_agg(event_id) from public.events) is distinct from array[92603] then
    raise exception '[SG2-26:second-organisation-list] [SG2-26:AC1] [NORMAL] The second organisation must see only its own events';
  end if;

  -- Null/empty/whitespace membership, wrong/missing role, and missing profile
  -- cannot use even a matching event organisation to obtain access.
  foreach n in array array[4, 5, 6, 10] loop
    perform set_config('request.jwt.claim.sub',
      'b0000000-0000-4000-8000-' || lpad(n::text, 12, '0'), true);
    if exists (select 1 from public.events) then
      raise exception '[SG2-26:blank-membership] [SG2-26:AC1] [BOUNDARY] Missing, empty or whitespace-only membership must expose no events for fixture %', n;
    end if;
  end loop;
  foreach n in array array[7, 8, 9, 11, 12, 13] loop
    perform set_config('request.jwt.claim.sub',
      'b0000000-0000-4000-8000-' || lpad(n::text, 12, '0'), true);
    if exists (select 1 from public.events) then
      raise exception '[SG2-26:invalid-access-context] [SG2-26:AC1] [FAILURE] Invalid membership or role exposed events for fixture %', n;
    end if;
  end loop;

  perform set_config('request.jwt.claim.sub', '', true);
  if exists (select 1 from public.events) or exists (select 1 from public.users) then
    raise exception '[SG2-26:missing-identity] [SG2-26:AC1] [FAILURE] Missing identity must fail closed';
  end if;
end $$;

select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000001', true);
do $$
begin
  begin
    update public.users set organisation = 'Example B';
    raise exception '[SG2-26:client-membership-update] [SG2-26:AC2] [FAILURE] Client could change organisation membership';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.users (user_id, name, role_id) values
      ('b0000000-0000-4000-8000-000000000009', 'Client profile', 1);
    raise exception '[SG2-26:client-profile-insert] [SG2-26:AC2] [FAILURE] Client could create organisation membership';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.users;
    raise exception '[SG2-26:client-profile-delete] [SG2-26:AC2] [FAILURE] Client could delete organisation membership';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.events set organisation = 'Example A';
    raise exception '[SG2-26:client-event-update] [SG2-26:AC2] [FAILURE] Client could change event ownership';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.events (organiser_id, organisation) values
      ('b0000000-0000-4000-8000-000000000001', 'Example B');
    raise exception '[SG2-26:client-event-insert] [SG2-26:AC2] [FAILURE] Client could create an event directly';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.events;
    raise exception '[SG2-26:client-event-delete] [SG2-26:AC2] [FAILURE] Client could delete events directly';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role anon;
do $$
declare object_name text;
begin
  foreach object_name in array array['users', 'events'] loop
    begin
      execute format('select 1 from public.%I limit 1', object_name);
      raise exception '[SG2-26:anonymous-read] [SG2-26:AC2] [FAILURE] Anonymous callers must not read %', object_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute format('delete from public.%I where false', object_name);
      raise exception '[SG2-26:anonymous-delete] [SG2-26:AC2] [FAILURE] Anonymous callers must not delete %', object_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute format('update public.%I set name = ''Anonymous edit''', object_name);
      raise exception '[SG2-26:anonymous-update] [FAILURE] Anonymous callers must not update %', object_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute format('truncate table public.%I', object_name);
      raise exception '[SG2-26:anonymous-truncate] [FAILURE] Anonymous callers must not truncate %', object_name;
    exception when insufficient_privilege then null;
    end;
    begin
      if object_name = 'users' then
        insert into public.users (user_id, name, organisation, role_id)
          values ('b0000000-0000-4000-8000-000000000009', 'Anonymous profile', 'Example A', 1);
      else
        insert into public.events (event_id, organiser_id, organisation, name)
          values (92610, 'b0000000-0000-4000-8000-000000000001', 'Example A', 'Anonymous event');
      end if;
      raise exception '[SG2-26:anonymous-insert] [FAILURE] Anonymous callers must not insert into %', object_name;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;

-- Privileged API operations remain possible, including sequence-backed inserts.
set local role service_role;
do $$
declare
  created_id integer;
begin
  if (select count(*) from public.events where event_id between 92601 and 92609) <> 9 then
    raise exception '[SG2-26:service-event-list] [NORMAL] The API service role must retain access across organisations';
  end if;
  insert into public.events (organiser_id, organisation, name) values
    ('b0000000-0000-4000-8000-000000000001', 'Example A', 'Service-created event')
    returning event_id into created_id;
  if created_id is null or not exists (
    select 1 from public.events
    where event_id = created_id
      and organiser_id = 'b0000000-0000-4000-8000-000000000001'
      and organisation = 'Example A'
      and name = 'Service-created event'
  ) then
    raise exception '[SG2-26:service-event-insert] [NORMAL] The API service role must persist the new event';
  end if;
  update public.events set name = 'Service-updated event' where event_id = created_id;
  if (select name from public.events where event_id = created_id)
      is distinct from 'Service-updated event' then
    raise exception '[SG2-26:service-event-update] [NORMAL] The API service role must persist event updates';
  end if;
  delete from public.events where event_id = created_id;
  if exists (select 1 from public.events where event_id = created_id) then
    raise exception '[SG2-26:service-event-delete] [NORMAL] The API service role must remove deleted events';
  end if;
  update public.users set organisation = 'Example B'
    where user_id = 'b0000000-0000-4000-8000-000000000001';
end $$;

-- Membership changes are effective immediately with the same identity claims.
set local role authenticated;
do $$
begin
  if (select array_agg(event_id) from public.events) is distinct from array[92603] then
    raise exception '[SG2-26:changed-membership] [SG2-26:AC1] [CONFLICT] Current server-owned membership must determine event access';
  end if;
end $$;

reset role;
rollback;
