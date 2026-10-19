-- SG2-106: Venue Staff can delete an unused venue and change an active hold's
-- expiry. Deleting keeps the venue row, so past bookings, requests and history
-- still show its name; a deleted venue is left out of every place a new
-- booking, request or hold can start from.
begin;

alter table public.venues
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.users(user_id);
alter table public.venues add constraint venues_deleted_pair check ((deleted_at is null) = (deleted_by is null));
create index venues_active_name_idx on public.venues(name, venue_id) where deleted_at is null;

-- Deletion is only through delete_venue(), and a deleted venue is read-only.
create function public.venues_guard_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.deleted_at is not null then
    raise exception using errcode = '23514', message = 'This venue has been deleted.';
  end if;
  if (new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by)
    and coalesce(current_setting('app.venue_delete', true), '') <> 'on' then
    raise exception using errcode = '42501', message = 'Delete venues through the venue delete action.';
  end if;
  return new;
end;
$$;
create trigger venues_guard_deleted before update on public.venues
  for each row execute function public.venues_guard_deleted();

-- New requests, bookings, holds and blocks lock the venue row (the same lock
-- every hold and booking write already takes), so they wait for a delete in
-- progress and then see it. A delete waits for them in turn and counts them.
create function public.venue_refuse_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
declare removed timestamptz;
begin
  select deleted_at into removed from public.venues where venue_id = new.venue_id for update;
  if removed is not null then
    raise exception using errcode = '23514', message = 'This venue has been deleted.';
  end if;
  return new;
end;
$$;
create trigger venue_booking_requests_refuse_deleted before insert or update of venue_id on public.venue_booking_requests
  for each row execute function public.venue_refuse_deleted();
create trigger venue_bookings_refuse_deleted before insert or update of venue_id on public.venue_bookings
  for each row execute function public.venue_refuse_deleted();
create trigger venue_holds_refuse_deleted before insert or update of venue_id on public.venue_holds
  for each row execute function public.venue_refuse_deleted();
create trigger venue_unavailability_refuse_deleted before insert or update of venue_id on public.venue_unavailability
  for each row execute function public.venue_refuse_deleted();

create function public.delete_venue(p_venue_id integer) returns jsonb
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
    where vh.venue_id = p_venue_id and vh.status = 'tentative' and vh.expires_at > instant
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
  perform set_config('app.venue_delete', 'on', true);
  update public.venues set deleted_at = instant, deleted_by = auth.uid() where venue_id = p_venue_id returning * into v;
  perform set_config('app.venue_delete', '', true);
  return jsonb_build_object('outcome', 'deleted', 'venue', jsonb_build_object('venue_id', v.venue_id, 'name', v.name,
    'deleted_at', v.deleted_at, 'deleted_by', v.deleted_by));
end;
$$;

-- Each expiry change starts a new notice round: the coordinator hears about
-- the new deadline, and the SG2-85 warning can fire again for it.
alter table public.venue_holds add column expiry_revision integer not null default 0;
alter table public.venue_hold_notifications add column expiry_revision integer not null default 0;
alter table public.venue_hold_notifications drop constraint venue_hold_notifications_hold_id_recipient_id_kind_key;
alter table public.venue_hold_notifications add constraint venue_hold_notifications_round_key unique (hold_id, recipient_id, kind, expiry_revision);
alter table public.venue_hold_notifications drop constraint venue_hold_notifications_kind_check;
alter table public.venue_hold_notifications add constraint venue_hold_notifications_kind_check
  check (kind in ('placed', 'warning', 'expired', 'expiry_changed'));

create or replace function public.venue_hold_notice(h public.venue_holds,p_kind text) returns void
language sql security definer set search_path = '' as $$
  insert into public.venue_hold_notifications(recipient_id,event_id,hold_id,kind,message,expiry_revision)
  select e.coordinator_id,h.event_id,h.hold_id,p_kind,
    case p_kind when 'placed' then 'Tentative hold placed on ' when 'warning' then 'Tentative hold expires soon on '
      when 'expiry_changed' then 'Tentative hold expiry changed on ' else 'Tentative hold expired on ' end
      || v.name || '; expiry ' || to_char(h.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') || '.',
    h.expiry_revision
  from public.events e join public.venues v on v.venue_id = h.venue_id
  where e.event_id = h.event_id and e.coordinator_id is not null
  on conflict(hold_id,recipient_id,kind,expiry_revision) do nothing;
$$;

create function public.change_venue_hold_expiry(p_hold_id bigint,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h public.venue_holds; venue integer; instant timestamptz; lead_seconds integer; previous timestamptz;
begin
  if not exists(select 1 from public.account_roles where user_id = auth.uid() and role = 'venue_staff') then
    raise exception using errcode = '42501',message = 'Access denied';
  end if;
  select venue_id into venue from public.venue_holds where hold_id = p_hold_id;
  if not found then return jsonb_build_object('outcome','missing'); end if;
  -- Same venue-then-hold order as approval, release and the deadline sweep.
  perform 1 from public.venues where venue_id = venue for update;
  select * into h from public.venue_holds where hold_id = p_hold_id for update;
  instant := clock_timestamp();
  if h.status <> 'tentative' then return jsonb_build_object('outcome','inactive'); end if;
  if h.expires_at <= instant then perform public.expire_venue_hold(h); return jsonb_build_object('outcome','inactive'); end if;
  if p_expires_at is null or not isfinite(p_expires_at) or p_expires_at <= instant or p_expires_at = h.expires_at then
    return jsonb_build_object('outcome','invalid');
  end if;
  previous := h.expires_at;
  update public.venue_holds set expires_at = p_expires_at, warning_sent_at = null, expiry_revision = expiry_revision + 1
    where hold_id = h.hold_id returning * into h;
  insert into public.event_audit_logs(event_id,actor_id,field_name,old_value,new_value)
    values(h.event_id,auth.uid(),'venue_hold_expiry',
      'Hold ' || h.hold_id || ' expires ' || to_char(previous at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'Hold ' || h.hold_id || ' expires ' || to_char(h.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  perform public.venue_hold_notice(h,'expiry_changed');
  select warning_lead_seconds into lead_seconds from public.venue_hold_settings where singleton;
  if h.expires_at <= instant + make_interval(secs => lead_seconds) then
    update public.venue_holds set warning_sent_at = instant where hold_id = h.hold_id returning * into h;
    perform public.venue_hold_notice(h,'warning');
  end if;
  return jsonb_build_object('outcome','updated','hold',public.venue_hold_json(h));
end;
$$;

-- Deleted venues are not offered for new holds and cannot take one.
create or replace function public.venue_hold_options() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.account_roles where user_id = auth.uid() and role = 'venue_staff') then raise exception using errcode = '42501',message = 'Access denied'; end if;
  return jsonb_build_object('events',coalesce((select jsonb_agg(jsonb_build_object('event_id',event_id,'name',name) order by name,event_id)
    from public.events where status in ('approved','planning') and coordinator_id is not null),'[]'::jsonb),
    'venues',coalesce((select jsonb_agg(jsonb_build_object('venue_id',venue_id,'name',name) order by name,venue_id) from public.venues where deleted_at is null),'[]'::jsonb));
end;
$$;

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
    or e.status not in ('approved','planning') or e.coordinator_id is null then return jsonb_build_object('outcome','invalid'); end if;
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

revoke all on function public.venues_guard_deleted(),public.venue_refuse_deleted(),public.delete_venue(integer),
  public.change_venue_hold_expiry(bigint,timestamptz),public.venue_hold_notice(public.venue_holds,text) from public,anon,authenticated;
grant execute on function public.delete_venue(integer),public.change_venue_hold_expiry(bigint,timestamptz) to authenticated;

commit;
