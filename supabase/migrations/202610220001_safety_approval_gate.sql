-- SG2-94: block preparation until the safety check is approved.
--
-- An event's safety approval is its latest SG2-92 decision when that decision
-- is Approve and the event has not left Preparation or Confirmed since. Every
-- way back (an accepted change, a planning edit, an unavailable venue) moves
-- the event to Planning, so the approval stops counting without touching the
-- append-only decision history; event_safety_approved() reads that rule.
--
-- AC1/AC2  safety_approval_gate refuses any move into Preparation unless the
--          event is leaving Awaiting Safety Check on an Approve decision made
--          during that wait. record_safety_decision() is the only writer that
--          passes; anything else is refused with the reason.
-- AC3      apply_accepted_event_change() withdraws the approval when an
--          accepted change alters a significant field (date/time, attendance,
--          venue, accessibility or equipment requirements) of an event in
--          Preparation or Confirmed: the event returns to Planning, the
--          withdrawal is in its history, and it must pass the check again
--          (SG2-91 moves it back to Awaiting Safety Check once its
--          arrangements are in place).
-- AC4/AC5  confirm_event() lists 'safety' among the outstanding items unless
--          the event holds a current approval, and answers an attempt on an
--          event still in Approved, Planning, Awaiting Safety Check or Safety
--          Rejected with what is outstanding (safety included) instead of
--          just "closed". The TypeScript mirror is
--          server/src/events/arrangementReadiness.ts.
-- AC6      Registration settings no longer block confirmation: an event that
--          needs registration can be confirmed before its capacity and times
--          are set (the organiser sets them, SG2-63). An outstanding
--          registration recheck (SG2-66) still does.
begin;

-- AC2/AC5: the approval that lets an event be in Preparation or be confirmed.
create function public.event_safety_approved(p_event public.events)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_event.status in ('preparation', 'confirmed')
    and coalesce((select d.decision = 'approve' from public.event_safety_decisions d
      where d.event_id = p_event.event_id
      order by d.decided_at desc, d.decision_id desc limit 1), false);
$$;
revoke all on function public.event_safety_approved(public.events) from public, anon, authenticated;

-- AC1/AC2: the only way into Preparation is an Approve decision made while
-- the event was awaiting this check. Inserting a row is not a move and is
-- left to the existing grants (only the server and definer functions write
-- events).
create function public.safety_approval_gate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  latest public.event_safety_decisions;
begin
  select * into latest from public.event_safety_decisions
    where event_id = new.event_id order by decided_at desc, decision_id desc limit 1;
  if old.status is distinct from 'awaiting_safety_check' or latest.decision is distinct from 'approve'
      or old.awaiting_safety_check_since is null or latest.decided_at < old.awaiting_safety_check_since then
    raise exception using errcode = 'check_violation', constraint = 'events_preparation_needs_safety_approval',
      message = 'An event can move to Preparation only once the Safety Officer has approved its safety check.',
      detail = 'Event ' || new.event_id || ' is ' || old.status || ' and its latest safety decision is '
        || coalesce(latest.decision, 'none') || '.';
  end if;
  return new;
end;
$$;
revoke all on function public.safety_approval_gate() from public, anon, authenticated;

create trigger safety_approval_gate before update of status on public.events
  for each row when (new.status = 'preparation' and old.status is distinct from 'preparation')
  execute function public.safety_approval_gate();

-- AC3: unchanged from 202610190003_event_change_impact.sql (SG2-66) except
-- that a significant change to an event in Preparation or Confirmed always
-- returns it to Planning, withdrawing its safety approval, even when no
-- recheck key was named; the withdrawal is recorded in its history.
create or replace function public.apply_accepted_event_change(
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
  -- Mirrors SIGNIFICANT_CHANGE_FIELDS.
  significant constant text[] := array['proposed_date', 'expected_attendance', 'venue_requirements',
    'accessibility_needs', 'equipment_requirements'];
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
  changed_significant boolean := false;
  was_approved boolean;
  withdrawn boolean;
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
      if field = any(significant) then changed_significant := true; end if;
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

  -- SG2-94 AC3: what was approved has changed, so the approval cannot stand.
  was_approved := public.event_safety_approved(e);
  withdrawn := changed_significant and e.status in ('preparation', 'confirmed');
  next_status := e.status;
  returned := (cardinality(added) > 0 and e.status = any(returns_to_planning)) or withdrawn;
  if returned or (cardinality(added) > 0 and e.status = 'approved') then
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
  if withdrawn and was_approved then
    insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
      values (p_event_id, p_actor_id, 'safety_approval', 'Approved',
        'Withdrawn: the accepted ' || coalesce(p_change_reference, 'change request')
          || ' changed what was approved, so the event must pass the safety check again');
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
  -- With no recheck named, nothing else refreshes the event: an event whose
  -- arrangements are all still in place goes straight back to the check.
  if withdrawn and cardinality(added) = 0 then
    perform public.refresh_safety_check_status(p_event_id);
    select * into n from public.events where event_id = p_event_id;
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

-- AC4/AC5/AC6: unchanged from 202610200002_acting_role_functions.sql (SG2-104)
-- except the status gate, the safety item and the registration rule.
create or replace function public.confirm_event(p_event_id integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  caller_role text;
  event_row public.events;
  outstanding text[] := array[]::text[];
  instant timestamptz;
begin
  if caller is null then raise exception using errcode = '42501', message = 'Access denied'; end if;
  -- A stored role change that wins this lock takes effect before any write.
  caller_role := public.lock_acting_role();
  if caller_role is distinct from 'event_coordinator' then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;

  -- Every writer of venue requests/bookings and equipment requests/receipts
  -- locks this row first, and planning edits update it. Locking it before
  -- reading any child row serialises confirmation against all of them; the
  -- readiness statements below run after the wait and see committed changes.
  select * into event_row from public.events where event_id = p_event_id for update;
  if not found or event_row.coordinator_id is distinct from caller then
    return jsonb_build_object('outcome', 'missing');
  end if;
  -- SG2-94 AC5: an event still on its way to the safety check is refused with
  -- what is outstanding, the check included; later and closed statuses are not
  -- confirmable at all.
  if event_row.status not in ('approved', 'planning', 'awaiting_safety_check', 'safety_rejected', 'preparation') then
    return jsonb_build_object('outcome', 'closed', 'status', event_row.status::text);
  end if;

  -- Readiness rules are shared with server/src/events/arrangementReadiness.ts.
  -- SG2-82: every request except a cancelled (withdrawn or released) one is
  -- a venue the event needs (case-insensitive); pending or rejected ones are
  -- outstanding.
  if (event_row.arrangements_recheck_needed is true
      and coalesce(event_row.outstanding_arrangements, '[]'::jsonb) @> '["venue_recheck"]'::jsonb)
    or not exists (select 1 from public.venue_booking_requests r
      where r.event_id = p_event_id and lower(r.status) <> 'cancelled')
    or exists (select 1 from public.venue_booking_requests r
      where r.event_id = p_event_id and lower(r.status) in ('pending', 'rejected'))
    -- An approved request counts only while a confirmed booking is linked to
    -- it, directly or through the hold it was converted from.
    or exists (select 1 from public.venue_booking_requests r
      where r.event_id = p_event_id and lower(r.status) = 'approved'
        and not exists (select 1 from public.venue_bookings b
          where b.status = 'confirmed'
            and (b.booking_id = r.venue_booking_id
              or b.booking_id in (select h.booking_id from public.venue_holds h
                where h.request_id = r.request_id))))
    -- SG2-81: a confirmed booking the venue's unavailability affects is
    -- outstanding until it is replaced and released.
    or exists (select 1 from public.venue_booking_disruptions d
      join public.venue_bookings b on b.booking_id = d.booking_id
      where b.event_id = p_event_id and b.status = 'confirmed') then
    outstanding := outstanding || 'venue'::text;
  end if;
  if (event_row.arrangements_recheck_needed is true
      and coalesce(event_row.outstanding_arrangements, '[]'::jsonb) @> '["equipment_recheck"]'::jsonb)
    or exists (select 1 from public.equipment_requests r
      where r.event_id = p_event_id and lower(r.status) not in ('rejected', 'cancelled')
        and (r.placement_venue_id is null or r.shortfall is distinct from 0
          or not exists (select 1 from public.equipment_reservations receipt
            where receipt.request_id = r.request_id))) then
    outstanding := outstanding || 'equipment'::text;
  end if;
  -- AC6: only a recheck holds registration up; unset settings do not.
  if event_row.arrangements_recheck_needed is true
      and coalesce(event_row.outstanding_arrangements, '[]'::jsonb) @> '["registration_recheck"]'::jsonb then
    outstanding := outstanding || 'registration'::text;
  end if;
  -- AC5: the latest safety decision must be a current Approve.
  if not public.event_safety_approved(event_row) then
    outstanding := outstanding || 'safety'::text;
  end if;
  if cardinality(outstanding) > 0 then
    return jsonb_build_object('outcome', 'outstanding', 'outstanding', to_jsonb(outstanding));
  end if;

  instant := clock_timestamp();
  update public.events set status = 'confirmed', confirmed_by = caller, confirmed_at = instant
    where event_id = p_event_id;
  -- AC1: the confirmation appears in the event's history (SG2-40).
  insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
    values (p_event_id, caller, 'status', 'preparation', 'confirmed');
  insert into public.notifications (recipient_id, event_id, kind, message)
    values (event_row.organiser_id, p_event_id, 'event_confirmed',
      'Your event ' || left(coalesce(nullif(event_row.name, ''), 'Untitled event'), 500) || ' is confirmed.');

  return jsonb_build_object('outcome', 'ok', 'event_id', p_event_id, 'status', 'confirmed',
    'confirmed_at', instant, 'organiser_notified', true);
end;
$$;
-- Replacing a function keeps its privileges; restated so the rule is visible.
revoke all on function public.confirm_event(integer) from public, anon, authenticated;
grant execute on function public.confirm_event(integer) to authenticated;

commit;
