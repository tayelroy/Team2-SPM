-- SG2-82 (Week 7 customer change #3): several venues for one event.
--
-- An event may already ask for several venues (SG2-48 AC4), each checked and
-- decided on its own (SG2-47, SG2-49, SG2-50, SG2-78). The event's venue
-- arrangement is ready only when every venue it needs is approved (AC5), so
-- a pending or rejected request keeps it not ready. When the coordinator no
-- longer needs a venue, for example after it was rejected and another was
-- found, they withdraw the request: it is cancelled, no longer counts towards
-- the arrangement, and the venue can be asked for again.
--
-- Withdrawals go through withdraw_venue_booking_request(), run with the
-- coordinator's own login so withdrawn_by is the real person. It locks the
-- request row, as decide_venue_booking_request() does before deciding, so a
-- withdrawal and a decision made at the same moment cannot both succeed:
-- whichever commits second finds the request no longer pending.
begin;

alter table public.venue_booking_requests
  add column withdrawn_by uuid references public.users(user_id) on delete set null,
  add column withdrawn_at timestamptz;

-- Only a cancelled request can have been withdrawn.
alter table public.venue_booking_requests
  add constraint venue_booking_requests_withdrawal_cancelled
  check (withdrawn_at is null or status = 'cancelled');

create function public.withdraw_venue_booking_request(p_request_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.venue_booking_requests;
  e public.events;
  hold bigint;
  venue_name text;
  previous text;
begin
  if not exists (select 1 from public.account_roles where user_id = auth.uid() and role = 'event_coordinator') then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;

  select * into r from public.venue_booking_requests where request_id = p_request_id for update;
  if not found then return jsonb_build_object('outcome', 'missing'); end if;
  select * into e from public.events where event_id = r.event_id;
  -- Only the event's assigned coordinator withdraws; any other request is
  -- reported as missing so it is not revealed.
  if e.coordinator_id is null or e.coordinator_id <> auth.uid() then
    return jsonb_build_object('outcome', 'missing');
  end if;
  -- A hold's request is released through the hold (SG2-84).
  select hold_id into hold from public.venue_holds where request_id = r.request_id;
  if hold is not null then return jsonb_build_object('outcome', 'hold', 'hold_id', hold); end if;
  -- An approved request has a booking, which is released instead (SG2-51).
  if r.status not in ('pending', 'rejected') then
    return jsonb_build_object('outcome', 'inactive', 'status', r.status);
  end if;

  previous := r.status;
  update public.venue_booking_requests
    set status = 'cancelled', withdrawn_by = auth.uid(), withdrawn_at = clock_timestamp()
    where request_id = r.request_id
    returning * into r;

  -- The withdrawal appears in the event's history (SG2-40).
  select v.name into venue_name from public.venues v where v.venue_id = r.venue_id;
  insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
    values (r.event_id, auth.uid(), 'venue_booking_request',
      initcap(previous) || ': ' || venue_name || ' (request ' || r.request_id || ')',
      'Withdrawn: ' || venue_name || ' (request ' || r.request_id || ')');
  return jsonb_build_object('outcome', 'withdrawn', 'request_id', r.request_id, 'withdrawn_at', r.withdrawn_at);
end;
$$;
revoke all on function public.withdraw_venue_booking_request(bigint) from public, anon, authenticated;
grant execute on function public.withdraw_venue_booking_request(bigint) to authenticated;

commit;
