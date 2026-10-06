-- SG2-49: Venue Staff approve or reject a coordinator's venue request.
--
-- Approving commits the venue: a confirmed booking is created for the
-- requested period and the coordinator is notified (AC1). Rejecting needs a
-- reason the coordinator can see (AC2). Either way the decision, who made it
-- and when are recorded on the request and in the event's history (AC3).
--
-- Decisions go through decide_venue_booking_request(), run with the Venue
-- Staff member's own login so decided_by is the real person. Like the SG2-84
-- hold functions, it locks the venue row first, so two approvals of
-- overlapping requests (or an approval racing a hold or a block) cannot both
-- commit the same period.
begin;

alter table public.venue_booking_requests
  add column decided_by uuid references public.users(user_id),
  add column decided_at timestamptz,
  add column decision_reason text,
  add column venue_booking_id bigint references public.venue_bookings(booking_id) on delete set null;

-- Who decided and when always travel together (AC3).
alter table public.venue_booking_requests
  add constraint venue_booking_requests_decision_recorded_together
  check ((decided_by is null) = (decided_at is null));

-- A coordinator's request (SG2-48) is never approved or rejected anonymously,
-- and a rejection always says why (AC2, AC3). Rows a tentative hold creates
-- for itself (SG2-84) have no requester and are decided by the hold.
alter table public.venue_booking_requests
  add constraint venue_booking_requests_decision_required
  check (requested_by is null or status not in ('approved', 'rejected') or decided_at is not null),
  add constraint venue_booking_requests_rejection_reason
  check (requested_by is null or status <> 'rejected' or nullif(btrim(decision_reason), '') is not null),
  add constraint venue_booking_requests_reason_length
  check (char_length(decision_reason) <= 500);

-- Notifications for one person each. Only the decision function writes them;
-- each person reads only their own.
create table public.notifications (
  notification_id bigserial primary key,
  recipient_id uuid not null references public.users(user_id) on delete cascade,
  event_id integer references public.events(event_id) on delete cascade,
  request_id bigint references public.venue_booking_requests(request_id) on delete cascade,
  kind text not null check (kind in ('venue_request_approved', 'venue_request_rejected')),
  message text not null check (char_length(message) between 1 and 2000),
  created_at timestamptz not null default clock_timestamp(),
  -- One notice per decision, even if the decision were somehow replayed.
  unique (request_id, recipient_id, kind)
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

alter table public.notifications enable row level security;
alter table public.notifications force row level security;
revoke all on public.notifications from public, anon, authenticated;
revoke all on sequence public.notifications_notification_id_seq from public, anon, authenticated;
grant select on public.notifications to authenticated;
grant select, insert, update, delete on public.notifications to service_role;
grant usage, select on sequence public.notifications_notification_id_seq to service_role;
create policy notifications_recipient on public.notifications
  for select to authenticated using (recipient_id = (select auth.uid()));

create function public.decide_venue_booking_request(p_request_id bigint, p_decision text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.venue_booking_requests;
  e public.events;
  v public.venues;
  venue integer;
  hold bigint;
  booking bigint;
  clash record;
  reason text := nullif(btrim(p_reason), '');
  instant timestamptz;
begin
  if not exists (select 1 from public.account_roles where user_id = auth.uid() and role = 'venue_staff') then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject')
      or (p_decision = 'reject' and reason is null) or char_length(reason) > 500 then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  select venue_id into venue from public.venue_booking_requests where request_id = p_request_id;
  if not found then return jsonb_build_object('outcome', 'missing'); end if;
  -- Venue before request: the order every booking, block and hold write uses.
  select * into v from public.venues where venue_id = venue for update;
  select * into r from public.venue_booking_requests where request_id = p_request_id for update;
  if r.status <> 'pending' then
    return jsonb_build_object('outcome', 'decided', 'status', r.status);
  end if;
  -- A hold's request is converted or released through the hold (SG2-84).
  select hold_id into hold from public.venue_holds where request_id = r.request_id;
  if hold is not null then return jsonb_build_object('outcome', 'hold', 'hold_id', hold); end if;
  select * into e from public.events where event_id = r.event_id for update;
  instant := clock_timestamp();

  if p_decision = 'approve' then
    if e.status not in ('approved', 'planning') or r.ends_at <= instant then
      return jsonb_build_object('outcome', 'closed');
    end if;
    -- AC1: no booking conflict, under the venue lock taken above.
    select 'booking'::text as kind, b.starts_at, b.ends_at, coalesce(nullif(oe.name, ''), 'Untitled event')::text as label
      into clash
      from public.venue_bookings b left join public.events oe on oe.event_id = b.event_id
      where b.venue_id = r.venue_id and b.status = 'confirmed' and b.starts_at < r.ends_at and b.ends_at > r.starts_at
      order by b.starts_at limit 1;
    if not found then
      select 'block'::text as kind, u.starts_at, u.ends_at, u.reason::text as label
        into clash
        from public.venue_unavailability u
        where u.venue_id = r.venue_id and u.starts_at < r.ends_at and u.ends_at > r.starts_at
        order by u.starts_at limit 1;
    end if;
    if not found then
      select 'hold'::text as kind, h.starts_at, h.ends_at, coalesce(nullif(he.name, ''), 'Untitled event')::text as label
        into clash
        from public.venue_holds h join public.events he on he.event_id = h.event_id
        where h.venue_id = r.venue_id and h.status = 'tentative' and h.expires_at > instant
          and h.starts_at < r.ends_at and h.ends_at > r.starts_at
        order by h.starts_at limit 1;
    end if;
    if found then
      return jsonb_build_object('outcome', 'conflict', 'kind', clash.kind,
        'starts_at', clash.starts_at, 'ends_at', clash.ends_at, 'label', clash.label);
    end if;
    -- AC1: enough capacity, or an approved exception covering the attendance
    -- (SG2-47). Missing facilities are refused by the API before this point.
    if e.expected_attendance is not null and (v.capacity is null or e.expected_attendance > v.capacity)
        and not exists (select 1 from public.venue_capacity_exceptions x
          where x.request_id = r.request_id and x.expected_attendance >= e.expected_attendance) then
      return jsonb_build_object('outcome', 'capacity');
    end if;

    insert into public.venue_bookings (venue_id, event_id, starts_at, ends_at, status)
      values (r.venue_id, r.event_id, r.starts_at, r.ends_at, 'confirmed')
      returning booking_id into booking;
    -- The event's own venue, unless an earlier one is already set (SG2-82).
    update public.events set venue_booking_id = coalesce(venue_booking_id, booking) where event_id = e.event_id;
    update public.venue_booking_requests
      set status = 'approved', decided_by = auth.uid(), decided_at = instant,
        decision_reason = reason, venue_booking_id = booking
      where request_id = r.request_id
      returning * into r;
  else
    update public.venue_booking_requests
      set status = 'rejected', decided_by = auth.uid(), decided_at = instant, decision_reason = reason
      where request_id = r.request_id
      returning * into r;
  end if;

  -- AC3: the decision appears in the event's history (SG2-40).
  insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
    values (r.event_id, auth.uid(), 'venue_booking_request',
      'Pending: ' || v.name || ' (request ' || r.request_id || ')',
      initcap(r.status) || ': ' || v.name || ' (request ' || r.request_id || ')' || coalesce(' — ' || reason, ''));
  -- AC1/AC2: the coordinator is told, with the reason for a rejection.
  if e.coordinator_id is not null then
    insert into public.notifications (recipient_id, event_id, request_id, kind, message)
      values (e.coordinator_id, r.event_id, r.request_id, 'venue_request_' || r.status,
        v.name || ' was ' || r.status || ' for ' || coalesce(nullif(e.name, ''), 'Untitled event')
          || case when r.status = 'rejected' then ': ' || reason else '.' end)
      on conflict (request_id, recipient_id, kind) do nothing;
  end if;
  return jsonb_build_object('outcome', 'updated', 'request_id', r.request_id, 'status', r.status,
    'venue_booking_id', r.venue_booking_id, 'decided_at', r.decided_at);
end;
$$;
revoke all on function public.decide_venue_booking_request(bigint, text, text) from public, anon, authenticated;
grant execute on function public.decide_venue_booking_request(bigint, text, text) to authenticated;

-- Venue Staff see in the work queue when a request belongs to a tentative
-- hold, which is decided from the holds screen instead. Unchanged otherwise
-- from SG2-48.
create or replace view public.internal_work_items as
select 'event'::text as kind, e.event_id::bigint as item_id, e.event_id,
  coalesce(nullif(e.name, ''), 'Untitled event')::text as title,
  coalesce(nullif(e.name, ''), 'Untitled event')::text as event_name,
  e.status::text as status, e.proposed_date as starts_at, null::timestamptz as ends_at,
  'event_coordinator'::text as audience, e.coordinator_id as assigned_to,
  case when e.status in ('submitted', 'under_review') then 'review' else 'assigned' end as category,
  jsonb_build_object('organisation', e.organisation, 'purpose', e.purpose,
    'description', e.description, 'expected_attendance', e.expected_attendance,
    'venue_requirements', e.venue_requirements, 'accessibility_needs', e.accessibility_needs,
    'equipment_requirements', e.equipment_requirements, 'registration_needed', e.registration_needed) as details
from public.events e
where e.status in ('submitted', 'under_review')
  or (e.coordinator_id is not null and e.status in ('approved', 'planning', 'confirmed'))
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
where r.status = 'pending' and e.status in ('submitted', 'under_review', 'approved', 'planning', 'confirmed')
union all
select 'equipment', r.request_id, e.event_id, q.name::text,
  coalesce(nullif(e.name, ''), 'Untitled event')::text,
  r.status, r.starts_at, r.ends_at, 'technical_support_staff', null::uuid, 'equipment',
  jsonb_build_object('quantity', r.quantity, 'equipment_requirements', e.equipment_requirements,
    'notes', r.notes)
from public.equipment_requests r
join public.events e on e.event_id = r.event_id
join public.equipment q on q.equipment_id = r.equipment_id
where r.status = 'pending' and e.status in ('submitted', 'under_review', 'approved', 'planning', 'confirmed');

commit;
