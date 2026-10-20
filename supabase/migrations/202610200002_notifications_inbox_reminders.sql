-- SG2-69: one recipient-owned inbox and Free pg_cron arrangement reminders.
-- Historical event/hold notices start unread. Read receipts never modify their
-- recipient, event, message or creation time. Existing delivery jobs are retained.
begin;

alter table public.notifications add column read_at timestamptz;
alter table public.venue_hold_notifications add column read_at timestamptz;
create index notifications_unread_recipient_idx on public.notifications(recipient_id) where read_at is null;
create index venue_hold_notifications_unread_recipient_idx on public.venue_hold_notifications(recipient_id) where read_at is null;
create index notifications_inbox_order_idx on public.notifications(recipient_id,created_at desc,notification_id desc);
create index venue_hold_notifications_inbox_order_idx on public.venue_hold_notifications(recipient_id,created_at desc,notification_id desc);
alter table public.notifications drop constraint notifications_kind_check,
  add constraint notifications_kind_check check (kind in
    ('venue_request_approved','venue_request_rejected','venue_booking_released','equipment_reserved',
     'venue_booking_clash','event_confirmed','event_submitted','coordinator_assigned','clarification_requested',
     'event_approved','event_rejected','venue_unavailable','event_returned_to_planning','safety_decision','outstanding_arrangements'));

create table public.notification_reminder_settings (
  user_id uuid primary key references public.users(user_id) on delete cascade,
  frequency_days integer not null default 1 check(frequency_days between 1 and 30)
);
create table public.notification_reminder_receipts (
  event_id integer not null references public.events(event_id) on delete cascade,
  recipient_id uuid not null references public.users(user_id) on delete cascade,
  last_sent_at timestamptz not null,
  primary key(event_id,recipient_id)
);
alter table public.notification_reminder_settings enable row level security;
alter table public.notification_reminder_settings force row level security;
alter table public.notification_reminder_receipts enable row level security;
alter table public.notification_reminder_receipts force row level security;
revoke all on public.notification_reminder_settings,public.notification_reminder_receipts from public,anon,authenticated,service_role;
-- Service-only scheduler and controlled fixture/administrative inspection.
grant select,insert,update,delete on public.notification_reminder_settings,public.notification_reminder_receipts to service_role;

create function public.notification_inbox_caller() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare caller uuid := auth.uid();
begin
  if caller is null or not exists(select 1 from public.account_roles where user_id=caller) then
    raise exception using errcode='42501',message='Access denied';
  end if;
  return caller;
end $$;
create function public.notification_unread_count(p_caller uuid) returns bigint
language sql stable security definer set search_path='' as $$
  select (select count(*) from public.notifications where recipient_id=p_caller and read_at is null)
    + (select count(*) from public.venue_hold_notifications where recipient_id=p_caller and read_at is null)
$$;
create function public.notification_inbox(
  p_limit integer default 50,p_before_created_at timestamptz default null,
  p_before_source text default null,p_before_id bigint default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare caller uuid := public.notification_inbox_caller(); entries jsonb; cursor jsonb; count_all bigint;
begin
  if p_limit is null or p_limit not between 1 and 100
    or num_nonnulls(p_before_created_at,p_before_source,p_before_id) not in (0,3)
    or (p_before_created_at is not null and (not isfinite(p_before_created_at)
      or p_before_source not in ('event','hold') or p_before_id not between 1 and 9007199254740991)) then
    raise exception using errcode='22023',message='Invalid inbox cursor or limit';
  end if;
  -- One statement snapshot keeps page, continuation and total consistent. The
  -- total includes every recipient-owned row, including those outside this page.
  with all_entries as (
    select 'event'::text source,notification_id,event_id,kind,message,created_at,read_at
      from public.notifications where recipient_id=caller
    union all
    select 'hold',notification_id,event_id,kind,message,created_at,read_at
      from public.venue_hold_notifications where recipient_id=caller
  ), page as materialized (
    select * from all_entries where p_before_created_at is null
      or (created_at,source,notification_id)<(p_before_created_at,p_before_source,p_before_id)
    order by created_at desc,source desc,notification_id desc limit p_limit+1
  ), visible as materialized (
    select * from page order by created_at desc,source desc,notification_id desc limit p_limit
  )
  select coalesce((select jsonb_agg(to_jsonb(v) order by created_at desc,source desc,notification_id desc) from visible v),'[]'::jsonb),
    case when (select count(*) from page)>p_limit then
      (select jsonb_build_object('created_at',created_at,'source',source,'notification_id',notification_id)
        from visible order by created_at,source,notification_id limit 1) else null end,
    (select count(*) from all_entries where read_at is null)
    into entries,cursor,count_all;
  return jsonb_build_object('notifications',entries,'unread_count',count_all,'next_cursor',cursor);
end $$;

create function public.read_notification(p_source text,p_notification_id bigint) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare caller uuid:=public.notification_inbox_caller(); entry jsonb;
begin
  if p_source is null or p_source not in ('event','hold') or p_notification_id is null
      or p_notification_id not between 1 and 9007199254740991 then
    raise exception using errcode='22023',message='Invalid notification identity';
  end if;
  if p_source='event' then
    update public.notifications n set read_at=coalesce(n.read_at,clock_timestamp())
      where n.notification_id=p_notification_id and n.recipient_id=caller
      returning jsonb_build_object('source','event','notification_id',n.notification_id,'event_id',n.event_id,
        'kind',n.kind,'message',n.message,'created_at',n.created_at,'read_at',n.read_at) into entry;
  else
    update public.venue_hold_notifications n set read_at=coalesce(n.read_at,clock_timestamp())
      where n.notification_id=p_notification_id and n.recipient_id=caller
      returning jsonb_build_object('source','hold','notification_id',n.notification_id,'event_id',n.event_id,
        'kind',n.kind,'message',n.message,'created_at',n.created_at,'read_at',n.read_at) into entry;
  end if;
  if entry is null then return null; end if;
  return jsonb_build_object('notification',entry,'unread_count',public.notification_unread_count(caller));
end $$;
create function public.read_all_notifications() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare caller uuid:=public.notification_inbox_caller(); instant timestamptz:=clock_timestamp();
begin
  -- Both updates use the same snapshot of identities. A new arrival after the
  -- snapshot remains unread rather than being accidentally cleared by the second
  -- table update. Recipient-level advisory locks are unnecessary for idempotent reads.
  with mine as materialized (
    select 'event'::text source,notification_id from public.notifications where recipient_id=caller and read_at is null
    union all select 'hold',notification_id from public.venue_hold_notifications where recipient_id=caller and read_at is null
  ), event_reads as (
    update public.notifications n set read_at=instant from mine m
    where m.source='event' and n.notification_id=m.notification_id and n.recipient_id=caller and n.read_at is null returning n.notification_id
  )
  update public.venue_hold_notifications n set read_at=instant from mine m
    where m.source='hold' and n.notification_id=m.notification_id and n.recipient_id=caller and n.read_at is null;
  return jsonb_build_object('unread_count',public.notification_unread_count(caller));
end $$;
create function public.notification_event(p_source text,p_notification_id bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=public.notification_inbox_caller(); target integer; e public.events; caller_role text;
begin
  if p_source is null or p_source not in ('event','hold') or p_notification_id is null
      or p_notification_id not between 1 and 9007199254740991 then
    raise exception using errcode='22023',message='Invalid notification identity';
  end if;
  if p_source='event' then
    select event_id into target from public.notifications where notification_id=p_notification_id and recipient_id=caller;
  else
    select event_id into target from public.venue_hold_notifications where notification_id=p_notification_id and recipient_id=caller;
  end if;
  if target is null then return null; end if;
  select * into e from public.events where event_id=target;
  if not found then return null; end if;
  select role into caller_role from public.account_roles where user_id=caller;
  if caller_role='event_coordinator' and e.coordinator_id is distinct from caller then return null; end if;
  if caller_role='event_organiser' and (e.organiser_id is distinct from caller or not exists(
      select 1 from public.users u where u.user_id=caller and u.organisation=e.organisation
        and btrim(u.organisation,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')<>'')) then
    return null;
  end if;
  if caller_role='attendee' and not exists(select 1 from public.registrations r where r.event_id=target and r.attendee_id=caller) then return null; end if;
  return jsonb_build_object('event_id',e.event_id,'name',coalesce(nullif(e.name,''),'Untitled event'),
    'status',e.status::text,'proposed_date',e.proposed_date);
end $$;
create function public.notification_reminder_preferences() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=public.notification_inbox_caller(); days integer;
begin
  if not exists(select 1 from public.account_roles where user_id=caller and role='event_coordinator') then
    raise exception using errcode='42501',message='Access denied';
  end if;
  select frequency_days into days from public.notification_reminder_settings where user_id=caller;
  return jsonb_build_object('frequency_days',coalesce(days,1));
end $$;
create function public.set_notification_reminder_preferences(p_frequency_days integer) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare caller uuid:=public.notification_inbox_caller(); caller_role text;
begin
  select role into caller_role from public.account_roles where user_id=caller for share;
  if caller_role is distinct from 'event_coordinator' then raise exception using errcode='42501',message='Access denied'; end if;
  if p_frequency_days is null or p_frequency_days not between 1 and 30 then
    raise exception using errcode='22023',message='Frequency must be 1 to 30 whole days';
  end if;
  insert into public.notification_reminder_settings(user_id,frequency_days) values(caller,p_frequency_days)
    on conflict(user_id) do update set frequency_days=excluded.frequency_days;
  return jsonb_build_object('frequency_days',p_frequency_days);
end $$;

-- Private readiness projection mirrors confirm_event/SG2-57. Its caller must
-- hold the event row lock before reading child arrangements. Keeping a single
-- projection here also makes reminder wording and cadence tests deterministic.
create function public.notification_outstanding_arrangements(p_event public.events) returns text[]
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
    then outstanding:=outstanding||'equipment'::text; end if;
  if (p_event.arrangements_recheck_needed is true and coalesce(p_event.outstanding_arrangements,'[]'::jsonb) @> '["registration_recheck"]'::jsonb)
    or (p_event.registration_needed is true and (p_event.registration_capacity is null or p_event.registration_opens_at is null or p_event.registration_closes_at is null))
    then outstanding:=outstanding||'registration'::text; end if;
  return outstanding;
end $$;
create function public.send_outstanding_arrangement_reminders() returns integer
language plpgsql volatile security definer set search_path='' as $$
declare e public.events; caller_role text; outstanding text[]; days integer; last_sent timestamptz; instant timestamptz; sent integer:=0; labels text;
begin
  -- At most one sweep owns the receipts. A concurrent cron/manual sweep exits
  -- promptly; aborted transactions roll back notices and receipts together.
  if not pg_try_advisory_xact_lock(2069,69) then return 0; end if;
  for e in select * from public.events where coordinator_id is not null and proposed_date>clock_timestamp()
      and status not in ('cancelled','completed','rejected') order by event_id for update loop
    -- A reassignment/cancellation which committed while the row lock was being
    -- acquired is rechecked by READ COMMITTED's locking SELECT.
    select role into caller_role from public.account_roles where user_id=e.coordinator_id for share;
    if caller_role is distinct from 'event_coordinator' then continue; end if;
    if e.proposed_date<=clock_timestamp() then continue; end if;
    outstanding:=public.notification_outstanding_arrangements(e);
    if cardinality(outstanding)=0 then continue; end if;
    select frequency_days into days from public.notification_reminder_settings where user_id=e.coordinator_id;
    days:=coalesce(days,1);
    select last_sent_at into last_sent from public.notification_reminder_receipts where event_id=e.event_id and recipient_id=e.coordinator_id;
    instant:=clock_timestamp();
    if last_sent is not null and instant<last_sent+make_interval(days=>days) then continue; end if;
    select string_agg(case key when 'venue' then 'Venue booking' when 'equipment' then 'Equipment' else 'Registration' end,', ' order by position)
      into labels from unnest(outstanding) with ordinality keys(key,position);
    insert into public.notifications(recipient_id,event_id,kind,message) values(e.coordinator_id,e.event_id,'outstanding_arrangements',
      left('Upcoming event '||left(coalesce(nullif(e.name,''),'Untitled event'),500)||' still needs: '||labels||'.',2000));
    insert into public.notification_reminder_receipts(event_id,recipient_id,last_sent_at) values(e.event_id,e.coordinator_id,instant)
      on conflict(event_id,recipient_id) do update set last_sent_at=excluded.last_sent_at;
    sent:=sent+1;
  end loop;
  return sent;
end $$;

revoke all on function public.notification_inbox_caller(),public.notification_unread_count(uuid),
  public.notification_outstanding_arrangements(public.events) from public,anon,authenticated,service_role;
revoke all on function public.notification_inbox(integer,timestamptz,text,bigint),public.read_notification(text,bigint),
  public.read_all_notifications(),public.notification_event(text,bigint),public.notification_reminder_preferences(),
  public.set_notification_reminder_preferences(integer),public.send_outstanding_arrangement_reminders() from public,anon,authenticated,service_role;
grant execute on function public.notification_inbox(integer,timestamptz,text,bigint),public.read_notification(text,bigint),
  public.read_all_notifications(),public.notification_event(text,bigint),public.notification_reminder_preferences(),
  public.set_notification_reminder_preferences(integer) to authenticated;
grant execute on function public.send_outstanding_arrangement_reminders() to service_role;

-- Supabase Free supports pg_cron. Plain PostgreSQL test images lack it: native
-- tests exercise the scheduler directly, and deployment must check the named job.
do $$ begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    perform cron.schedule('sg2-69-arrangement-reminders','0 * * * *','select public.send_outstanding_arrangement_reminders();');
  else
    raise notice 'pg_cron unavailable: install hourly sg2-69-arrangement-reminders scheduler before deployment.';
  end if;
end $$;
notify pgrst,'reload schema';
commit;
