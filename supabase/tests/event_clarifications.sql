-- Review trace: SG2-36 clarification exchange.
-- Numeric AC tags follow the SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- SG2-36: the needs_clarification status and event_clarifications policy checks.
-- Disposable local/CI test script. All changes are rolled back.
begin;

-- Seed test identities:
-- 1: coordinator (internal staff, assigned to event 93601)
-- 2: organiser A (owns event 93601)
-- 3: organiser B (owns event 93602)
-- 4: attendee (external user)
-- 5: coordinator 2 (internal staff, assigned to event 93604 only)
-- 6: venue staff (internal staff, no part in any exchange)
insert into auth.users (id) values
  ('d0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000002'),
  ('d0000000-0000-4000-8000-000000000003'),
  ('d0000000-0000-4000-8000-000000000004'),
  ('d0000000-0000-4000-8000-000000000005'),
  ('d0000000-0000-4000-8000-000000000006');

insert into public.users (user_id, name, organisation, role_id) values
  ('d0000000-0000-4000-8000-000000000001', 'Coordinator C', 'Acme Corp', 2),
  ('d0000000-0000-4000-8000-000000000002', 'Organiser A', 'Acme Corp', 1),
  ('d0000000-0000-4000-8000-000000000003', 'Organiser B', 'Beta Inc', 1),
  ('d0000000-0000-4000-8000-000000000004', 'Attendee D', 'Acme Corp', 5),
  ('d0000000-0000-4000-8000-000000000005', 'Coordinator E', 'Acme Corp', 2),
  ('d0000000-0000-4000-8000-000000000006', 'Venue Staff V', 'Acme Corp', 3);

insert into public.account_roles (user_id, role) values
  ('d0000000-0000-4000-8000-000000000001', 'event_coordinator'),
  ('d0000000-0000-4000-8000-000000000002', 'event_organiser'),
  ('d0000000-0000-4000-8000-000000000003', 'event_organiser'),
  ('d0000000-0000-4000-8000-000000000004', 'attendee'),
  ('d0000000-0000-4000-8000-000000000005', 'event_coordinator'),
  ('d0000000-0000-4000-8000-000000000006', 'venue_staff');

insert into public.events (event_id, organiser_id, coordinator_id, organisation, name, status) values
  (93601, 'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'Acme Corp', 'Event A', 'under_review'),
  (93602, 'd0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 'Beta Inc', 'Event B', 'under_review'),
  (93603, 'd0000000-0000-4000-8000-000000000002', null, 'Acme Corp', 'Event without questions', 'submitted'),
  (93604, 'd0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000005', 'Beta Inc', 'Event D', 'under_review');

insert into public.event_clarifications (event_id, sender_id, message, created_at) values
  (93601, 'd0000000-0000-4000-8000-000000000001', 'Is the date firm?', '2026-10-01 02:00:00+00'),
  (93601, 'd0000000-0000-4000-8000-000000000002', 'Yes, 12 October.', '2026-10-01 03:00:00+00'),
  (93602, 'd0000000-0000-4000-8000-000000000001', 'How many guests?', '2026-10-01 04:00:00+00'),
  (93604, 'd0000000-0000-4000-8000-000000000005', 'Is catering needed?', '2026-10-01 05:00:00+00');

-- 1. Status and table constraints, as the API's service role writes them:
do $$
begin
  update public.events set status = 'needs_clarification' where event_id = 93601;
  if not exists (select 1 from public.events where event_id = 93601 and status = 'needs_clarification') then
    raise exception '[SG2-36:returned-status] [SG2-36:AC1] [NORMAL] A request returned for clarification must store the needs_clarification status';
  end if;
  if not exists (select 1 from public.event_clarifications where event_id = 93601
      and sender_id = 'd0000000-0000-4000-8000-000000000001'
      and message = 'Is the date firm?' and created_at = '2026-10-01 02:00:00+00') then
    raise exception '[SG2-36:stored-clarification] [SG2-36:AC3] [NORMAL] A message must keep its event, sender, text and timestamp';
  end if;
  insert into public.event_clarifications (event_id, sender_id, message)
    values (93601, 'd0000000-0000-4000-8000-000000000001', '?');
  if not exists (select 1 from public.event_clarifications where event_id = 93601 and message = '?'
      and created_at is not null) then
    raise exception '[SG2-36:shortest-clarification] [SG2-36:AC1] [BOUNDARY] A one-character message must be accepted and timestamped';
  end if;
  begin
    insert into public.event_clarifications (event_id, sender_id, message)
      values (93601, 'd0000000-0000-4000-8000-000000000001', '   ');
    raise exception '[SG2-36:blank-clarification] [SG2-36:AC1] [BOUNDARY] A whitespace-only message should have been rejected';
  exception when check_violation then null;
  end;
  begin
    insert into public.event_clarifications (event_id, sender_id, message)
      values (-1, 'd0000000-0000-4000-8000-000000000001', 'Orphan');
    raise exception '[SG2-36:clarification-event-reference] [FAILURE] A message must reference an existing event';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.event_clarifications (event_id, sender_id, message)
      values (93601, 'd0000000-0000-4000-8000-000000000099', 'Unknown sender');
    raise exception '[SG2-36:clarification-sender-reference] [FAILURE] A message must reference an existing sender';
  exception when foreign_key_violation then null;
  end;
end $$;

-- 2. A coordinator reads only the threads on requests assigned to them, and
-- cannot write one directly:
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.event_clarifications where event_id in (93601, 93602)) <> 4 then
    raise exception '[SG2-36:coordinator-thread-read] [SG2-36:AC3] [NORMAL] The coordinator should see every message on their assigned requests';
  end if;
  if exists (select 1 from public.event_clarifications where event_id = 93604) then
    raise exception '[SG2-36:unassigned-coordinator-thread] [SG2-36:AC3] [FAILURE] A coordinator must NOT see the thread on a request assigned to someone else';
  end if;
  begin
    insert into public.event_clarifications (event_id, sender_id, message)
      values (93601, 'd0000000-0000-4000-8000-000000000001', 'Bypassing the API');
    raise exception '[SG2-36:coordinator-thread-insert] [FAILURE] Direct insert by a coordinator should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 3. Organiser A reads only the thread on their own event:
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.event_clarifications where event_id = 93601) <> 3 then
    raise exception '[SG2-36:organiser-thread-read] [SG2-36:AC1] [SG2-36:AC3] [NORMAL] Organiser A must see every message on their own event';
  end if;
  if exists (select 1 from public.event_clarifications where event_id = 93603) then
    raise exception '[SG2-36:empty-thread] [SG2-36:AC3] [BOUNDARY] An owned event with no questions must have an empty thread';
  end if;
  if exists (select 1 from public.event_clarifications where event_id = 93602) then
    raise exception '[SG2-36:other-organiser-thread] [SG2-36:AC3] [FAILURE] Organiser A must NOT see the thread on another organiser''s event';
  end if;
  begin
    insert into public.event_clarifications (event_id, sender_id, message)
      values (93601, 'd0000000-0000-4000-8000-000000000002', 'Bypassing the API');
    raise exception '[SG2-36:organiser-thread-insert] [FAILURE] Direct insert by an organiser should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- The exchange is a record: no signed-in role may rewrite or remove it.
do $$
declare caller uuid;
begin
  foreach caller in array array[
    'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002',
    'd0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000004',
    'd0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000006'
  ]::uuid[] loop
    perform set_config('request.jwt.claim.sub', caller::text, true);
    begin
      update public.event_clarifications set message = 'Rewritten' where event_id = 93601;
      raise exception '[SG2-36:direct-thread-update] [SG2-36:AC3] [FAILURE] Caller % must not rewrite the exchange', caller;
    exception when insufficient_privilege then null;
    end;
    begin
      delete from public.event_clarifications where event_id = 93601;
      raise exception '[SG2-36:direct-thread-delete] [SG2-36:AC3] [FAILURE] Caller % must not delete the exchange', caller;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;

-- 4. Venue staff and attendees take no part in any exchange:
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000006', true);
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000006","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.event_clarifications) <> 0 then
    raise exception '[SG2-36:venue-staff-thread-read] [SG2-36:AC3] [FAILURE] Venue staff should see no clarification messages';
  end if;
end $$;

select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.event_clarifications) <> 0 then
    raise exception '[SG2-36:attendee-thread-read] [SG2-36:AC3] [FAILURE] An attendee should see no clarification messages';
  end if;
end $$;

-- 5. An anonymous caller can neither read nor write:
set local role anon;
do $$
begin
  begin
    perform * from public.event_clarifications;
    raise exception '[SG2-36:anonymous-thread-read] [SG2-36:AC3] [FAILURE] Anonymous caller should not be able to read clarifications';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.event_clarifications (event_id, sender_id, message)
      values (93601, 'd0000000-0000-4000-8000-000000000001', 'Anonymous');
    raise exception '[SG2-36:anonymous-thread-insert] [FAILURE] Anonymous caller should not be able to write clarifications';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 6. Read access follows the current assignment and role, not past ones:
reset role;
set local role service_role;
update public.events set coordinator_id = 'd0000000-0000-4000-8000-000000000005'
  where event_id = 93602;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.event_clarifications where event_id = 93602) then
    raise exception '[SG2-36:reassigned-thread-access] [SG2-36:AC3] [CONFLICT] A coordinator must lose the thread as soon as the request is reassigned';
  end if;
  if (select count(*) from public.event_clarifications where event_id = 93601) <> 3 then
    raise exception '[SG2-36:retained-thread-access] [SG2-36:AC3] [CONFLICT] Reassigning one request must not affect the coordinator''s other threads';
  end if;
end $$;
reset role;
set local role service_role;
update public.account_roles set role = 'attendee'
  where user_id = 'd0000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.event_clarifications) then
    raise exception '[SG2-36:revoked-thread-access] [SG2-36:AC3] [CONFLICT] Thread access must disappear as soon as the internal role is revoked';
  end if;
end $$;
reset role;
rollback;
