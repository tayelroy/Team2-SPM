-- SG2-66: be shown what a change would break.
--
-- AC4: accepting a change request applies it in one transaction under the
-- event row lock. When arrangements are affected they are marked outstanding
-- (SG2-39's recheck keys, which confirm_event already refuses on) and an
-- event that had moved on (Awaiting Safety Check, Preparation, Confirmed)
-- returns to Planning with its confirmation stamp cleared, so every check
-- runs again before it can be confirmed. An Approved event moves to Planning
-- as its normal next step. There is no safety-approval record yet; SG2-92
-- must clear its record here when it adds one.
-- AC7: the organiser and the assigned coordinator are told the event is back
-- in Planning (the coordinator too, although they accepted the change: AC7
-- names both), and the move is in the event's history.
--
-- The server reads the facts, computes the impact and calls these with the
-- service role after checking the caller is the assigned coordinator; the
-- functions recheck status and assignment under the lock (stale otherwise).
begin;

-- Rebuilds the list 202610170001 (SG2-81) left, so every earlier kind stays allowed.
alter table public.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check check (kind in
    ('venue_request_approved', 'venue_request_rejected', 'venue_booking_released',
     'equipment_reserved', 'venue_booking_clash', 'event_confirmed',
     'event_submitted', 'coordinator_assigned', 'clarification_requested',
     'event_approved', 'event_rejected', 'venue_unavailable', 'event_returned_to_planning'));

create function public.apply_accepted_event_change(
  p_event_id integer,
  p_actor_id uuid,
  p_expected_status public.event_status,
  p_change_reference text,
  p_changes jsonb,
  p_outstanding jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  -- Mirrors CHANGEABLE_FIELDS in server/src/events/changeImpact.ts.
  allowed constant text[] := array['proposed_date', 'expected_attendance', 'venue_requirements',
    'accessibility_needs', 'equipment_requirements', 'name', 'purpose', 'description'];
  -- Mirrors RECHECK_KEYS.
  recheck_keys constant text[] := array['venue_recheck', 'equipment_recheck', 'registration_recheck'];
  -- Mirrors RETURNS_TO_PLANNING.
  returns_to_planning constant public.event_status[] :=
    array['awaiting_safety_check', 'preparation', 'confirmed']::public.event_status[];
  e public.events;
  n public.events;
  field text;
  key text;
  accepted jsonb := '{}'::jsonb;
  added text[] := array[]::text[];
  outstanding jsonb;
  next_status public.event_status;
  returned boolean;
  label text;
begin
  select * into e from public.events where event_id = p_event_id for update;
  if not found or p_actor_id is null or e.status is distinct from p_expected_status
      or e.coordinator_id is distinct from p_actor_id then
    return jsonb_build_object('outcome', 'stale');
  end if;

  -- Only whitelisted keys are applied; anything else in p_changes is ignored.
  if jsonb_typeof(p_changes) = 'object' then
    foreach field in array allowed loop
      if p_changes ? field then accepted := accepted || jsonb_build_object(field, p_changes -> field); end if;
    end loop;
  end if;
  n := jsonb_populate_record(e, accepted);
  foreach field in array allowed loop
    if accepted ? field and (to_jsonb(e) -> field) is distinct from (to_jsonb(n) -> field) then
      insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
        values (p_event_id, p_actor_id, field, to_jsonb(e) ->> field, accepted ->> field);
    end if;
  end loop;
  insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
    values (p_event_id, p_actor_id, 'change_request', null, 'Accepted ' || coalesce(p_change_reference, 'change request'));

  if jsonb_typeof(p_outstanding) = 'array' then
    for key in select value from jsonb_array_elements_text(p_outstanding) loop
      if key = any(recheck_keys) and not key = any(added) then added := added || key; end if;
    end loop;
  end if;
  outstanding := coalesce(e.outstanding_arrangements, '[]'::jsonb);
  foreach key in array added loop
    if not outstanding @> jsonb_build_array(key) then outstanding := outstanding || jsonb_build_array(key); end if;
  end loop;

  next_status := e.status;
  returned := cardinality(added) > 0 and e.status = any(returns_to_planning);
  if cardinality(added) > 0 and (returned or e.status = 'approved') then
    next_status := 'planning';
  end if;

  update public.events set
    proposed_date = n.proposed_date,
    expected_attendance = n.expected_attendance,
    venue_requirements = n.venue_requirements,
    accessibility_needs = n.accessibility_needs,
    equipment_requirements = n.equipment_requirements,
    name = n.name,
    purpose = n.purpose,
    description = n.description,
    arrangements_recheck_needed = case when cardinality(added) > 0 then true else e.arrangements_recheck_needed end,
    outstanding_arrangements = outstanding,
    status = next_status,
    confirmed_by = case when returned then null else e.confirmed_by end,
    confirmed_at = case when returned then null else e.confirmed_at end
  where event_id = p_event_id
  returning * into n;

  if next_status is distinct from e.status then
    insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
      values (p_event_id, p_actor_id, 'status', e.status::text, next_status::text);
  end if;
  if returned then
    -- Same wording as eventNoticeMessages.returnedToPlanning* in server/src/db/eventNotifications.ts.
    label := left(coalesce(nullif(n.name, ''), 'Untitled event'), 500);
    insert into public.notifications (recipient_id, event_id, kind, message)
      values (n.organiser_id, p_event_id, 'event_returned_to_planning',
        label || ' has moved back to Planning. Its arrangements are being rechecked before it can be confirmed again.');
    if n.coordinator_id is distinct from n.organiser_id then
      insert into public.notifications (recipient_id, event_id, kind, message)
        values (n.coordinator_id, p_event_id, 'event_returned_to_planning',
          label || ' is back in Planning. Recheck its outstanding arrangements before it goes through the safety check again.');
    end if;
  end if;

  return jsonb_build_object('outcome', 'ok', 'previous_status', e.status::text, 'status', n.status::text,
    'returned_to_planning', returned, 'arrangements_recheck_needed', n.arrangements_recheck_needed,
    'outstanding_arrangements', n.outstanding_arrangements);
end;
$$;
revoke all on function public.apply_accepted_event_change(integer, uuid, public.event_status, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_accepted_event_change(integer, uuid, public.event_status, text, jsonb, jsonb)
  to service_role;

-- AC4: the coordinator marks one outstanding recheck settled once the server
-- has found its arrangements pass again. The last one clears the flag.
create function public.settle_arrangement_recheck(p_event_id integer, p_actor_id uuid, p_key text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  e public.events;
  remaining jsonb;
begin
  select * into e from public.events where event_id = p_event_id for update;
  if not found or p_actor_id is null or e.coordinator_id is distinct from p_actor_id then
    return jsonb_build_object('outcome', 'stale');
  end if;
  if p_key is null or not coalesce(e.outstanding_arrangements, '[]'::jsonb) @> jsonb_build_array(p_key) then
    return jsonb_build_object('outcome', 'not_outstanding');
  end if;
  select coalesce(jsonb_agg(item order by position), '[]'::jsonb) into remaining
    from jsonb_array_elements(e.outstanding_arrangements) with ordinality as entries(item, position)
    where item <> to_jsonb(p_key);
  update public.events
    set outstanding_arrangements = remaining, arrangements_recheck_needed = jsonb_array_length(remaining) > 0
    where event_id = p_event_id;
  insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
    values (p_event_id, p_actor_id, 'arrangement_recheck', null, p_key || ' settled');
  return jsonb_build_object('outcome', 'ok', 'arrangements_recheck_needed', jsonb_array_length(remaining) > 0,
    'outstanding_arrangements', remaining);
end;
$$;
revoke all on function public.settle_arrangement_recheck(integer, uuid, text) from public, anon, authenticated;
grant execute on function public.settle_arrangement_recheck(integer, uuid, text) to service_role;

commit;
