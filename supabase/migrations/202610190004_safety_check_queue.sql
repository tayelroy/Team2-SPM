-- SG2-91 (Week 7 customer change #6): events awaiting an operational safety
-- check, and the Safety Officer's list of them.
--
-- AC1  An Approved or Planning event whose venue bookings are all approved
--      and whose required equipment is all reserved moves to Awaiting Safety
--      Check. The move is made by triggers on every table those two rules
--      read, so it happens whichever writer completes the last arrangement
--      (a venue decision, a hold conversion, a placement, a reservation, or
--      settling the last outstanding recheck under SG2-66). Runs after
--      SG2-66's 202610190003_event_change_impact.sql, whose functions it
--      relies on. An
--      event that is awaiting the check and loses one of those arrangements
--      (a booking released, a request withdrawn or added, a venue made
--      unavailable) moves back to Planning, so the list never shows an event
--      whose arrangements have fallen through. Each move is one status row in
--      the event's history (SG2-40), except the one-off upgrade below, which
--      has no actor to name and so records none.
-- AC2/AC3  safety_check_queue() returns the awaiting events with what the
--      review needs: attendance, accessibility needs, expected crowd movement,
--      each booked venue's capacity, layout, emergency access and known
--      restrictions, and each piece of equipment and where it is placed.
--      Expected crowd movement is new: the coordinator records it during
--      planning (events.expected_crowd_movement).
-- AC4  Only a Safety Officer may call safety_check_queue(); the stored role
--      is checked here as well as by the route permission
--      ('safety_checks.read' in server/src/auth/policy.ts).
--
-- While an event awaits its check the coordinator can still add a venue
-- request or an equipment request, and Venue Staff can still place a hold:
-- create_venue_hold() and manage_equipment_requirements() below accept
-- awaiting_safety_check alongside approved and planning (the API's venue
-- request route does the same). The new pending request makes the event not
-- ready, so the trigger returns it to Planning in the same transaction, and it
-- comes back once that request is approved or reserved too.
--
-- events.safety_check_revision changes whenever the event moves into or out
-- of the check and whenever anything the review shows changes while it is
-- awaiting one (an arrangement row, or a reviewed event field). The list
-- returns it so the Safety Officer's decision (SG2-92) can refuse a review of
-- details that have since changed, as equipment edits refuse a stale version.
--
-- Registration is not part of this gate: AC1 names venue and equipment only,
-- and SG2-94 AC6 takes registration out of confirmation too.
begin;

-- AC3: the coordinator's description of how attendees will arrive, move
-- through and leave the venue. Same limit as the other planning text fields
-- (MAX_TEXT_LENGTH in server/src/events/updatePlanning.ts).
alter table public.events
  add column expected_crowd_movement text,
  add constraint events_expected_crowd_movement_length
    check (char_length(expected_crowd_movement) <= 5000);
comment on column public.events.expected_crowd_movement is
  'How attendees are expected to arrive, move through and leave the venue (SG2-91 AC3); set by the coordinator during planning.';

-- AC2: when the event joined the list (oldest first), and a revision that
-- changes with anything the review shows. Both are kept by
-- safety_check_track_event() below, so no writer has to remember them.
alter table public.events
  add column awaiting_safety_check_since timestamptz,
  add column safety_check_revision bigint not null default 0,
  add constraint events_safety_check_revision check (safety_check_revision between 0 and 9007199254740991);
comment on column public.events.awaiting_safety_check_since is
  'When the event last entered Awaiting Safety Check (SG2-91 AC2); null in every other status.';
comment on column public.events.safety_check_revision is
  'Changes whenever the event enters or leaves Awaiting Safety Check, or what the safety review shows changes while it waits (SG2-91); lets a safety decision detect a stale review.';

-- Every write to an event keeps the two columns above true, whichever path
-- changed the status (this story's trigger, a planning edit with arrangement
-- impact, a later safety decision).
create function public.safety_check_track_event()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status <> 'awaiting_safety_check' then
    new.awaiting_safety_check_since := null;
  elsif tg_op = 'INSERT' or old.status <> 'awaiting_safety_check' then
    new.awaiting_safety_check_since := clock_timestamp();
  else
    new.awaiting_safety_check_since := old.awaiting_safety_check_since;
  end if;

  if tg_op = 'UPDATE' and new.safety_check_revision = old.safety_check_revision
      and ((old.status = 'awaiting_safety_check') <> (new.status = 'awaiting_safety_check')
        or (new.status = 'awaiting_safety_check'
          and (new.name, new.proposed_date, new.expected_attendance, new.accessibility_needs,
            new.expected_crowd_movement, new.venue_requirements, new.equipment_requirements)
            is distinct from (old.name, old.proposed_date, old.expected_attendance, old.accessibility_needs,
            old.expected_crowd_movement, old.venue_requirements, old.equipment_requirements))) then
    new.safety_check_revision := old.safety_check_revision + 1;
  end if;
  return new;
end;
$$;
revoke all on function public.safety_check_track_event() from public, anon, authenticated;

create trigger safety_check_track_event before insert or update on public.events
  for each row execute function public.safety_check_track_event();

-- AC1: the venue and equipment rules confirm_event() applies
-- (202610170002_confirmation_rechecks_and_disruptions.sql), without the
-- registration rule. Any recheck still outstanding (SG2-39's planning edits,
-- SG2-66's accepted changes) keeps the event out of the check: SG2-66 AC4
-- keeps it in Planning until every recheck is settled, registration included.
create function public.safety_check_arrangements_ready(p_event public.events)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    not (p_event.arrangements_recheck_needed is true
      and jsonb_array_length(coalesce(p_event.outstanding_arrangements, '[]'::jsonb)) > 0)
    -- Venue: at least one request the event still needs, none pending or
    -- rejected, each approved one backed by a confirmed booking, and no
    -- confirmed booking a venue's unavailability affects (SG2-81).
    and exists (select 1 from public.venue_booking_requests r
      where r.event_id = p_event.event_id and lower(r.status) <> 'cancelled')
    and not exists (select 1 from public.venue_booking_requests r
      where r.event_id = p_event.event_id and lower(r.status) in ('pending', 'rejected'))
    and not exists (select 1 from public.venue_booking_requests r
      where r.event_id = p_event.event_id and lower(r.status) = 'approved'
        and not exists (select 1 from public.venue_bookings b
          where b.status = 'confirmed'
            and (b.booking_id = r.venue_booking_id
              or b.booking_id in (select h.booking_id from public.venue_holds h
                where h.request_id = r.request_id))))
    and not exists (select 1 from public.venue_booking_disruptions d
      join public.venue_bookings b on b.booking_id = d.booking_id
      where b.event_id = p_event.event_id and b.status = 'confirmed')
    -- Equipment: every live request is placed, has no shortfall and is
    -- reserved. An event that requested none needs none.
    and not exists (select 1 from public.equipment_requests r
      where r.event_id = p_event.event_id and lower(r.status) not in ('rejected', 'cancelled')
        and (r.placement_venue_id is null or r.shortfall is distinct from 0
          or not exists (select 1 from public.equipment_reservations receipt
            where receipt.request_id = r.request_id)));
$$;
revoke all on function public.safety_check_arrangements_ready(public.events) from public, anon, authenticated;

-- AC1: moves one event into, or back out of, Awaiting Safety Check. Locks the
-- event row first, as every arrangement writer and confirm_event() do, so two
-- arrangements completed at once cannot both miss the move or make it twice,
-- and a safety decision (SG2-92) that locks the row waits for the change.
-- An arrangement change that leaves an awaiting event ready still bumps its
-- revision, since the details under review are no longer the ones listed.
-- The history row names whoever made the change that caused the move; a
-- service-role write (the API's venue request route) has no caller, and the
-- assigned coordinator who asked the API for it is recorded instead.
create function public.refresh_safety_check_status(p_event_id integer, p_record_history boolean default true)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  e public.events;
  next_status public.event_status;
  actor uuid;
begin
  select * into e from public.events where event_id = p_event_id for update;
  if not found then return; end if;

  if e.status in ('approved', 'planning') and public.safety_check_arrangements_ready(e) then
    next_status := 'awaiting_safety_check';
  elsif e.status = 'awaiting_safety_check' and not public.safety_check_arrangements_ready(e) then
    next_status := 'planning';
  elsif e.status = 'awaiting_safety_check' then
    update public.events set safety_check_revision = safety_check_revision + 1 where event_id = p_event_id;
    return;
  else
    return;
  end if;

  -- safety_check_track_event() stamps the wait and bumps the revision.
  update public.events set status = next_status where event_id = p_event_id;
  actor := coalesce(auth.uid(), e.coordinator_id);
  if p_record_history and actor is not null then
    insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
      values (p_event_id, actor, 'status', e.status::text, next_status::text);
  end if;
  -- SG2-66 AC7: the organiser and the assigned coordinator are told whenever an
  -- event goes back to Planning. Same kind and wording as
  -- apply_accepted_event_change() (202610190003_event_change_impact.sql).
  if next_status = 'planning' then
    insert into public.notifications (recipient_id, event_id, kind, message)
      values (e.organiser_id, p_event_id, 'event_returned_to_planning',
        left(coalesce(nullif(e.name, ''), 'Untitled event'), 500)
          || ' has moved back to Planning. Its arrangements are being rechecked before it can be confirmed again.');
    if e.coordinator_id is not null and e.coordinator_id is distinct from e.organiser_id then
      insert into public.notifications (recipient_id, event_id, kind, message)
        values (e.coordinator_id, p_event_id, 'event_returned_to_planning',
          left(coalesce(nullif(e.name, ''), 'Untitled event'), 500)
            || ' is back in Planning. Recheck its outstanding arrangements before it goes through the safety check again.');
    end if;
  end if;
end;
$$;
revoke all on function public.refresh_safety_check_status(integer, boolean) from public, anon, authenticated;

-- AC1: every table the readiness rules read refreshes the event(s) a changed
-- row belongs to. A row moved between events refreshes both.
create function public.safety_check_refresh_from_arrangement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_event integer;
  new_event integer;
begin
  if tg_table_name = 'venue_booking_disruptions' then
    if tg_op <> 'INSERT' then
      select b.event_id into old_event from public.venue_bookings b where b.booking_id = old.booking_id;
    end if;
    if tg_op <> 'DELETE' then
      select b.event_id into new_event from public.venue_bookings b where b.booking_id = new.booking_id;
    end if;
  else
    if tg_op <> 'INSERT' then old_event := old.event_id; end if;
    if tg_op <> 'DELETE' then new_event := new.event_id; end if;
  end if;

  if new_event is not null then perform public.refresh_safety_check_status(new_event); end if;
  if old_event is not null and old_event is distinct from new_event then
    perform public.refresh_safety_check_status(old_event);
  end if;
  return null;
end;
$$;
revoke all on function public.safety_check_refresh_from_arrangement() from public, anon, authenticated;

create trigger safety_check_refresh after insert or update or delete on public.venue_booking_requests
  for each row execute function public.safety_check_refresh_from_arrangement();
create trigger safety_check_refresh after insert or update or delete on public.venue_bookings
  for each row execute function public.safety_check_refresh_from_arrangement();
create trigger safety_check_refresh after insert or update or delete on public.venue_holds
  for each row execute function public.safety_check_refresh_from_arrangement();
create trigger safety_check_refresh after insert or update or delete on public.venue_booking_disruptions
  for each row execute function public.safety_check_refresh_from_arrangement();
create trigger safety_check_refresh after insert or update or delete on public.equipment_requests
  for each row execute function public.safety_check_refresh_from_arrangement();
create trigger safety_check_refresh after insert or update or delete on public.equipment_reservations
  for each row execute function public.safety_check_refresh_from_arrangement();
-- SG2-66: settling the last outstanding recheck (settle_arrangement_recheck)
-- changes only the event row, so the event is refreshed when its rechecks
-- change too. The refresh itself writes only status and revision, so this
-- does not fire again.
create trigger safety_check_refresh after update of arrangements_recheck_needed, outstanding_arrangements
  on public.events for each row
  when (old.arrangements_recheck_needed is distinct from new.arrangements_recheck_needed
    or old.outstanding_arrangements is distinct from new.outstanding_arrangements)
  execute function public.safety_check_refresh_from_arrangement();

-- Unchanged from 202610170007_venue_delete_hold_expiry.sql (SG2-106) except
-- that an event awaiting its safety check can still be held for another
-- venue; the hold's pending request returns it to Planning.
create or replace function public.create_venue_hold(p_event_id integer,p_venue_id integer,p_starts_at timestamptz,p_ends_at timestamptz,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.events; h public.venue_holds; r bigint; instant timestamptz; lead_seconds integer; gap interval; removed timestamptz;
begin
  if not exists(select 1 from public.account_roles where user_id = auth.uid() and role = 'venue_staff') then
    raise exception using errcode = '42501',message = 'Access denied';
  end if;
  select deleted_at into removed from public.venues where venue_id = p_venue_id for update;
  if not found or removed is not null then return jsonb_build_object('outcome','missing'); end if;
  select * into e from public.events where event_id = p_event_id for update;
  if not found then return jsonb_build_object('outcome','missing'); end if;
  instant := clock_timestamp();
  -- SG2-78: a hold needs the same setup and turnaround room as a booking.
  gap := public.venue_preparation_gap(p_venue_id);
  if p_starts_at is null or p_ends_at is null or p_expires_at is null or not isfinite(p_starts_at) or not isfinite(p_ends_at) or not isfinite(p_expires_at) or p_ends_at <= p_starts_at or p_ends_at <= instant or p_expires_at <= instant
    or e.status not in ('approved','planning','awaiting_safety_check') or e.coordinator_id is null then return jsonb_build_object('outcome','invalid'); end if;
  if exists(select 1 from public.venue_bookings where venue_id = p_venue_id and status = 'confirmed' and starts_at < p_ends_at + gap and ends_at > p_starts_at - gap)
    or exists(select 1 from public.venue_holds where venue_id = p_venue_id and status = 'tentative' and expires_at > instant and starts_at < p_ends_at + gap and ends_at > p_starts_at - gap)
    or exists(select 1 from public.venue_unavailability where venue_id = p_venue_id and starts_at < p_ends_at and ends_at > p_starts_at)
    then return jsonb_build_object('outcome','conflict'); end if;
  insert into public.venue_booking_requests(event_id,venue_id,starts_at,ends_at,notes)
    values(p_event_id,p_venue_id,p_starts_at,p_ends_at,'Tentative hold — approval required') returning request_id into r;
  insert into public.venue_holds(event_id,venue_id,request_id,starts_at,ends_at,expires_at,created_by,created_at)
    values(p_event_id,p_venue_id,r,p_starts_at,p_ends_at,p_expires_at,auth.uid(),instant) returning * into h;
  insert into public.event_audit_logs(event_id,actor_id,field_name,old_value,new_value)
    values(h.event_id,auth.uid(),'venue_hold_status',null,'Tentative hold ' || h.hold_id || '; expires ' || h.expires_at);
  perform public.venue_hold_notice(h,'placed');
  select warning_lead_seconds into lead_seconds from public.venue_hold_settings where singleton;
  if h.expires_at <= instant + make_interval(secs => lead_seconds) then
    update public.venue_holds set warning_sent_at = instant where hold_id = h.hold_id;
    perform public.venue_hold_notice(h,'warning');
  end if;
  return jsonb_build_object('outcome','created','hold',public.venue_hold_json(h));
end;
$$;

-- Unchanged from 202610140002_equipment_reserved_shortfall.sql except that an
-- event awaiting its safety check still takes requests and arrangements, and
-- the result reports the event's status after the write.
create or replace function public.manage_equipment_requirements(
  p_action text, p_event_id integer, p_request_id bigint default null,
  p_version bigint default null, p_values jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  caller_role text;
  event_row public.events;
  request_row public.equipment_requests;
  equipment_value integer;
  quantity_value integer;
  shortfall_value integer;
  venue_value integer;
  notes_value text;
  arrangement_value text;
  position_value text;
  number_value numeric;
  whitespace constant text := E' \t\n\r\f\v' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  if caller is null then raise exception using errcode = '42501', message = 'Access denied'; end if;
  -- A stored role change that wins this lock takes effect before any write.
  select ar.role into caller_role from public.account_roles ar where ar.user_id = caller for share;
  if caller_role is null or caller_role not in ('event_coordinator', 'technical_support_staff', 'safety_officer') then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  if p_action is null or p_action not in ('read', 'create', 'amend', 'arrange')
      or p_event_id is null or p_event_id <= 0 then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if (p_action in ('create', 'amend') and caller_role <> 'event_coordinator')
      or (p_action = 'arrange' and caller_role <> 'technical_support_staff') then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;

  -- Serialize requirements for one event and recheck the row after waiting:
  -- assignment/stage changes and duplicate creates cannot use stale context.
  select * into event_row from public.events where event_id = p_event_id for update;
  if not found or (caller_role = 'event_coordinator' and event_row.coordinator_id is distinct from caller) then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if p_action <> 'read' then
    if event_row.status not in ('approved', 'planning', 'awaiting_safety_check') then
      return jsonb_build_object('outcome', 'closed');
    end if;
    if jsonb_typeof(p_values) is distinct from 'object' then
      return jsonb_build_object('outcome', 'invalid');
    end if;
    if p_action in ('amend', 'arrange') then
      if p_request_id is null or p_request_id not between 1 and 9007199254740991
          or p_version is null or p_version not between 1 and 9007199254740991 then
        return jsonb_build_object('outcome', 'invalid');
      end if;
      select * into request_row from public.equipment_requests
        where request_id = p_request_id and event_id = p_event_id for update;
      if not found then return jsonb_build_object('outcome', 'missing'); end if;
      -- A reserved demand is frozen, but placement and support arrangements
      -- still need to be completed for SG2-57 readiness. Only linked receipts
      -- authorize this exception; legacy approved requests remain closed.
      if request_row.status <> 'pending' and not (p_action = 'arrange'
          and request_row.status = 'approved' and exists (
            select 1 from public.equipment_reservations where request_id = p_request_id)) then
        return jsonb_build_object('outcome', 'closed');
      end if;
      if request_row.version <> p_version or request_row.version = 9007199254740991 then
        return jsonb_build_object('outcome', 'conflict');
      end if;
    end if;

    -- Validate JSON types before casting; reject fractional/overflow values
    -- without rounding, and count text in Unicode characters.
    if p_action in ('create', 'amend') then
      if exists (select 1 from jsonb_object_keys(p_values) key where key not in ('equipment_id', 'quantity', 'notes'))
          or jsonb_typeof(p_values->'equipment_id') is distinct from 'number'
          or jsonb_typeof(p_values->'quantity') is distinct from 'number'
          or coalesce(jsonb_typeof(p_values->'notes'), 'null') not in ('string', 'null') then
        return jsonb_build_object('outcome', 'invalid');
      end if;
      number_value := (p_values->>'equipment_id')::numeric;
      if number_value <> trunc(number_value) or number_value not between 1 and 2147483647 then
        return jsonb_build_object('outcome', 'invalid');
      end if;
      equipment_value := number_value::integer;
      number_value := (p_values->>'quantity')::numeric;
      if number_value <> trunc(number_value) or number_value not between 1 and 2147483647 then
        return jsonb_build_object('outcome', 'invalid');
      end if;
      quantity_value := number_value::integer;
      notes_value := nullif(btrim(p_values->>'notes', whitespace), '');
      if char_length(notes_value) > 2000 or not exists (select 1 from public.equipment where equipment_id = equipment_value) then
        return jsonb_build_object('outcome', 'invalid');
      end if;
      if exists (select 1 from public.equipment_requests r where r.event_id = p_event_id
          and r.equipment_id = equipment_value and r.status = 'pending'
          and (p_action = 'create' or r.request_id <> p_request_id)) then
        return jsonb_build_object('outcome', 'duplicate');
      end if;
      if p_action = 'create' then
        insert into public.equipment_requests(event_id, equipment_id, quantity, notes)
          values (p_event_id, equipment_value, quantity_value, notes_value);
      else
        update public.equipment_requests set equipment_id = equipment_value, quantity = quantity_value,
          notes = notes_value, arrangement_notes = null, shortfall = null,
          placement_venue_id = null, placement_position = null where request_id = p_request_id;
      end if;
    else
      if exists (select 1 from jsonb_object_keys(p_values) key where key not in
          ('arrangement_notes', 'shortfall', 'placement_venue_id', 'placement_position'))
          or jsonb_typeof(p_values->'shortfall') is distinct from 'number'
          or coalesce(jsonb_typeof(p_values->'arrangement_notes'), 'null') not in ('string', 'null')
          or coalesce(jsonb_typeof(p_values->'placement_position'), 'null') not in ('string', 'null')
          or coalesce(jsonb_typeof(p_values->'placement_venue_id'), 'null') not in ('number', 'null') then
        return jsonb_build_object('outcome', 'invalid');
      end if;
      number_value := (p_values->>'shortfall')::numeric;
      -- A linked reservation already covers the full approved demand. Its
      -- remaining arrangement edits must not contradict that committed stock.
      if number_value <> trunc(number_value) or number_value not between 0 and request_row.quantity
          or (request_row.status = 'approved' and number_value <> 0) then
        return jsonb_build_object('outcome', 'invalid');
      end if;
      shortfall_value := number_value::integer;
      arrangement_value := nullif(btrim(p_values->>'arrangement_notes', whitespace), '');
      position_value := nullif(btrim(p_values->>'placement_position', whitespace), '');
      if p_values->>'placement_venue_id' is not null then
        number_value := (p_values->>'placement_venue_id')::numeric;
        if number_value <> trunc(number_value) or number_value not between 1 and 2147483647 then
          return jsonb_build_object('outcome', 'invalid');
        end if;
        venue_value := number_value::integer;
      end if;
      if char_length(arrangement_value) > 2000 or char_length(position_value) > 2000
          or (venue_value is null) <> (position_value is null)
          or (venue_value is not null and not exists (select 1 from public.venues where venue_id = venue_value)) then
        return jsonb_build_object('outcome', 'invalid');
      end if;
      update public.equipment_requests set arrangement_notes = arrangement_value,
        shortfall = shortfall_value, placement_venue_id = venue_value,
        placement_position = position_value where request_id = p_request_id;
    end if;
  end if;

  -- SG2-91: a new or amended request sends an awaiting event back to
  -- Planning in this transaction, so report the status after the write.
  select * into event_row from public.events where event_id = p_event_id;
  return jsonb_build_object('outcome', 'ok',
    'event', jsonb_build_object('event_id', event_row.event_id, 'name', event_row.name, 'status', event_row.status),
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
      'request_id', r.request_id, 'event_id', r.event_id, 'equipment_id', r.equipment_id,
      'equipment_type', q.name, 'quantity', r.quantity, 'notes', r.notes, 'status', r.status,
      'arrangement_notes', r.arrangement_notes, 'shortfall', r.shortfall,
      'placement_venue_id', r.placement_venue_id, 'placement_venue_name', v.name,
      'placement_position', r.placement_position, 'version', r.version) order by r.request_id)
      from public.equipment_requests r join public.equipment q using (equipment_id)
      left join public.venues v on v.venue_id = r.placement_venue_id where r.event_id = p_event_id), '[]'::jsonb),
    'equipment', coalesce((select jsonb_agg(jsonb_build_object('equipment_id', equipment_id, 'type', name) order by equipment_id)
      from public.equipment), '[]'::jsonb),
    'venues', coalesce((select jsonb_agg(jsonb_build_object('venue_id', venue_id, 'name', name) order by venue_id)
      from public.venues), '[]'::jsonb),
    'can_request', caller_role = 'event_coordinator' and event_row.status in ('approved', 'planning', 'awaiting_safety_check'),
    'can_arrange', caller_role = 'technical_support_staff' and event_row.status in ('approved', 'planning', 'awaiting_safety_check'));
end;
$$;
revoke all on function public.manage_equipment_requirements(text,integer,bigint,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.manage_equipment_requirements(text,integer,bigint,bigint,jsonb) to authenticated;

-- AC1: events whose arrangements were already complete before this migration
-- join the list now rather than at their next arrangement change. Nobody
-- acted, so the upgrade writes no history row (naming the coordinator would
-- invent an actor); the wait is still stamped by safety_check_track_event().
select public.refresh_safety_check_status(e.event_id, false)
  from public.events e where e.status in ('approved', 'planning') order by e.event_id;

-- AC3: the planning drawer loads every editable value from the work queue, so
-- it needs expected crowd movement too or saving would blank it. Unchanged
-- from 202610160003_work_queue_planning_details.sql except that one field.
create or replace view public.internal_work_items as
select 'event'::text as kind, e.event_id::bigint as item_id, e.event_id,
  coalesce(nullif(e.name, ''), 'Untitled event')::text as title,
  coalesce(nullif(e.name, ''), 'Untitled event')::text as event_name,
  e.status::text as status, e.proposed_date as starts_at,
  (select max(b.ends_at) from public.venue_bookings b
    where b.event_id = e.event_id and b.status = 'confirmed') as ends_at,
  'event_coordinator'::text as audience, e.coordinator_id as assigned_to,
  case when e.status in ('unassigned', 'submitted', 'under_review') then 'review' else 'assigned' end as category,
  jsonb_build_object('organisation', e.organisation, 'purpose', e.purpose,
    'description', e.description, 'expected_attendance', e.expected_attendance,
    'venue_requirements', e.venue_requirements, 'accessibility_needs', e.accessibility_needs,
    'equipment_requirements', e.equipment_requirements, 'registration_needed', e.registration_needed,
    'registration_capacity', e.registration_capacity, 'registration_opens_at', e.registration_opens_at,
    'registration_closes_at', e.registration_closes_at, 'planning_notes', e.planning_notes,
    'expected_crowd_movement', e.expected_crowd_movement) as details
from public.events e
where e.status in ('unassigned', 'submitted', 'under_review')
  or (e.coordinator_id is not null and e.status in
      ('approved', 'planning', 'awaiting_safety_check', 'safety_rejected', 'preparation', 'confirmed'))
union all
select 'venue', r.request_id, e.event_id, v.name::text,
  coalesce(nullif(e.name, ''), 'Untitled event')::text,
  r.status, r.starts_at, r.ends_at, 'venue_staff', null::uuid, 'venue',
  jsonb_build_object('location', v.location, 'capacity', v.capacity,
    'expected_attendance', e.expected_attendance,
    'venue_requirements', coalesce(r.venue_requirements, e.venue_requirements),
    'accessibility_needs', e.accessibility_needs, 'notes', r.notes,
    'layout', r.layout, 'requested_by', u.name, 'hold_id', h.hold_id)
from public.venue_booking_requests r
join public.events e on e.event_id = r.event_id
join public.venues v on v.venue_id = r.venue_id
left join public.users u on u.user_id = r.requested_by
left join public.venue_holds h on h.request_id = r.request_id
where r.status = 'pending' and e.status in ('unassigned', 'submitted', 'under_review', 'approved',
  'planning', 'awaiting_safety_check', 'safety_rejected', 'preparation', 'confirmed')
union all
select 'equipment', r.request_id, e.event_id, q.name::text,
  coalesce(nullif(e.name, ''), 'Untitled event')::text,
  r.status, coalesce(r.starts_at, e.proposed_date), r.ends_at, 'technical_support_staff', null::uuid, 'equipment',
  jsonb_build_object('quantity', r.quantity, 'equipment_requirements', e.equipment_requirements,
    'notes', r.notes, 'arrangement_notes', r.arrangement_notes, 'shortfall', r.shortfall,
    'placement_venue_id', r.placement_venue_id, 'placement_venue_name', placement.name,
    'placement_position', r.placement_position, 'version', r.version)
from public.equipment_requests r
join public.events e on e.event_id = r.event_id
join public.equipment q on q.equipment_id = r.equipment_id
left join public.venues placement on placement.venue_id = r.placement_venue_id
where (r.status = 'pending' or (r.status = 'approved' and exists (
  select 1 from public.equipment_reservations receipt where receipt.request_id = r.request_id))) and e.status in ('unassigned', 'submitted', 'under_review', 'approved',
  'planning', 'awaiting_safety_check', 'safety_rejected', 'preparation', 'confirmed');
-- Replacing a view keeps its privileges; restated here, as SG2-49 did, so the
-- rule stays visible at the point that last replaces the view.
revoke all on public.internal_work_items from public, anon, authenticated;
grant select on public.internal_work_items to service_role;

-- AC2/AC3/AC4: the Safety Officer's list, oldest wait first. Venues are the
-- event's approved requests (each backed by a confirmed booking, or the event
-- would not be awaiting), with the layout the request asked for; equipment is
-- every live request with where it will be placed.
create function public.safety_check_queue()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  caller_role text;
begin
  if caller is null then raise exception using errcode = '42501', message = 'Access denied'; end if;
  select ar.role into caller_role from public.account_roles ar where ar.user_id = caller;
  if caller_role is distinct from 'safety_officer' then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;

  return coalesce((
    select jsonb_agg(item order by since, id)
    from (
      select e.awaiting_safety_check_since as since, e.event_id as id, jsonb_build_object(
        'event_id', e.event_id,
        'safety_check_revision', e.safety_check_revision,
        'name', e.name,
        'organisation', e.organisation,
        'proposed_date', e.proposed_date,
        'awaiting_since', e.awaiting_safety_check_since,
        'expected_attendance', e.expected_attendance,
        'accessibility_needs', e.accessibility_needs,
        'expected_crowd_movement', e.expected_crowd_movement,
        'venues', coalesce((
          select jsonb_agg(jsonb_build_object(
            'request_id', r.request_id,
            'venue_id', v.venue_id,
            'venue_name', v.name,
            'location', v.location,
            'capacity', v.capacity,
            'layout', r.layout,
            'starts_at', r.starts_at,
            'ends_at', r.ends_at,
            'accessibility_features', v.accessibility_features,
            'emergency_access', o.emergency_access,
            'known_restrictions', o.known_restrictions
          ) order by r.starts_at, r.request_id)
          from public.venue_booking_requests r
          join public.venues v on v.venue_id = r.venue_id
          left join public.venue_operations o on o.venue_id = v.venue_id
          where r.event_id = e.event_id and lower(r.status) = 'approved'), '[]'::jsonb),
        'equipment', coalesce((
          select jsonb_agg(jsonb_build_object(
            'request_id', q.request_id,
            'equipment_name', eq.name,
            'quantity', q.quantity,
            'placement_venue_name', pv.name,
            'placement_position', q.placement_position,
            'arrangement_notes', q.arrangement_notes
          ) order by q.starts_at, q.request_id)
          from public.equipment_requests q
          join public.equipment eq on eq.equipment_id = q.equipment_id
          left join public.venues pv on pv.venue_id = q.placement_venue_id
          where q.event_id = e.event_id and lower(q.status) not in ('rejected', 'cancelled')), '[]'::jsonb)
      ) as item
      from public.events e
      where e.status = 'awaiting_safety_check'
    ) awaiting
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.safety_check_queue() from public, anon, authenticated;
grant execute on function public.safety_check_queue() to authenticated;

commit;
