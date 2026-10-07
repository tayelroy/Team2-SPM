-- SG2-100 AC1, AC6, AC8: the public.event_status enum carries the Week 7
-- lifecycle values and defaults, and the completion columns added by
-- 202610080003_event_completion.sql cannot be half-written.
-- Disposable local/CI test script. All changes are rolled back.
begin;

insert into auth.users (id) values
  ('c5a00000-0000-4000-8000-000000000001'),
  ('c5a00000-0000-4000-8000-000000000002');
insert into public.users (user_id, name, organisation, role_id) values
  ('c5a00000-0000-4000-8000-000000000001', 'Status Flow Organiser', 'Acme Corp', 1),
  ('c5a00000-0000-4000-8000-000000000002', 'Status Flow Coordinator', 'Acme Corp', 2);
insert into public.account_roles (user_id, role) values
  ('c5a00000-0000-4000-8000-000000000001', 'event_organiser'),
  ('c5a00000-0000-4000-8000-000000000002', 'event_coordinator');

-- 1. AC1: all 14 values are present, in the order each migration added them.
do $$
declare values_found text[];
begin
  select array_agg(enumlabel order by enumsortorder) into values_found
    from pg_enum where enumtypid = 'public.event_status'::regtype;

  if values_found <> array[
    'draft', 'submitted', 'under_review', 'approved', 'planning',
    'confirmed', 'completed', 'cancelled', 'rejected', 'needs_clarification',
    'unassigned', 'awaiting_safety_check', 'safety_rejected', 'preparation'
  ] then
    raise exception '[SG2-100:all-14-statuses] [SG2-100:AC1] [NORMAL] public.event_status must contain exactly the 14 documented values in order, got: %', values_found;
  end if;
  if array_length(values_found, 1) <> 14 then
    raise exception '[SG2-100:fourteen-statuses] [SG2-100:AC1] [BOUNDARY] public.event_status must have exactly 14 values, got %', array_length(values_found, 1);
  end if;
end $$;

-- 2. AC1: the default for a new row is still 'draft', unaffected by the widening.
do $$
begin
  insert into public.events (event_id, organiser_id, name)
    values (95801, 'c5a00000-0000-4000-8000-000000000001', 'Default Status Forum');
  if not exists (select 1 from public.events where event_id = 95801 and status = 'draft') then
    raise exception '[SG2-100:default-status-draft] [SG2-100:AC1] [NORMAL] A new event must still default to draft';
  end if;
end $$;

-- 3. AC1: an unrecognised status string is rejected, not silently coerced.
do $$
begin
  begin
    insert into public.events (event_id, organiser_id, name, status)
      values (95802, 'c5a00000-0000-4000-8000-000000000001', 'Invalid Status Forum', 'archived');
    raise exception '[SG2-100:invalid-status-rejected] [SG2-100:AC1] [FAILURE] An event status outside the enum must be rejected';
  exception when invalid_text_representation then null;
  end;
end $$;

-- 4. AC6/AC8: completed_by and completed_at always travel together.
do $$
begin
  insert into public.events (event_id, organiser_id, coordinator_id, name, status)
    values (95803, 'c5a00000-0000-4000-8000-000000000001', 'c5a00000-0000-4000-8000-000000000002', 'Half-Completed Forum', 'confirmed');

  begin
    update public.events set completed_by = 'c5a00000-0000-4000-8000-000000000002' where event_id = 95803;
    raise exception '[SG2-100:completed-by-needs-completed-at] [SG2-100:AC8] [FAILURE] completed_by without completed_at should have been rejected';
  exception when check_violation then null;
  end;

  if exists (select 1 from public.events where event_id = 95803 and completed_by is not null) then
    raise exception '[SG2-100:rejected-completed-by-not-persisted] [SG2-100:AC8] [CONFLICT] A rejected half-completion must leave completed_by unset';
  end if;

  -- 5. AC6: a status of 'completed' always carries a completed_at.
  begin
    update public.events set status = 'completed' where event_id = 95803;
    raise exception '[SG2-100:completed-status-needs-completed-at] [SG2-100:AC6] [FAILURE] A completed status without completed_at should have been rejected';
  exception when check_violation then null;
  end;

  if exists (select 1 from public.events where event_id = 95803 and status = 'completed') then
    raise exception '[SG2-100:rejected-completed-status-not-persisted] [SG2-100:AC6] [CONFLICT] A rejected completion must leave the status unchanged';
  end if;

  -- The well-formed pair that satisfies both constraints at once.
  update public.events set status = 'completed', completed_by = 'c5a00000-0000-4000-8000-000000000002',
      completed_at = '2026-10-07T00:00:00+00'
    where event_id = 95803;
  if not exists (select 1 from public.events where event_id = 95803 and status = 'completed'
      and completed_by = 'c5a00000-0000-4000-8000-000000000002' and completed_at is not null) then
    raise exception '[SG2-100:well-formed-completion-persists] [SG2-100:AC6] [NORMAL] A completion recorded together with its status change must be stored';
  end if;
end $$;

rollback;
