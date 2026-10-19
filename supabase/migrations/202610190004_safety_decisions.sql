-- SG2-92: record an operational safety check decision.
--
-- AC1: the Safety Officer decides an event Awaiting Safety Check: Approve,
-- Reject or Request Changes. AC2: Reject and Request Changes need a reason,
-- and Request Changes names the arrangements to change. AC3: Approve moves
-- the event on to Preparation. AC4: Reject leaves it Safety Rejected, which
-- cannot move on to Preparation; its assigned coordinator reworks it back to
-- Planning. Request Changes returns it to Planning (SG2-93 will bring it back
-- to the check once the named arrangements are settled). AC5: the organiser
-- and the assigned coordinator are told the decision and its reason. AC6:
-- every decision is kept, append-only, with who decided it, when and why.
--
-- Mirrors server/src/events/safetyDecisions.ts (decisions, arrangements and
-- their labels, the 2000-character reason) and the notice wording in
-- server/src/db/eventNotifications.ts; they must change together.
--
-- Which events are waiting for a check is SG2-91's (Lim Dao Jun); until it
-- ships the server lists them through a labelled stand-in. Nothing here moves
-- an event into Awaiting Safety Check.
--
-- SG2-94 must treat only an event's latest decision, when it is approve, as
-- its safety approval: SG2-66's apply_accepted_event_change already returns
-- an event in Preparation to Planning, which withdraws that approval without
-- touching this history.
begin;

create table public.event_safety_decisions (
  decision_id bigserial primary key,
  event_id integer not null references public.events(event_id) on delete cascade,
  decision text not null check (decision in ('approve', 'reject', 'request_changes')),
  reason text check (char_length(reason) <= 2000),
  arrangements text[] not null default '{}'
    check (arrangements <@ array['venue', 'equipment', 'other']::text[]),
  decided_by uuid not null references public.users(user_id),
  decided_at timestamptz not null default clock_timestamp(),
  -- AC2: arrangements are named exactly when changes are requested, and a
  -- Reject or Request Changes decision always has its reason.
  constraint event_safety_decisions_arrangements_named
    check ((decision = 'request_changes') = (cardinality(arrangements) > 0)),
  constraint event_safety_decisions_reason_given
    check (decision = 'approve' or nullif(btrim(reason), '') is not null)
);
create index event_safety_decisions_event_idx on public.event_safety_decisions (event_id, decided_at desc);

-- Only the server's service role reads them and only the function below
-- writes them; there is no update or delete grant, so the record is
-- append-only.
alter table public.event_safety_decisions enable row level security;
alter table public.event_safety_decisions force row level security;
revoke all on public.event_safety_decisions from public, anon, authenticated, service_role;
revoke all on sequence public.event_safety_decisions_decision_id_seq from public, anon, authenticated, service_role;
grant select, insert on public.event_safety_decisions to service_role;
grant usage, select on sequence public.event_safety_decisions_decision_id_seq to service_role;

-- Rebuilds the list 202610190003 (SG2-66) left, so every earlier kind stays allowed.
alter table public.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check check (kind in
    ('venue_request_approved', 'venue_request_rejected', 'venue_booking_released',
     'equipment_reserved', 'venue_booking_clash', 'event_confirmed',
     'event_submitted', 'coordinator_assigned', 'clarification_requested',
     'event_approved', 'event_rejected', 'venue_unavailable', 'event_returned_to_planning',
     'safety_decision'));

create function public.record_safety_decision(
  p_event_id integer,
  p_actor_id uuid,
  p_decision text,
  p_reason text,
  p_arrangements jsonb
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
revoke all on function public.record_safety_decision(integer, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_safety_decision(integer, uuid, text, text, jsonb) to service_role;

-- AC4: the assigned coordinator takes a Safety Rejected event back to
-- Planning to rework its arrangements and resubmit them for a new check.
create function public.rework_safety_rejected_event(p_event_id integer, p_actor_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  e public.events;
begin
  select * into e from public.events where event_id = p_event_id for update;
  if not found or p_actor_id is null or e.coordinator_id is distinct from p_actor_id then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if e.status is distinct from 'safety_rejected' then
    return jsonb_build_object('outcome', 'closed', 'status', e.status::text);
  end if;
  update public.events set status = 'planning' where event_id = p_event_id;
  insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
    values (p_event_id, p_actor_id, 'status', 'safety_rejected', 'planning');
  return jsonb_build_object('outcome', 'ok', 'status', 'planning');
end;
$$;
revoke all on function public.rework_safety_rejected_event(integer, uuid) from public, anon, authenticated;
grant execute on function public.rework_safety_rejected_event(integer, uuid) to service_role;

commit;
