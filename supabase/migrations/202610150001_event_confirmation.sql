-- SG2-58: the assigned coordinator confirms a Preparation event once every
-- required arrangement is in place, and the organiser is told.
--
-- confirmed_by/confirmed_at mirror completed_by/completed_at from
-- 202610090003_event_completion.sql: who and when always travel together.
-- Events already confirmed before this migration keep both columns null, so
-- the paired check holds for them and no "confirmed requires a record"
-- constraint is added (their confirmation predates the record).
begin;

alter table public.events
  add column if not exists confirmed_by uuid references public.users(user_id),
  add column if not exists confirmed_at timestamptz;

alter table public.events
  add constraint events_confirmation_recorded_together
  check ((confirmed_by is null) = (confirmed_at is null));

comment on column public.events.confirmed_by is
  'Coordinator who confirmed the event (SG2-58 AC1); null for events confirmed before SG2-58.';
comment on column public.events.confirmed_at is
  'When the event was confirmed (SG2-58 AC1); null for events confirmed before SG2-58.';

-- AC1: the organiser's confirmation notice shares SG2-49's notifications table.
alter table public.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check check (kind in
    ('venue_request_approved', 'venue_request_rejected', 'venue_booking_released',
     'equipment_reserved', 'event_confirmed'));

create function public.confirm_event(p_event_id integer)
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
  select ar.role into caller_role from public.account_roles ar where ar.user_id = caller for share;
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
  if event_row.status <> 'preparation' then
    return jsonb_build_object('outcome', 'closed', 'status', event_row.status::text);
  end if;

  -- Readiness rules are shared with server/src/events/arrangementReadiness.ts.
  -- Live = not rejected/cancelled (case-insensitive).
  if not exists (select 1 from public.venue_booking_requests r
      where r.event_id = p_event_id and lower(r.status) not in ('rejected', 'cancelled'))
    or exists (select 1 from public.venue_booking_requests r
      where r.event_id = p_event_id and lower(r.status) = 'pending')
    -- An approved request counts only while a confirmed booking is linked to
    -- it, directly or through the hold it was converted from.
    or exists (select 1 from public.venue_booking_requests r
      where r.event_id = p_event_id and lower(r.status) = 'approved'
        and not exists (select 1 from public.venue_bookings b
          where b.status = 'confirmed'
            and (b.booking_id = r.venue_booking_id
              or b.booking_id in (select h.booking_id from public.venue_holds h
                where h.request_id = r.request_id)))) then
    outstanding := outstanding || 'venue'::text;
  end if;
  if exists (select 1 from public.equipment_requests r
      where r.event_id = p_event_id and lower(r.status) not in ('rejected', 'cancelled')
        and (r.placement_venue_id is null or r.shortfall is distinct from 0
          or not exists (select 1 from public.equipment_reservations receipt
            where receipt.request_id = r.request_id))) then
    outstanding := outstanding || 'equipment'::text;
  end if;
  if event_row.registration_needed is true and (event_row.registration_capacity is null
      or event_row.registration_opens_at is null or event_row.registration_closes_at is null) then
    outstanding := outstanding || 'registration'::text;
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
revoke all on function public.confirm_event(integer) from public, anon, authenticated;
grant execute on function public.confirm_event(integer) to authenticated;

commit;
