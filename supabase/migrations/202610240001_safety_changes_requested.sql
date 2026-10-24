-- SG2-93: send an event back to planning when safety changes are requested.
--
-- AC1  A Request Changes decision (SG2-92) already returns the event to
--      Planning; it now also marks each arrangement the Safety Officer named
--      outstanding, as a recheck key: safety_venue_recheck,
--      safety_equipment_recheck or safety_other_recheck. An outstanding key
--      keeps the event out of Awaiting Safety Check
--      (safety_check_arrangements_ready(), 202610190004).
-- AC2  Every live venue booking request (Venue) or equipment request
--      (Equipment and technical) of the event is flagged in safety_rereviews
--      for Venue Staff or Technical Support to confirm again, with the Safety
--      Officer's reason. A new venue or layout, or changed equipment, goes to
--      the same staff through the existing request paths.
-- AC3  Arrangements the Safety Officer did not name gain no key and no flag.
-- AC4  When staff confirm the last flag of a kind again, or its request is
--      withdrawn, released or rejected, that kind's key is settled here; the
--      coordinator settles safety_other_recheck (and a venue or equipment key
--      that had nothing to flag) with SG2-66's settle_arrangement_recheck(),
--      which refuses a venue or equipment key while a flag is still open.
--      Settling the last key fires SG2-91's refresh trigger on events, which
--      returns the event to Awaiting Safety Check once everything is ready.
-- AC5  event_safety_decisions keeps every decision (SG2-92); each flag keeps
--      the decision it came from and how and when it was resolved, and each
--      confirmation is a history row.
--
-- record_safety_decision() and settle_arrangement_recheck() are replaced from
-- their latest definitions (202610190006 and 202610190003), unchanged apart
-- from the SG2-93 blocks. Neither reads the caller's role through
-- acting_role() (SG2-104): both are service-only and take the verified actor.
begin;

create table public.safety_rereviews (
  review_id bigint generated always as identity primary key,
  event_id integer not null references public.events(event_id) on delete cascade,
  decision_id bigint not null references public.event_safety_decisions(decision_id) on delete cascade,
  arrangement text not null check (arrangement in ('venue', 'equipment')),
  venue_request_id bigint references public.venue_booking_requests(request_id) on delete cascade,
  equipment_request_id bigint references public.equipment_requests(request_id) on delete cascade,
  flagged_at timestamptz not null default clock_timestamp(),
  resolution text check (resolution in ('confirmed', 'withdrawn')),
  resolved_by uuid references public.users(user_id),
  resolved_at timestamptz,
  constraint safety_rereviews_one_request check (
    (arrangement = 'venue' and venue_request_id is not null and equipment_request_id is null)
    or (arrangement = 'equipment' and equipment_request_id is not null and venue_request_id is null)),
  constraint safety_rereviews_resolved check (
    (resolution is null) = (resolved_at is null)
    and (resolution is distinct from 'confirmed' or resolved_by is not null))
);
comment on table public.safety_rereviews is
  'SG2-93: a venue booking request or equipment request a Request Changes safety decision sent back to Venue Staff or Technical Support, and how it was resolved.';
-- One open flag per request; a later decision may flag it again once resolved.
create unique index safety_rereviews_open_venue on public.safety_rereviews (venue_request_id) where resolved_at is null;
create unique index safety_rereviews_open_equipment on public.safety_rereviews (equipment_request_id) where resolved_at is null;
create index safety_rereviews_event on public.safety_rereviews (event_id, review_id);
alter table public.safety_rereviews enable row level security;
alter table public.safety_rereviews force row level security;
revoke all on public.safety_rereviews from public, anon, authenticated;
grant select, insert, update on public.safety_rereviews to service_role;

-- Each flag of an event with what identifies it to people: the venue's name
-- and booked period in Singapore time, or the quantity and equipment name.
create function public.safety_rereview_labels(p_event_id integer)
returns table (review_id bigint, arrangement text, label text, resolved_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select f.review_id, f.arrangement,
    case f.arrangement
      when 'venue' then coalesce(v.name, 'Venue no longer listed') || ' ('
        || to_char(vr.starts_at at time zone 'Asia/Singapore', 'FMDD Mon YYYY HH24:MI') || ' – '
        || to_char(vr.ends_at at time zone 'Asia/Singapore', 'HH24:MI') || ' SGT)'
      else er.quantity || ' × ' || coalesce(q.name, 'Equipment no longer listed') end,
    f.resolved_at
  from public.safety_rereviews f
  left join public.venue_booking_requests vr on vr.request_id = f.venue_request_id
  left join public.venues v on v.venue_id = vr.venue_id
  left join public.equipment_requests er on er.request_id = f.equipment_request_id
  left join public.equipment q on q.equipment_id = er.equipment_id
  where f.event_id = p_event_id;
$$;
revoke all on function public.safety_rereview_labels(integer) from public, anon, authenticated;

-- AC4: settles the venue and equipment keys no flag is holding open any more.
-- The caller holds the event row lock. Writing the event fires SG2-91's
-- refresh trigger, which returns it to Awaiting Safety Check when ready.
create function private.settle_safety_rechecks(p_event_id integer, p_actor_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  e public.events;
  settled text[] := array[]::text[];
  remaining jsonb;
  key text;
begin
  select * into e from public.events where event_id = p_event_id;
  if not found then return; end if;
  foreach key in array array['safety_venue_recheck', 'safety_equipment_recheck'] loop
    if coalesce(e.outstanding_arrangements, '[]'::jsonb) @> jsonb_build_array(key)
        and not exists (select 1 from public.safety_rereviews f
          where f.event_id = p_event_id and f.resolved_at is null
            and f.arrangement = case key when 'safety_venue_recheck' then 'venue' else 'equipment' end) then
      settled := settled || key;
    end if;
  end loop;
  if cardinality(settled) = 0 then return; end if;
  select coalesce(jsonb_agg(item order by position), '[]'::jsonb) into remaining
    from jsonb_array_elements(e.outstanding_arrangements) with ordinality as entries(item, position)
    where not (item #>> '{}') = any(settled);
  update public.events
    set outstanding_arrangements = remaining, arrangements_recheck_needed = jsonb_array_length(remaining) > 0
    where event_id = p_event_id;
  if p_actor_id is not null then
    insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
      select p_event_id, p_actor_id, 'arrangement_recheck', null, s || ' settled' from unnest(settled) s;
  end if;
end;
$$;
revoke all on function private.settle_safety_rechecks(integer, uuid) from public, anon, authenticated;

create or replace function public.record_safety_decision(
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

  -- SG2-93 AC1/AC2/AC3: the arrangements the Safety Officer named, and only
  -- those, are marked outstanding, and each live booking request or equipment
  -- request behind them goes back to Venue Staff or Technical Support to be
  -- confirmed again. The event row lock above is held, as every arrangement
  -- writer takes it first. Pending requests count too: they are already with
  -- the staff, and the flag keeps the Safety Officer's reason with them.
  if p_decision = 'request_changes' then
    if 'venue' = any(named) then
      insert into public.safety_rereviews (event_id, decision_id, arrangement, venue_request_id)
        select p_event_id, decision_row.decision_id, 'venue', r.request_id
        from public.venue_booking_requests r
        where r.event_id = p_event_id and r.status in ('pending', 'approved')
        order by r.request_id;
    end if;
    if 'equipment' = any(named) then
      insert into public.safety_rereviews (event_id, decision_id, arrangement, equipment_request_id)
        select p_event_id, decision_row.decision_id, 'equipment', r.request_id
        from public.equipment_requests r
        where r.event_id = p_event_id and r.status in ('pending', 'approved')
        order by r.request_id;
    end if;
    -- Existing keys keep their place; each named arrangement adds its own.
    update public.events
      set arrangements_recheck_needed = true,
        outstanding_arrangements = coalesce(outstanding_arrangements, '[]'::jsonb) || coalesce((
          select jsonb_agg(to_jsonb('safety_' || n || '_recheck') order by position)
          from unnest(named) with ordinality as names(n, position)
          where not coalesce(outstanding_arrangements, '[]'::jsonb) @> jsonb_build_array('safety_' || n || '_recheck')),
          '[]'::jsonb)
      where event_id = p_event_id;
  end if;

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

create or replace function public.settle_arrangement_recheck(p_event_id integer, p_actor_id uuid, p_key text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  e public.events;
  remaining jsonb;
  waiting jsonb;
begin
  select * into e from public.events where event_id = p_event_id for update;
  if not found or p_actor_id is null or e.coordinator_id is distinct from p_actor_id then
    return jsonb_build_object('outcome', 'stale');
  end if;
  if p_key is null or not coalesce(e.outstanding_arrangements, '[]'::jsonb) @> jsonb_build_array(p_key) then
    return jsonb_build_object('outcome', 'not_outstanding');
  end if;
  -- SG2-93 AC4: a venue or equipment change the Safety Officer asked for is
  -- done only once Venue Staff or Technical Support have confirmed every
  -- flagged request again (or it was withdrawn); until then the coordinator
  -- is told what is still waiting.
  if p_key in ('safety_venue_recheck', 'safety_equipment_recheck') then
    select coalesce(jsonb_agg(jsonb_build_object('arrangement', w.arrangement, 'label', w.label)
        order by w.review_id), '[]'::jsonb)
      into waiting
      from public.safety_rereview_labels(p_event_id) w
      where w.arrangement = case p_key when 'safety_venue_recheck' then 'venue' else 'equipment' end
        and w.resolved_at is null;
    if jsonb_array_length(waiting) > 0 then
      return jsonb_build_object('outcome', 'flagged', 'waiting', waiting);
    end if;
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

-- AC2/AC4: Venue Staff (venue) or Technical Support (equipment) confirm one
-- flagged request again. The server passes the verified actor and the role
-- the request acts as (SG2-104); both must match the flag's kind, and the
-- actor must still hold that role.
create function public.confirm_safety_rereview(p_review_id bigint, p_actor_id uuid, p_acting_role text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  f public.safety_rereviews;
  e public.events;
  label text;
  required text;
begin
  if p_review_id is null or p_actor_id is null then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  select * into f from public.safety_rereviews where review_id = p_review_id;
  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;
  required := case f.arrangement when 'venue' then 'venue_staff' else 'technical_support_staff' end;
  if p_acting_role is distinct from required or not exists (select 1 from public.account_roles ar
      where ar.user_id = p_actor_id and ar.role = required) then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  -- Event first, as every arrangement writer locks it, then the flag again.
  select * into e from public.events where event_id = f.event_id for update;
  select * into f from public.safety_rereviews where review_id = p_review_id for update;
  if f.resolved_at is not null then
    return jsonb_build_object('outcome', 'closed', 'resolution', f.resolution);
  end if;
  select l.label into label from public.safety_rereview_labels(f.event_id) l where l.review_id = f.review_id;
  update public.safety_rereviews
    set resolution = 'confirmed', resolved_by = p_actor_id, resolved_at = clock_timestamp()
    where review_id = p_review_id;
  insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
    values (f.event_id, p_actor_id, 'safety_rereview', null,
      case f.arrangement when 'venue' then 'Venue Staff' else 'Technical Support' end
        || ' confirmed ' || label || ' again');
  perform private.settle_safety_rechecks(f.event_id, p_actor_id);
  select * into e from public.events where event_id = f.event_id;
  return jsonb_build_object('outcome', 'ok', 'review_id', p_review_id, 'event_id', e.event_id,
    'status', e.status::text, 'outstanding_arrangements', coalesce(e.outstanding_arrangements, '[]'::jsonb));
end;
$$;
revoke all on function public.confirm_safety_rereview(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_safety_rereview(bigint, uuid, text) to service_role;

-- AC2: the open flags one kind of staff work through, oldest first, with the
-- Safety Officer's reason and what identifies each request.
create function public.safety_rereview_queue(p_arrangement text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'review_id', f.review_id,
      'arrangement', f.arrangement,
      'event_id', e.event_id,
      'event_name', e.name,
      'proposed_date', e.proposed_date,
      'coordinator_name', coordinator.name,
      'flagged_at', f.flagged_at,
      'label', l.label,
      'reason', d.reason,
      'decided_by_name', officer.name,
      'venue_request_id', f.venue_request_id,
      'layout', vr.layout,
      'equipment_request_id', f.equipment_request_id,
      'placement_venue_name', placement.name,
      'placement_position', er.placement_position
    ) order by f.flagged_at, f.review_id), '[]'::jsonb)
  from public.safety_rereviews f
  join public.events e on e.event_id = f.event_id
  join public.event_safety_decisions d on d.decision_id = f.decision_id
  join public.safety_rereview_labels(f.event_id) l on l.review_id = f.review_id
  left join public.users coordinator on coordinator.user_id = e.coordinator_id
  left join public.users officer on officer.user_id = d.decided_by
  left join public.venue_booking_requests vr on vr.request_id = f.venue_request_id
  left join public.equipment_requests er on er.request_id = f.equipment_request_id
  left join public.venues placement on placement.venue_id = er.placement_venue_id
  where f.resolved_at is null and f.arrangement = p_arrangement;
$$;
revoke all on function public.safety_rereview_queue(text) from public, anon, authenticated;
grant execute on function public.safety_rereview_queue(text) to service_role;

-- AC5: every flag of an event, open or resolved, for the people who read its
-- safety decisions: newest decision first, each decision's flags in the
-- order they were made (venue before equipment, as named).
create function public.event_safety_rereviews(p_event_id integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'review_id', f.review_id,
      'decision_id', f.decision_id,
      'arrangement', f.arrangement,
      'label', l.label,
      'flagged_at', f.flagged_at,
      'resolution', f.resolution,
      'resolved_by_name', resolver.name,
      'resolved_at', f.resolved_at
    ) order by f.decision_id desc, f.review_id), '[]'::jsonb)
  from public.safety_rereviews f
  join public.safety_rereview_labels(p_event_id) l on l.review_id = f.review_id
  left join public.users resolver on resolver.user_id = f.resolved_by
  where f.event_id = p_event_id;
$$;
revoke all on function public.event_safety_rereviews(integer) from public, anon, authenticated;
grant execute on function public.event_safety_rereviews(integer) to service_role;

-- AC4: a flagged request that is withdrawn, released or rejected no longer
-- needs confirming; its flag closes and the key settles if it was the last.
-- Runs after SG2-91's safety_check_refresh trigger on the same table (names
-- sort alphabetically), so the refresh that settling causes sees the final
-- arrangement state.
create function public.safety_rereview_close_from_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  closed integer;
begin
  update public.safety_rereviews f
    set resolution = 'withdrawn', resolved_by = auth.uid(), resolved_at = clock_timestamp()
    where f.resolved_at is null
      and case tg_table_name when 'venue_booking_requests' then f.venue_request_id
        else f.equipment_request_id end = new.request_id;
  get diagnostics closed = row_count;
  if closed > 0 then
    perform 1 from public.events where event_id = new.event_id for update;
    perform private.settle_safety_rechecks(new.event_id,
      coalesce(auth.uid(), (select coordinator_id from public.events where event_id = new.event_id)));
  end if;
  return null;
end;
$$;
revoke all on function public.safety_rereview_close_from_request() from public, anon, authenticated;

create trigger safety_rereview_close after update of status on public.venue_booking_requests
  for each row when (new.status in ('rejected', 'cancelled') and old.status is distinct from new.status)
  execute function public.safety_rereview_close_from_request();
create trigger safety_rereview_close after update of status on public.equipment_requests
  for each row when (new.status in ('rejected', 'cancelled') and old.status is distinct from new.status)
  execute function public.safety_rereview_close_from_request();

commit;
