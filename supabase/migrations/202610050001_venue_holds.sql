-- SG2-84/85: tentative holds reserve a period, with atomic approval, release,
-- notifications and expiry history. All competing writes lock the venue row.
begin;

create table public.venue_holds (
  hold_id bigserial primary key,
  event_id integer not null references public.events(event_id) on delete cascade,
  venue_id integer not null references public.venues(venue_id),
  request_id bigint not null unique references public.venue_booking_requests(request_id),
  booking_id bigint references public.venue_bookings(booking_id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'tentative' check (status in ('tentative','converted','released','expired')),
  created_by uuid not null references public.users(user_id),
  created_at timestamptz not null default clock_timestamp(),
  warning_sent_at timestamptz,
  check (isfinite(starts_at) and isfinite(ends_at) and isfinite(expires_at)),
  check (ends_at > starts_at),
  check (expires_at > created_at),
  check ((status = 'converted') = (booking_id is not null))
);
create index venue_holds_active_idx on public.venue_holds(venue_id,starts_at,ends_at,expires_at) where status = 'tentative';
create table public.venue_hold_settings (
  singleton boolean primary key default true check (singleton),
  warning_lead_seconds integer not null default 86400 check (warning_lead_seconds between 1 and 2592000)
);
insert into public.venue_hold_settings(singleton) values(true);
create table public.venue_hold_notifications (
  notification_id bigserial primary key,
  recipient_id uuid not null references public.users(user_id),
  event_id integer not null references public.events(event_id) on delete cascade,
  hold_id bigint not null references public.venue_holds(hold_id) on delete cascade,
  kind text not null check (kind in ('placed','warning','expired')),
  message text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (hold_id,recipient_id,kind)
);
create index venue_hold_notifications_recipient_idx on public.venue_hold_notifications(recipient_id,created_at desc);
-- Automatic transitions have no human actor. Existing history readers accept
-- the absent joined actor and display System.
alter table public.event_audit_logs alter column actor_id drop not null;

alter table public.venue_holds enable row level security;
alter table public.venue_holds force row level security;
alter table public.venue_hold_notifications enable row level security;
alter table public.venue_hold_notifications force row level security;
alter table public.venue_hold_settings enable row level security;
alter table public.venue_hold_settings force row level security;
revoke all on public.venue_holds, public.venue_hold_notifications, public.venue_hold_settings from public,anon,authenticated;
revoke all on sequence public.venue_holds_hold_id_seq,public.venue_hold_notifications_notification_id_seq from public,anon,authenticated;
grant select on public.venue_holds,public.venue_hold_notifications to authenticated;
grant select,insert,update,delete on public.venue_holds,public.venue_hold_notifications,public.venue_hold_settings to service_role;
grant usage,select on sequence public.venue_holds_hold_id_seq,public.venue_hold_notifications_notification_id_seq to service_role;
-- Coordinators read detailed records only through the assigned-event list RPC.
-- Raw table reads must not provide a second, broader path to that metadata.
create policy venue_holds_read_internal on public.venue_holds for select to authenticated using (
  exists(select 1 from public.account_roles ar where ar.user_id = (select auth.uid())
    and ar.role in ('venue_staff','technical_support_staff'))
);
create policy venue_hold_notifications_recipient on public.venue_hold_notifications for select to authenticated using (recipient_id = (select auth.uid()));

-- Shared scheduling needs every live busy period, even for another coordinator.
-- This guarded projection exposes no hold/request/creator/deadline/history fields.
-- The SET ROLE setting preserves the caller's database role inside this definer;
-- current_user would instead identify the function owner.
create function public.venue_hold_occupancy()
returns table(venue_id integer,starts_at timestamptz,ends_at timestamptz,status text,event_id integer)
language plpgsql security definer set search_path = '' as $$
declare caller_role text; trusted_service boolean := coalesce(current_setting('role',true) = 'service_role',false);
begin
  select ar.role into caller_role from public.account_roles ar where ar.user_id = auth.uid();
  if not trusted_service and (caller_role is null or caller_role not in ('venue_staff','event_coordinator','technical_support_staff')) then return; end if;
  return query
    select h.venue_id,h.starts_at,h.ends_at,'tentative'::text,
      case when trusted_service or caller_role <> 'event_coordinator' or e.coordinator_id = auth.uid() then h.event_id else null::integer end
    from public.venue_holds h join public.events e on e.event_id = h.event_id
    where h.status = 'tentative' and h.expires_at > clock_timestamp();
end;
$$;
revoke all on function public.venue_hold_occupancy() from public,anon,authenticated;
grant execute on function public.venue_hold_occupancy() to authenticated,service_role;

-- Reads release a period at the exact deadline, even between timer runs.
-- Legacy booking RLS remains intact; live holds use the limited projection.
create view public.venue_booking_occupancy with (security_invoker = true) as
select b.venue_id,b.starts_at,b.ends_at,b.status,b.event_id from public.venue_bookings b
union all
select h.venue_id,h.starts_at,h.ends_at,h.status,h.event_id from public.venue_hold_occupancy() h;
revoke all on public.venue_booking_occupancy from public,anon,authenticated;
grant select on public.venue_booking_occupancy to authenticated,service_role;

create function public.venue_hold_json(h public.venue_holds) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('hold_id',h.hold_id,'event_id',h.event_id,'event_name',e.name,
    'venue_id',h.venue_id,'venue_name',v.name,'request_id',h.request_id,'booking_id',h.booking_id,
    'starts_at',h.starts_at,'ends_at',h.ends_at,'expires_at',h.expires_at,'status',h.status,'created_at',h.created_at)
  from public.events e join public.venues v on v.venue_id = h.venue_id where e.event_id = h.event_id;
$$;

create function public.venue_hold_notice(h public.venue_holds,p_kind text) returns void
language sql security definer set search_path = '' as $$
  insert into public.venue_hold_notifications(recipient_id,event_id,hold_id,kind,message)
  select e.coordinator_id,h.event_id,h.hold_id,p_kind,
    case p_kind when 'placed' then 'Tentative hold placed on ' when 'warning' then 'Tentative hold expires soon on ' else 'Tentative hold expired on ' end
      || v.name || '; expiry ' || to_char(h.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') || '.'
  from public.events e join public.venues v on v.venue_id = h.venue_id
  where e.event_id = h.event_id and e.coordinator_id is not null
  on conflict(hold_id,recipient_id,kind) do nothing;
$$;

create function public.expire_venue_hold(h public.venue_holds) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.venue_holds set status = 'expired' where hold_id = h.hold_id;
  update public.venue_booking_requests set status = 'cancelled' where request_id = h.request_id and status = 'pending';
  insert into public.event_audit_logs(event_id,actor_id,field_name,old_value,new_value)
    values(h.event_id,null,'venue_hold_status','Tentative hold ' || h.hold_id,'Expired hold ' || h.hold_id);
  perform public.venue_hold_notice(h,'expired');
end;
$$;

-- Only scheduled/service executions and the controlled RPCs can run this.
-- Venue-before-hold ordering matches approval and placement, avoiding races.
create function public.process_venue_hold_deadlines() returns integer
language plpgsql security definer set search_path = '' as $$
declare h public.venue_holds; candidate record; lead_seconds integer; changed integer := 0; instant timestamptz;
begin
  select warning_lead_seconds into lead_seconds from public.venue_hold_settings where singleton;
  for candidate in select hold_id,venue_id from public.venue_holds where status = 'tentative'
    and (expires_at <= clock_timestamp() or (warning_sent_at is null and expires_at <= clock_timestamp() + make_interval(secs => lead_seconds)))
    order by venue_id,hold_id
  loop
    -- A batch keeps earlier locks until commit. Skip venues being changed by
    -- another transaction so cross-venue/event work cannot deadlock the sweep.
    perform 1 from public.venues where venue_id = candidate.venue_id for update skip locked;
    if not found then continue; end if;
    select * into h from public.venue_holds where hold_id = candidate.hold_id for update;
    instant := clock_timestamp();
    if h.status <> 'tentative' then continue; end if;
    if h.expires_at <= instant then
      perform public.expire_venue_hold(h); changed := changed + 1;
    elsif h.warning_sent_at is null and h.expires_at <= instant + make_interval(secs => lead_seconds) then
      update public.venue_holds set warning_sent_at = instant where hold_id = h.hold_id;
      perform public.venue_hold_notice(h,'warning');
    end if;
  end loop;
  return changed;
end;
$$;

create function public.create_venue_hold(p_event_id integer,p_venue_id integer,p_starts_at timestamptz,p_ends_at timestamptz,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.events; h public.venue_holds; r bigint; instant timestamptz; lead_seconds integer;
begin
  if not exists(select 1 from public.account_roles where user_id = auth.uid() and role = 'venue_staff') then
    raise exception using errcode = '42501',message = 'Access denied';
  end if;
  perform 1 from public.venues where venue_id = p_venue_id for update;
  if not found then return jsonb_build_object('outcome','missing'); end if;
  select * into e from public.events where event_id = p_event_id for update;
  if not found then return jsonb_build_object('outcome','missing'); end if;
  instant := clock_timestamp();
  if p_starts_at is null or p_ends_at is null or p_expires_at is null or not isfinite(p_starts_at) or not isfinite(p_ends_at) or not isfinite(p_expires_at) or p_ends_at <= p_starts_at or p_ends_at <= instant or p_expires_at <= instant
    or e.status not in ('approved','planning') or e.coordinator_id is null then return jsonb_build_object('outcome','invalid'); end if;
  if exists(select 1 from public.venue_bookings where venue_id = p_venue_id and status = 'confirmed' and starts_at < p_ends_at and ends_at > p_starts_at)
    or exists(select 1 from public.venue_holds where venue_id = p_venue_id and status = 'tentative' and expires_at > instant and starts_at < p_ends_at and ends_at > p_starts_at)
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

create function public.change_venue_hold(p_hold_id bigint,p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h public.venue_holds; venue integer; v public.venues; e public.events; booking bigint; instant timestamptz;
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
    if e.status not in ('approved','planning') or h.ends_at <= clock_timestamp() then return jsonb_build_object('outcome','invalid'); end if;
    if exists(select 1 from public.venue_bookings where venue_id = venue and status = 'confirmed' and starts_at < h.ends_at and ends_at > h.starts_at)
      or exists(select 1 from public.venue_unavailability where venue_id = venue and starts_at < h.ends_at and ends_at > h.starts_at)
      or exists(select 1 from public.venue_holds where venue_id = venue and hold_id <> h.hold_id and status = 'tentative' and expires_at > instant and starts_at < h.ends_at and ends_at > h.starts_at)
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
    update public.venue_booking_requests set status = 'approved' where request_id = h.request_id;
    update public.events set venue_booking_id = booking where event_id = h.event_id;
  else
    update public.venue_holds set status = 'released' where hold_id = h.hold_id returning * into h;
    update public.venue_booking_requests set status = 'cancelled' where request_id = h.request_id;
  end if;
  insert into public.event_audit_logs(event_id,actor_id,field_name,old_value,new_value)
    values(h.event_id,auth.uid(),'venue_hold_status','Tentative hold ' || h.hold_id,initcap(h.status) || ' hold ' || h.hold_id);
  return jsonb_build_object('outcome','updated','hold',public.venue_hold_json(h));
end;
$$;

create function public.list_venue_holds() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare caller_role text;
begin
  select role into caller_role from public.account_roles where user_id = auth.uid();
  if caller_role is null or caller_role not in ('venue_staff','event_coordinator','technical_support_staff') then raise exception using errcode = '42501',message = 'Access denied'; end if;
  perform public.process_venue_hold_deadlines();
  return coalesce((select jsonb_agg(public.venue_hold_json(h) order by h.created_at desc,h.hold_id desc)
    from public.venue_holds h join public.events e on e.event_id = h.event_id
    where caller_role <> 'event_coordinator' or e.coordinator_id = auth.uid()),'[]'::jsonb);
end;
$$;
create function public.venue_hold_options() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.account_roles where user_id = auth.uid() and role = 'venue_staff') then raise exception using errcode = '42501',message = 'Access denied'; end if;
  return jsonb_build_object('events',coalesce((select jsonb_agg(jsonb_build_object('event_id',event_id,'name',name) order by name,event_id)
    from public.events where status in ('approved','planning') and coordinator_id is not null),'[]'::jsonb),
    'venues',coalesce((select jsonb_agg(jsonb_build_object('venue_id',venue_id,'name',name) order by name,venue_id) from public.venues),'[]'::jsonb));
end;
$$;
create function public.list_venue_hold_notifications() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.account_roles where user_id = auth.uid() and role in ('venue_staff','event_coordinator','technical_support_staff')) then raise exception using errcode = '42501',message = 'Access denied'; end if;
  perform public.process_venue_hold_deadlines();
  return coalesce((select jsonb_agg(jsonb_build_object('notification_id',n.notification_id,'event_id',n.event_id,'hold_id',n.hold_id,'kind',n.kind,'message',n.message,'created_at',n.created_at) order by n.created_at desc,n.notification_id desc)
    from public.venue_hold_notifications n where n.recipient_id = auth.uid()),'[]'::jsonb);
end;
$$;

-- Serializes direct/service booking and block writes with the hold RPCs.
create function public.venue_booking_refuse_overlap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Let existing NOT NULL/status/time constraints report invalid row values.
  if new.starts_at is null or new.ends_at is null or new.ends_at <= new.starts_at or new.status not in ('held','confirmed') then return new; end if;
  perform 1 from public.venues where venue_id = new.venue_id for update;
  if exists(select 1 from public.venue_holds h where h.venue_id = new.venue_id and h.status = 'tentative' and h.expires_at > clock_timestamp() and h.starts_at < new.ends_at and h.ends_at > new.starts_at)
    then raise exception using errcode = '23P01',message = 'The period overlaps an active tentative hold.'; end if;
  return new;
end;
$$;
create trigger venue_booking_refuse_overlap before insert or update of venue_id,starts_at,ends_at,status on public.venue_bookings for each row execute function public.venue_booking_refuse_overlap();
create or replace function public.venue_unavailability_refuse_confirmed_overlap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.venues where venue_id = new.venue_id for update;
  if exists(select 1 from public.venue_bookings b where b.venue_id = new.venue_id and b.status = 'confirmed' and b.starts_at < new.ends_at and b.ends_at > new.starts_at)
    then raise exception using errcode = '23P01',message = 'The period overlaps a confirmed booking for this venue.'; end if;
  return new;
end;
$$;

revoke all on function public.venue_hold_json(public.venue_holds),public.venue_hold_notice(public.venue_holds,text),public.expire_venue_hold(public.venue_holds),public.process_venue_hold_deadlines(),public.venue_booking_refuse_overlap(),
  public.create_venue_hold(integer,integer,timestamptz,timestamptz,timestamptz),public.change_venue_hold(bigint,text),public.list_venue_holds(),public.venue_hold_options(),public.list_venue_hold_notifications() from public,anon,authenticated;
grant execute on function public.create_venue_hold(integer,integer,timestamptz,timestamptz,timestamptz),public.change_venue_hold(bigint,text),public.list_venue_holds(),public.venue_hold_options(),public.list_venue_hold_notifications() to authenticated;
grant execute on function public.process_venue_hold_deadlines() to service_role;

-- Supabase supports pg_cron. Plain CI PostgreSQL intentionally lacks it and
-- runs the same deadline function deterministically in its database suite.
do $$
begin
  if exists(select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    perform cron.schedule('venue-hold-deadlines','* * * * *','select public.process_venue_hold_deadlines();');
  else
    raise notice 'pg_cron is unavailable: enable a scheduler running public.process_venue_hold_deadlines() every minute before deployment.';
  end if;
end;
$$;
commit;
