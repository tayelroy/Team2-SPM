-- SG2-106 AC1: a hold blocks venue deletion only while its reserved period
-- is current or future. Its expiry can legitimately outlast that period.
-- Keep historical holds, requests, notices and event history unchanged.
-- Replace only the existing RPC; CREATE OR REPLACE preserves its owner and
-- grants, and the venue lock, role check and deletion audit stay unchanged.
begin;

create or replace function public.delete_venue(p_venue_id integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.venues; instant timestamptz; h public.venue_holds; blockers jsonb;
begin
  if not exists(select 1 from public.account_roles where user_id = auth.uid() and role = 'venue_staff') then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  select * into v from public.venues where venue_id = p_venue_id for update;
  if not found or v.deleted_at is not null then return jsonb_build_object('outcome', 'missing'); end if;
  instant := clock_timestamp();
  -- A hold past its deadline is no longer live; record that before counting.
  for h in select * from public.venue_holds where venue_id = p_venue_id and status = 'tentative' and expires_at <= instant for update loop
    perform public.expire_venue_hold(h);
  end loop;
  select coalesce(jsonb_agg(b.item order by b.starts_at, b.kind, b.id), '[]'::jsonb) into blockers from (
    select 'booking' as kind, vb.booking_id as id, vb.starts_at,
      jsonb_build_object('kind', 'booking', 'id', vb.booking_id, 'event_id', vb.event_id, 'event_name', e.name,
        'starts_at', vb.starts_at, 'ends_at', vb.ends_at) as item
    from public.venue_bookings vb left join public.events e on e.event_id = vb.event_id
    where vb.venue_id = p_venue_id and vb.status in ('held', 'confirmed') and vb.ends_at > instant
    union all
    select 'hold', vh.hold_id, vh.starts_at,
      jsonb_build_object('kind', 'hold', 'id', vh.hold_id, 'event_id', vh.event_id, 'event_name', e.name,
        'starts_at', vh.starts_at, 'ends_at', vh.ends_at)
    from public.venue_holds vh join public.events e on e.event_id = vh.event_id
    where vh.venue_id = p_venue_id and vh.status = 'tentative' and vh.expires_at > instant and vh.ends_at > instant
    union all
    select 'request', r.request_id, r.starts_at,
      jsonb_build_object('kind', 'request', 'id', r.request_id, 'event_id', r.event_id, 'event_name', e.name,
        'starts_at', r.starts_at, 'ends_at', r.ends_at)
    from public.venue_booking_requests r join public.events e on e.event_id = r.event_id
    where r.venue_id = p_venue_id and r.status = 'pending' and r.ends_at > instant
      and not exists(select 1 from public.venue_holds vh where vh.request_id = r.request_id and vh.status = 'tentative' and vh.expires_at > instant)
  ) b;
  if jsonb_array_length(blockers) > 0 then
    return jsonb_build_object('outcome', 'blocked', 'blockers', blockers);
  end if;
  update public.venues set deleted_at = instant, deleted_by = auth.uid() where venue_id = p_venue_id returning * into v;
  return jsonb_build_object('outcome', 'deleted', 'venue', jsonb_build_object('venue_id', v.venue_id, 'name', v.name,
    'deleted_at', v.deleted_at, 'deleted_by', v.deleted_by));
end;
$$;

commit;
