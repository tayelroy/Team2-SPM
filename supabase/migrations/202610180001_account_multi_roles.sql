-- SG2-104: one account can hold several of the seven roles (customer
-- clarification session 2), replacing SG2-24 AC1's "exactly one role".
--
-- Every request still runs as exactly one role the account holds, its acting
-- role. The server picks it from the X-Acting-Role header (server/src/auth/
-- actingRole.ts) and forwards the header to PostgREST, where acting_role()
-- below checks it against the caller's own rows. Row level security keeps
-- asking "does the caller hold role X", so the database never grants more
-- than the account holds; the acting role only ever narrows that.
begin;

-- One row per role held, instead of one row per account. The seven-role
-- check, the read-own-rows policy and the grants stay as they are.
alter table public.account_roles drop constraint account_roles_pkey;
alter table public.account_roles add constraint account_roles_pkey primary key (user_id, role);
create index account_roles_role_user_idx on public.account_roles (role, user_id);

-- The role the caller acts as in this request: the X-Acting-Role header when
-- it names a role the caller holds, otherwise the caller's only role. Null
-- for a header naming a role not held, for several roles and no header (the
-- database never guesses which one), and for anonymous callers.
create function public.acting_role()
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  -- After a transaction-local set_config ends, the setting reads back as ''.
  raw text := nullif(current_setting('request.headers', true), '');
  requested text;
  held text[];
begin
  if caller is null then return null; end if;
  begin
    requested := raw::json ->> 'x-acting-role';
  exception when invalid_text_representation then
    return null;
  end;
  select coalesce(array_agg(ar.role order by ar.role), '{}') into held
    from public.account_roles ar where ar.user_id = caller;
  if requested is not null then
    return case when requested = any(held) then requested end;
  end if;
  return case when cardinality(held) = 1 then held[1] end;
end $$;

-- The same choice, holding a share lock on every role row of the caller until
-- the transaction ends, so a concurrent role change waits for the action in
-- progress and the action never runs on a role removed under it. A row
-- removed while this waits is skipped, so its role no longer counts.
create function public.lock_acting_role()
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  raw text := nullif(current_setting('request.headers', true), '');
  requested text;
  held text[];
begin
  if caller is null then return null; end if;
  begin
    requested := raw::json ->> 'x-acting-role';
  exception when invalid_text_representation then
    return null;
  end;
  select coalesce(array_agg(locked.role order by locked.role), '{}') into held
    from (select ar.role from public.account_roles ar where ar.user_id = caller for share) locked;
  if requested is not null then
    return case when requested = any(held) then requested end;
  end if;
  return case when cardinality(held) = 1 then held[1] end;
end $$;

revoke all on function public.acting_role(), public.lock_acting_role() from public, anon;
grant execute on function public.acting_role(), public.lock_acting_role() to authenticated, service_role;

-- Role administration (SG2-24, SG2-104): add one role, remove one role, or
-- replace every role with one. Called by the server with the verified actor,
-- never by clients. Separation of duties: nobody changes their own roles, the
-- actor must hold Technical Support Staff, and an account keeps at least one
-- role. Both accounts' rows are locked in (user_id, role) order first, so two
-- administrators changing each other cannot deadlock and a concurrent change
-- to the same account waits and then sees the outcome of the first.
create function public.change_account_roles(
  p_actor_id uuid, p_target_id uuid, p_action text, p_role text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  held text[];
begin
  if p_actor_id is null or p_target_id is null
      or p_action is null or p_action not in ('add', 'remove', 'replace')
      or p_role is null or p_role not in ('event_organiser', 'event_coordinator', 'venue_staff',
        'technical_support_staff', 'attendee', 'event_coordinator_lead', 'safety_officer') then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if p_actor_id = p_target_id then
    return jsonb_build_object('outcome', 'self');
  end if;

  perform 1 from public.account_roles ar
    where ar.user_id in (p_actor_id, p_target_id)
    order by ar.user_id, ar.role
    for update;
  if not exists (select 1 from public.account_roles ar
      where ar.user_id = p_actor_id and ar.role = 'technical_support_staff') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  select coalesce(array_agg(ar.role order by ar.role), '{}') into held
    from public.account_roles ar where ar.user_id = p_target_id;
  if cardinality(held) = 0 then
    return jsonb_build_object('outcome', 'missing');
  end if;

  if p_action = 'add' then
    if p_role = any(held) then
      return jsonb_build_object('outcome', 'unchanged', 'roles', to_jsonb(held));
    end if;
    insert into public.account_roles (user_id, role) values (p_target_id, p_role);
  elsif p_action = 'remove' then
    if not (p_role = any(held)) then
      return jsonb_build_object('outcome', 'unchanged', 'roles', to_jsonb(held));
    end if;
    if cardinality(held) = 1 then
      return jsonb_build_object('outcome', 'last_role', 'roles', to_jsonb(held));
    end if;
    delete from public.account_roles ar where ar.user_id = p_target_id and ar.role = p_role;
  else
    if held = array[p_role] then
      return jsonb_build_object('outcome', 'unchanged', 'roles', to_jsonb(held));
    end if;
    delete from public.account_roles ar where ar.user_id = p_target_id and ar.role <> p_role;
    insert into public.account_roles (user_id, role) values (p_target_id, p_role)
      on conflict (user_id, role) do nothing;
  end if;

  select array_agg(ar.role order by ar.role) into held
    from public.account_roles ar where ar.user_id = p_target_id;
  return jsonb_build_object('outcome', 'changed', 'roles', to_jsonb(held));
end $$;

revoke all on function public.change_account_roles(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.change_account_roles(uuid, uuid, text, text) to service_role;

commit;
