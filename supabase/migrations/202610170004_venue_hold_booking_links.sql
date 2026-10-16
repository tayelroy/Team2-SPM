-- SG2-84 AC5 / SG2-51 AC2: a converted hold uses the same request-to-booking
-- link as an ordinary approval, so reasoned release cancels the request too.
-- Previously the link lived only on venue_holds. The booking released, but its
-- approved request remained required and kept otherwise-ready events outstanding.
--
-- Preserve existing permissions, hold history and request actor/decision fields.
-- Reconcile only exact hold/request/booking event, venue and period matches;
-- no guessed identity, historical actor, timestamp, audit or notice is inserted.
begin;

create or replace function public.change_venue_hold(p_hold_id bigint,p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h public.venue_holds; venue integer; v public.venues; e public.events; booking bigint; instant timestamptz; gap interval;
begin
  if not exists(select 1 from public.account_roles where user_id = auth.uid() and role = 'venue_staff') then
    raise exception using errcode = '42501',message = 'Access denied';
  end if;
  if p_action not in ('release','convert') or p_action is null then return jsonb_build_object('outcome','invalid'); end if;
  select venue_id into venue from public.venue_holds where hold_id = p_hold_id;
  if not found then return jsonb_build_object('outcome','missing'); end if;
  select * into v from public.venues where venue_id = venue for update;
  select * into h from public.venue_holds where hold_id = p_hold_id for update;
  instant := clock_timestamp();
  if h.status <> 'tentative' then return jsonb_build_object('outcome','inactive'); end if;
  if h.expires_at <= instant then
    -- Persist the transition, notifications and history in this same request.
    perform public.expire_venue_hold(h); return jsonb_build_object('outcome','inactive');
  end if;
  select * into e from public.events where event_id = h.event_id for update;
  perform 1 from public.venue_booking_requests where request_id = h.request_id and status = 'pending' for update;
  if not found then return jsonb_build_object('outcome','inactive'); end if;
  if h.expires_at <= clock_timestamp() then perform public.expire_venue_hold(h); return jsonb_build_object('outcome','inactive'); end if;
  if p_action = 'convert' then
    -- SG2-78: converting must leave setup and turnaround room either side.
    gap := public.venue_preparation_gap(venue);
    if e.status not in ('approved','planning') or h.ends_at <= clock_timestamp() then return jsonb_build_object('outcome','invalid'); end if;
    if exists(select 1 from public.venue_bookings where venue_id = venue and status = 'confirmed' and starts_at < h.ends_at + gap and ends_at > h.starts_at - gap)
      or exists(select 1 from public.venue_unavailability where venue_id = venue and starts_at < h.ends_at and ends_at > h.starts_at)
      or exists(select 1 from public.venue_holds where venue_id = venue and hold_id <> h.hold_id and status = 'tentative' and expires_at > instant and starts_at < h.ends_at + gap and ends_at > h.starts_at - gap)
      then return jsonb_build_object('outcome','conflict'); end if;
    -- The established capacity-exception workflow covers this request and
    -- attendance; a prior approval for lower attendance cannot authorize it.
    if e.expected_attendance is not null and (v.capacity is null or e.expected_attendance > v.capacity)
      and not exists(select 1 from public.venue_capacity_exceptions where request_id = h.request_id and expected_attendance >= e.expected_attendance)
      then return jsonb_build_object('outcome','capacity'); end if;
    if exists(select 1 from (values
      ('\yproject(or|ors|ion)\y'),('\yscreens?\y'),('\yPA\y|public address|sound system'),('\ymic(rophone)?s?\y'),
      ('\ystages?\y'),('\ywhiteboards?\y'),('\ywi-?fi\y|\yinternet\y'),('\ykitchens?\y|\ycatering\y'),
      ('\ybars?\y'),('\ypower\y'),('\yair[\s-]?con(ditioning|ditioned)?\y'),('\yvideo[\s-]?conferenc(e|ing)\y')
    ) requirements(pattern) where coalesce(e.venue_requirements,'') ~* pattern and not(coalesce(v.facilities,'') ~* pattern))
      then return jsonb_build_object('outcome','suitability'); end if;
    if h.expires_at <= clock_timestamp() then perform public.expire_venue_hold(h); return jsonb_build_object('outcome','inactive'); end if;
    -- Mark the hold inactive before the booking insert. The shared trigger
    -- still excludes every competing live hold under the same venue lock.
    update public.venue_holds set status = 'released' where hold_id = h.hold_id;
    insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status)
      values(venue,h.event_id,h.starts_at,h.ends_at,'confirmed') returning booking_id into booking;
    update public.venue_holds set status = 'converted',booking_id = booking where hold_id = h.hold_id returning * into h;
    update public.venue_booking_requests set status = 'approved', venue_booking_id = booking where request_id = h.request_id;
    update public.events set venue_booking_id = booking where event_id = h.event_id;
    -- SG2-68 AC1: the organiser is told their event now has the venue.
    if e.organiser_id is not null then
      insert into public.notifications(recipient_id,event_id,request_id,kind,message)
        values(e.organiser_id,h.event_id,h.request_id,'venue_request_approved',
          v.name || ' was approved for ' || coalesce(nullif(e.name,''),'Untitled event') || '.')
        on conflict (request_id, recipient_id, kind) do nothing;
    end if;
  else
    update public.venue_holds set status = 'released' where hold_id = h.hold_id returning * into h;
    update public.venue_booking_requests set status = 'cancelled' where request_id = h.request_id;
  end if;
  insert into public.event_audit_logs(event_id,actor_id,field_name,old_value,new_value)
    values(h.event_id,auth.uid(),'venue_hold_status','Tentative hold ' || h.hold_id,initcap(h.status) || ' hold ' || h.hold_id);
  return jsonb_build_object('outcome','updated','hold',public.venue_hold_json(h));
end;
$$;

-- Legacy converted holds keep their historical status and booking link. Never
-- overwrite another direct booking link or reactivate a cancelled request.
with verified as (
  select r.request_id, b.booking_id, b.status as booking_status
  from public.venue_holds h
  join public.venue_booking_requests r
    on r.request_id = h.request_id and r.event_id = h.event_id and r.venue_id = h.venue_id
    and r.starts_at = h.starts_at and r.ends_at = h.ends_at
  join public.venue_bookings b
    on b.booking_id = h.booking_id and b.event_id = h.event_id and b.venue_id = h.venue_id
    and b.starts_at = h.starts_at and b.ends_at = h.ends_at
  where h.status = 'converted' and r.status in ('approved', 'cancelled')
    and b.status in ('confirmed', 'cancelled')
    and (r.venue_booking_id is null or r.venue_booking_id = b.booking_id)
)
update public.venue_booking_requests r
set venue_booking_id = v.booking_id,
    status = case when v.booking_status = 'cancelled' then 'cancelled' else r.status end
from verified v
where r.request_id = v.request_id
  and (r.venue_booking_id is distinct from v.booking_id
    or (r.status = 'approved' and v.booking_status = 'cancelled'));

commit;
