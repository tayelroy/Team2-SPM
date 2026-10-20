-- SG2-92 with SG2-91: a safety decision is made on the review the Safety
-- Officer saw. SG2-91's safety_check_queue() returns each event's
-- safety_check_revision, which changes whenever the event enters or leaves
-- Awaiting Safety Check or anything the review shows changes while it waits
-- (safety_check_track_event and the arrangement triggers in
-- 202610190004_safety_check_queue.sql). The decision now carries that
-- revision, and record_safety_decision() refuses it as stale when the event
-- has moved on since, so a decision never lands on details the Safety
-- Officer did not review.
--
-- Replaces the five-argument function from 202610190005_safety_decisions.sql
-- (already applied on the hosted project) rather than editing that file. The
-- body is unchanged apart from the revision check, made under the same row
-- lock after the status check. Grants are restated for the new signature.
begin;

drop function public.record_safety_decision(integer, uuid, text, text, jsonb);

create function public.record_safety_decision(
  p_event_id integer,
  p_actor_id uuid,
  p_decision text,
  p_reason text,
  p_arrangements jsonb,
  p_expected_revision bigint
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  -- Mirrors SAFETY_ARRANGEMENTS and SAFETY_ARRANGEMENT_LABELS.
  allowed constant text[] := array['venue', 'equipment', 'other'];
  labels constant text[] := array['Venue', 'Equipment and technical', 'Other'];
  e public.events;
  reason text;
  item jsonb;
  named text[] := array[]::text[];
  named_labels text;
  next_status public.event_status;
  decision_row public.event_safety_decisions;
  audit text;
  event_label text;
  message text;
begin
  if p_actor_id is null or not exists(
      select 1 from public.account_roles where user_id = p_actor_id and role = 'safety_officer') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  select * into e from public.events where event_id = p_event_id for update;
  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if e.status is distinct from 'awaiting_safety_check' then
    return jsonb_build_object('outcome', 'closed', 'status', e.status::text);
  end if;
  -- The review the Safety Officer saw is no longer the event as it stands.
  if p_expected_revision is null or e.safety_check_revision is distinct from p_expected_revision then
    return jsonb_build_object('outcome', 'stale', 'revision', e.safety_check_revision);
  end if;

  -- AC2, exactly as validateSafetyDecision.
  if p_decision is null or p_decision not in ('approve', 'reject', 'request_changes') then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  reason := nullif(regexp_replace(coalesce(p_reason, ''), '^\s+|\s+$', '', 'g'), '');
  if char_length(reason) > 2000 or (p_decision <> 'approve' and reason is null) then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if p_arrangements is not null and jsonb_typeof(p_arrangements) <> 'null' then
    if jsonb_typeof(p_arrangements) <> 'array' then
      return jsonb_build_object('outcome', 'invalid');
    end if;
    for item in select value from jsonb_array_elements(p_arrangements) loop
      if jsonb_typeof(item) <> 'string' or not (item #>> '{}') = any(allowed) or (item #>> '{}') = any(named) then
        return jsonb_build_object('outcome', 'invalid');
      end if;
      named := named || (item #>> '{}');
    end loop;
  end if;
  if (p_decision = 'request_changes') <> (cardinality(named) > 0) then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  next_status := case p_decision
    when 'approve' then 'preparation'
    when 'reject' then 'safety_rejected'
    else 'planning' end;
  insert into public.event_safety_decisions (event_id, decision, reason, arrangements, decided_by)
    values (p_event_id, p_decision, reason, named, p_actor_id)
    returning * into decision_row;
  update public.events set status = next_status where event_id = p_event_id;

  select string_agg(labels[array_position(allowed, n)], ', ' order by position)
    into named_labels from unnest(named) with ordinality as names(n, position);
  audit := case p_decision
    when 'approve' then 'Approved' || coalesce(': ' || reason, '')
    when 'reject' then 'Rejected: ' || reason
    else 'Changes requested (' || named_labels || '): ' || reason end;
  insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
    values (p_event_id, p_actor_id, 'safety_decision', null, audit),
           (p_event_id, p_actor_id, 'status', e.status::text, next_status::text);

  -- AC5. Same wording as eventNoticeMessages.safety* in server/src/db/eventNotifications.ts.
  event_label := left(coalesce(nullif(e.name, ''), 'Untitled event'), 500);
  message := left(case p_decision
    when 'approve' then event_label || ' passed its operational safety check and has moved to Preparation.'
      || coalesce(' Note: ' || reason, '')
    when 'reject' then event_label || ' did not pass its operational safety check: ' || reason
      || '. The coordinator will rework the arrangements for a new check.'
    else event_label || ' needs changes before it can pass its operational safety check (' || named_labels
      || '): ' || reason || '. It has moved back to Planning.' end, 2000);
  if e.organiser_id is not null then
    insert into public.notifications (recipient_id, event_id, kind, message)
      values (e.organiser_id, p_event_id, 'safety_decision', message);
  end if;
  if e.coordinator_id is not null and e.coordinator_id is distinct from e.organiser_id then
    insert into public.notifications (recipient_id, event_id, kind, message)
      values (e.coordinator_id, p_event_id, 'safety_decision', message);
  end if;

  return jsonb_build_object('outcome', 'ok', 'decision_id', decision_row.decision_id,
    'decision', decision_row.decision, 'previous_status', e.status::text, 'status', next_status::text,
    'decided_at', decision_row.decided_at);
end;
$$;
revoke all on function public.record_safety_decision(integer, uuid, text, text, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.record_safety_decision(integer, uuid, text, text, jsonb, bigint) to service_role;

commit;
