-- SG2-64: the event organiser asks for a change after submitting.
--
-- AC1: a change request names one changeable field (what), its new value (to
-- what) and a reason (why). The current value is captured when the request is
-- raised, so the coordinator sees "from" as it was when the organiser asked.
-- AC4: requests cannot be raised on a draft, cancelled, rejected or completed
-- event. raise_event_change_request locks the event row, so a request can
-- never be raised against an event that is being cancelled or completed at
-- the same moment: the status it checks is the status the insert commits
-- against.
--
-- AC2: the assigned coordinator is notified in the same transaction, through
-- the bell (SG2-49/SG2-68). An event with no coordinator yet keeps the request
-- until one is assigned, and that coordinator sees it on the event page.
--
-- Status stays `pending` until SG2-65 decides it. SG2-66's accept route
-- already marks it `accepted`; `refused` is SG2-65's.
--
-- The table is service-role only, like SG2-66's change-impact facts: the API
-- decides who sees a request (the owning organiser and the assigned
-- coordinator, AC3) and everyone else gets 404, so no client role reads or
-- writes it directly.
begin;

create table public.event_change_requests (
  change_request_id bigserial primary key,
  event_id          integer not null references public.events(event_id) on delete cascade,
  requested_by      uuid not null references public.users(user_id),
  field             text not null,
  from_value        jsonb,
  to_value          jsonb not null,
  reason            text not null,
  status            text not null default 'pending',
  created_at        timestamptz not null default now(),
  -- Mirrors CHANGEABLE_FIELDS in server/src/events/changeImpact.ts and the
  -- whitelist in apply_accepted_event_change.
  constraint event_change_requests_field_known check (field in (
    'proposed_date', 'expected_attendance', 'venue_requirements', 'accessibility_needs',
    'equipment_requirements', 'name', 'purpose', 'description')),
  constraint event_change_requests_reason_present check (
    btrim(reason) <> '' and char_length(reason) <= 1000),
  constraint event_change_requests_status_known check (status in ('pending', 'accepted', 'refused'))
);

-- The event page lists an event's requests oldest first.
create index event_change_requests_event_created_idx
  on public.event_change_requests (event_id, created_at);

alter table public.event_change_requests enable row level security;
alter table public.event_change_requests force row level security;

revoke all on table public.event_change_requests from public, anon, authenticated;
revoke all on sequence public.event_change_requests_change_request_id_seq from public, anon, authenticated;

grant select, insert, update on table public.event_change_requests to service_role;
grant usage, select on sequence public.event_change_requests_change_request_id_seq to service_role;

-- No policies for authenticated or anon: with RLS forced and no grants they
-- read and write nothing. The service role bypasses RLS.

-- Adds the new kind to whatever list is already allowed, as SG2-63 and SG2-67
-- did, so no earlier or concurrently added kind is lost.
do $$
declare
  kinds text[];
begin
  select array(select (regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g'))[1])
    into kinds from pg_constraint c
    where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_kind_check';
  kinds := kinds || array(select kind from unnest(array['change_requested']) kind
    where not kind = any(kinds));
  alter table public.notifications drop constraint notifications_kind_check;
  execute format('alter table public.notifications add constraint notifications_kind_check check (kind in (%s))',
    (select string_agg(quote_literal(kind), ', ' order by position) from unnest(kinds) with ordinality as k(kind, position)));
end;
$$;

-- Raises a change request for the organiser who owns the event. Outcomes:
--   ok        — stored and the coordinator notified; returns the request
--   not_found — no such event in the caller's organisation owned by them
--   closed    — the event is a draft, cancelled, rejected or completed (AC4)
--   unchanged — the new value equals the current one
create function public.raise_event_change_request(
  p_event_id integer,
  p_actor_id uuid,
  p_field text,
  p_to_value jsonb,
  p_reason text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  membership text;
  previous public.events%rowtype;
  current_value jsonb;
  unchanged boolean;
  saved public.event_change_requests%rowtype;
begin
  -- SG2-104: the actor may hold several roles; one must be event_organiser
  -- (the server has already checked it is the acting role).
  perform 1 from public.account_roles ar
    where ar.user_id = p_actor_id and ar.role = 'event_organiser' for share;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  select u.organisation into membership from public.users u
    where u.user_id = p_actor_id for share;
  if membership is null or btrim(membership) = '' then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  -- The event lock serializes this with cancel, complete and status changes.
  select e.* into previous from public.events e
    where e.event_id = p_event_id and e.organiser_id = p_actor_id
      and e.organisation = membership for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if previous.status in ('draft', 'cancelled', 'rejected', 'completed') then
    return jsonb_build_object('outcome', 'closed', 'status', previous.status);
  end if;

  current_value := nullif(to_jsonb(previous) -> p_field, 'null'::jsonb);
  -- A date is the same instant however it is written.
  if p_field = 'proposed_date' then
    unchanged := previous.proposed_date is not distinct from (p_to_value #>> '{}')::timestamptz;
  else
    unchanged := current_value is not distinct from p_to_value;
  end if;
  if unchanged then return jsonb_build_object('outcome', 'unchanged'); end if;

  insert into public.event_change_requests (event_id, requested_by, field, from_value, to_value, reason)
    values (p_event_id, p_actor_id, p_field, current_value, p_to_value, btrim(p_reason))
    returning * into saved;

  if previous.coordinator_id is not null then
    insert into public.notifications (recipient_id, event_id, kind, message)
      values (previous.coordinator_id, p_event_id, 'change_requested',
        left(coalesce(nullif(previous.name, ''), 'Untitled event'), 500)
          || ' has a change request waiting for your decision.');
  end if;

  return jsonb_build_object(
    'outcome', 'ok',
    'coordinator_notified', previous.coordinator_id is not null,
    'request', to_jsonb(saved)
  );
end;
$$;

revoke all on function public.raise_event_change_request(integer, uuid, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.raise_event_change_request(integer, uuid, text, jsonb, text) to service_role;

commit;
