-- SG2-57 (AC1/AC2), hosted QA 29 Oct 2026: equipment the organiser asked for
-- is outstanding until it has been requested.
--
-- Event #48 asked for 'Wireless microphones x 2' but no equipment request was
-- ever made. With no equipment_requests rows the readiness rules treated the
-- equipment as not required, so approving its venues handed it to the safety
-- check (SG2-94) and nothing would have stopped it being confirmed (SG2-58)
-- without the microphones.
--
-- An event now NEEDS equipment when its equipment_requirements text is set
-- and is not the request form's "No equipment needed" answer, 'None'
-- (compared trimmed and case-insensitively): event_equipment_needed() below,
-- mirrored by equipmentNeeded() in server/src/events/arrangementReadiness.ts.
-- An event that needs equipment and has no live equipment request keeps its
-- equipment outstanding. Live requests are judged exactly as before (each
-- reserved, placed and with no shortfall), and an event that needs none and
-- requested none still needs none.
--
-- safety_check_arrangements_ready() (202610190004), confirm_event()
-- (202610220001) and SG2-69's reminder projection
-- notification_outstanding_arrangements() (202610200003) are replaced from
-- their latest definitions, unchanged apart from the SG2-57 lines, so the
-- hand-off, the Confirm gate, reminders and the arrangements panel keep
-- agreeing. The events refresh trigger also fires on
-- equipment_requirements, so a coordinator who changes the text (to 'None',
-- or to a real need) re-evaluates the hand-off at once.
--
-- Existing events are deliberately not refreshed here: a backfill would bounce
-- events already awaiting their check back to Planning and send notices. Each
-- re-evaluates on its next arrangement change or equipment_requirements edit,
-- and confirm_event() applies the new rule immediately.
begin;

-- The one SQL definition of "the organiser asked for equipment": any answer
-- except 'None' alone (any case, ASCII whitespace either side). The same
-- pattern as NO_EQUIPMENT_PATTERN in server/src/events/arrangementReadiness.ts.
create function public.event_equipment_needed(p_equipment_requirements text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_equipment_requirements !~* '^[ \t\n\r\f\v]*none[ \t\n\r\f\v]*$', false);
$$;
revoke all on function public.event_equipment_needed(text) from public, anon, authenticated;

-- Unchanged from 202610190004_safety_check_queue.sql except the SG2-57 rule.
create or replace function public.safety_check_arrangements_ready(p_event public.events)
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
    -- reserved.
    and not exists (select 1 from public.equipment_requests r
      where r.event_id = p_event.event_id and lower(r.status) not in ('rejected', 'cancelled')
        and (r.placement_venue_id is null or r.shortfall is distinct from 0
          or not exists (select 1 from public.equipment_reservations receipt
            where receipt.request_id = r.request_id)))
    -- SG2-57: equipment the organiser asked for must have been requested; an
    -- event that asked for none ('None') and requested none needs none.
    and (not public.event_equipment_needed(p_event.equipment_requirements)
      or exists (select 1 from public.equipment_requests r
        where r.event_id = p_event.event_id and lower(r.status) not in ('rejected', 'cancelled')));
$$;
revoke all on function public.safety_check_arrangements_ready(public.events) from public, anon, authenticated;

-- SG2-57: changing what equipment the event needs re-evaluates the hand-off,
-- as settling a recheck already does. The refresh writes only status and
-- revision, so this still does not fire again.
drop trigger safety_check_refresh on public.events;
create trigger safety_check_refresh after update of arrangements_recheck_needed, outstanding_arrangements, equipment_requirements
  on public.events for each row
  when (old.arrangements_recheck_needed is distinct from new.arrangements_recheck_needed
    or old.outstanding_arrangements is distinct from new.outstanding_arrangements
    or old.equipment_requirements is distinct from new.equipment_requirements)
  execute function public.safety_check_refresh_from_arrangement();

-- Unchanged from 202610220001_safety_approval_gate.sql except the SG2-57
-- equipment rule.
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
            where receipt.request_id = r.request_id)))
    -- SG2-57: equipment the organiser asked for that was never requested.
    or (public.event_equipment_needed(event_row.equipment_requirements)
      and not exists (select 1 from public.equipment_requests r
        where r.event_id = p_event_id and lower(r.status) not in ('rejected', 'cancelled'))) then
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

-- SG2-69's reminder projection mirrors confirm_event(), so the coordinator is
-- reminded about equipment the organiser asked for but nobody requested.
-- Unchanged from 202610200003_notifications_inbox_reminders.sql except the
-- SG2-57 equipment rule.
create or replace function public.notification_outstanding_arrangements(p_event public.events) returns text[]
language plpgsql stable security definer set search_path='' as $$
declare outstanding text[]:=array[]::text[];
begin
  if (p_event.arrangements_recheck_needed is true and coalesce(p_event.outstanding_arrangements,'[]'::jsonb) @> '["venue_recheck"]'::jsonb)
    or not exists(select 1 from public.venue_booking_requests r where r.event_id=p_event.event_id and lower(r.status)<>'cancelled')
    or exists(select 1 from public.venue_booking_requests r where r.event_id=p_event.event_id and lower(r.status) in ('pending','rejected'))
    or exists(select 1 from public.venue_booking_requests r where r.event_id=p_event.event_id and lower(r.status)='approved'
      and not exists(select 1 from public.venue_bookings b where b.status='confirmed'
        and (b.booking_id=r.venue_booking_id or b.booking_id in(select h.booking_id from public.venue_holds h where h.request_id=r.request_id))))
    or exists(select 1 from public.venue_booking_disruptions d join public.venue_bookings b on b.booking_id=d.booking_id
      where b.event_id=p_event.event_id and b.status='confirmed') then outstanding:=outstanding||'venue'::text; end if;
  if (p_event.arrangements_recheck_needed is true and coalesce(p_event.outstanding_arrangements,'[]'::jsonb) @> '["equipment_recheck"]'::jsonb)
    or exists(select 1 from public.equipment_requests r where r.event_id=p_event.event_id and lower(r.status) not in ('rejected','cancelled')
      and (r.placement_venue_id is null or r.shortfall is distinct from 0 or not exists(select 1 from public.equipment_reservations receipt where receipt.request_id=r.request_id)))
    -- SG2-57: equipment the organiser asked for that was never requested.
    or (public.event_equipment_needed(p_event.equipment_requirements)
      and not exists(select 1 from public.equipment_requests r where r.event_id=p_event.event_id and lower(r.status) not in ('rejected','cancelled')))
    then outstanding:=outstanding||'equipment'::text; end if;
  if (p_event.arrangements_recheck_needed is true and coalesce(p_event.outstanding_arrangements,'[]'::jsonb) @> '["registration_recheck"]'::jsonb)
    or (p_event.registration_needed is true and (p_event.registration_capacity is null or p_event.registration_opens_at is null or p_event.registration_closes_at is null))
    then outstanding:=outstanding||'registration'::text; end if;
  return outstanding;
end $$;
revoke all on function public.notification_outstanding_arrangements(public.events) from public,anon,authenticated,service_role;

commit;
