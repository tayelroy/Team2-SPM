-- SG2-65: the event coordinator decides on a change request.
--
-- AC3: every decision records who made it (decided_by) and when (decided_at)
-- next to the request itself. A refusal also keeps its reason
-- (decision_reason, AC2). A pending request has neither; a decided one has
-- both, so the record cannot be half-written.
--
-- AC1/AC2: the organiser who asked is notified of either decision in the same
-- transaction (`change_accepted`, `change_refused`).
--
-- AC4: a request on an event returned for clarification is still a request,
-- not a planned event, so accepting the change writes it straight onto the
-- request. The coordinator then sends it back to review (`under_review`) or
-- leaves it with the organiser to resubmit (`needs_clarification`).
--
-- On every other open status SG2-66's apply_accepted_event_change applies the
-- change first (and returns a significantly changed Confirmed or Preparation
-- event to Planning, AC5); this function then only records the decision.
begin;

alter table public.event_change_requests
  add column decided_by      uuid references public.users(user_id),
  add column decided_at      timestamptz,
  add column decision_reason text;

-- Requests SG2-66 accepted before this migration: who and when come from the
-- history line apply_accepted_event_change wrote for them. (None on live on
-- 26 Oct 2026; a row with no such line makes the check below fail loudly.)
update public.event_change_requests r set decided_by = l.actor_id, decided_at = l.created_at
  from public.event_audit_logs l
  where r.status = 'accepted' and l.event_id = r.event_id and l.field_name = 'change_request'
    and l.new_value = 'Accepted change request ' || r.change_request_id;

alter table public.event_change_requests
  add constraint event_change_requests_decision_recorded check (
    (status = 'pending') = (decided_by is null) and (decided_by is null) = (decided_at is null)),
  add constraint event_change_requests_refusal_reason check (
    status <> 'refused'
      or (decision_reason is not null and btrim(decision_reason) <> '' and char_length(decision_reason) <= 1000));

-- Adds the new kinds to whatever list is already allowed, as SG2-64 did.
do $$
declare
  kinds text[];
begin
  select array(select (regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g'))[1])
    into kinds from pg_constraint c
    where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_kind_check';
  kinds := kinds || array(select kind from unnest(array['change_accepted', 'change_refused']) kind
    where not kind = any(kinds));
  alter table public.notifications drop constraint notifications_kind_check;
  execute format('alter table public.notifications add constraint notifications_kind_check check (kind in (%s))',
    (select string_agg(quote_literal(kind), ', ' order by position) from unnest(kinds) with ordinality as k(kind, position)));
end;
$$;

-- Records the assigned coordinator's decision on one pending request.
--   p_decision 'refused'  — needs p_reason; the event is left as it is (AC2)
--   p_decision 'accepted' — on needs_clarification needs p_next ('review' or
--     'resubmit') and applies the change here (AC4); on any other status
--     p_next must be null and the change is already applied (AC1)
-- Outcomes:
--   ok          — recorded and the organiser notified; returns the event status
--   not_found   — no such event assigned to the actor
--   not_pending — no such request, or already decided
--   invalid     — the decision, reason or next step does not fit
create function public.decide_event_change_request(
  p_event_id integer,
  p_change_request_id bigint,
  p_actor_id uuid,
  p_decision text,
  p_reason text,
  p_next text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  e public.events%rowtype;
  request public.event_change_requests%rowtype;
  clarifying boolean;
  next_status public.event_status;
  label text;
  message text;
begin
  -- The event lock serializes this with SG2-66's apply and every status change.
  select * into e from public.events
    where event_id = p_event_id and coordinator_id = p_actor_id for update;
  if not found or p_actor_id is null then return jsonb_build_object('outcome', 'not_found'); end if;

  select * into request from public.event_change_requests
    where change_request_id = p_change_request_id and event_id = p_event_id and status = 'pending'
    for update;
  if not found then return jsonb_build_object('outcome', 'not_pending'); end if;
  -- The accept route applies the change and records the decision in two
  -- steps. Once applied (its history line is written under this same event
  -- lock) the request can no longer be refused.
  if exists (select 1 from public.event_audit_logs
      where event_id = p_event_id and field_name = 'change_request'
        and new_value = 'Accepted change request ' || request.change_request_id) then
    if p_decision = 'refused' then return jsonb_build_object('outcome', 'not_pending'); end if;
  end if;

  clarifying := e.status = 'needs_clarification';
  if p_decision = 'refused' then
    if p_next is not null or p_reason is null or btrim(p_reason) = '' or char_length(btrim(p_reason)) > 1000 then
      return jsonb_build_object('outcome', 'invalid');
    end if;
  elsif p_decision = 'accepted' then
    if p_reason is not null or (clarifying and coalesce(p_next, '') not in ('review', 'resubmit'))
        or (not clarifying and p_next is not null) then
      return jsonb_build_object('outcome', 'invalid');
    end if;
  else
    return jsonb_build_object('outcome', 'invalid');
  end if;

  next_status := e.status;
  if p_decision = 'accepted' and clarifying then
    -- The table's field check keeps request.field in the changeable list.
    execute format('update public.events set %I = (jsonb_populate_record(null::public.events, $1)).%I'
        || ' where event_id = $2', request.field, request.field)
      using jsonb_build_object(request.field, request.to_value), p_event_id;
    insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
      -- The value now, as SG2-66 records it: an earlier accepted request on the
      -- same field may have moved it since this one was raised.
      values (p_event_id, p_actor_id, request.field, to_jsonb(e) ->> request.field, request.to_value #>> '{}'),
        (p_event_id, p_actor_id, 'change_request', null, 'Accepted change request ' || request.change_request_id);
    if p_next = 'review' then
      next_status := 'under_review';
      update public.events set status = next_status where event_id = p_event_id;
      insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
        values (p_event_id, p_actor_id, 'status', e.status::text, next_status::text);
    end if;
  elsif p_decision = 'refused' then
    insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
      values (p_event_id, p_actor_id, 'change_request', null,
        'Refused change request ' || request.change_request_id || ': ' || btrim(p_reason));
  end if;

  update public.event_change_requests set
    status = p_decision,
    decided_by = p_actor_id,
    decided_at = now(),
    decision_reason = case when p_decision = 'refused' then btrim(p_reason) end
  where change_request_id = request.change_request_id;

  label := left(coalesce(nullif(e.name, ''), 'Untitled event'), 500);
  message := case
    when p_decision = 'refused' then label || ': your change request was refused. Reason: ' || btrim(p_reason)
    when p_next = 'review' then label || ': your change request was accepted and the request is back in review.'
    when p_next = 'resubmit' then label || ': your change request was accepted. Resubmit the request for review.'
    else label || ': your change request was accepted.'
  end;
  insert into public.notifications (recipient_id, event_id, kind, message)
    values (request.requested_by, p_event_id,
      case when p_decision = 'refused' then 'change_refused' else 'change_accepted' end, left(message, 1000));

  return jsonb_build_object('outcome', 'ok', 'status', next_status::text);
end;
$$;

revoke all on function public.decide_event_change_request(integer, bigint, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.decide_event_change_request(integer, bigint, uuid, text, text, text) to service_role;

commit;
