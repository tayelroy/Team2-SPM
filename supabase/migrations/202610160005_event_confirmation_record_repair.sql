-- SG2-58 hosted schema repair: the confirmation RPC may be present while its
-- nullable confirmation record columns were never applied. Keep the installed
-- function, notification rules, bookings and event data unchanged.
begin;

do $types$
begin
  if exists (select 1 from pg_attribute where attrelid = 'public.events'::regclass
      and attname = 'confirmed_by' and not attisdropped and atttypid <> 'uuid'::regtype)
    or exists (select 1 from pg_attribute where attrelid = 'public.events'::regclass
      and attname = 'confirmed_at' and not attisdropped and atttypid <> 'timestamptz'::regtype) then
    raise exception 'Confirmation record repair requires confirmed_by uuid and confirmed_at timestamptz; inspect incompatible existing types.';
  end if;
end
$types$;

alter table public.events
  add column if not exists confirmed_by uuid,
  add column if not exists confirmed_at timestamptz;

do $constraints$
declare
  confirmed_column smallint;
  user_column smallint;
  existing_name text;
  validated boolean;
begin
  select attnum into confirmed_column from pg_attribute
    where attrelid = 'public.events'::regclass and attname = 'confirmed_by' and not attisdropped;
  select attnum into user_column from pg_attribute
    where attrelid = 'public.users'::regclass and attname = 'user_id' and not attisdropped;
  if exists (select 1 from pg_constraint c where c.conrelid = 'public.events'::regclass
      and c.contype = 'f' and confirmed_column = any(c.conkey)
      and not (c.conkey = array[confirmed_column] and c.confrelid = 'public.users'::regclass
        and c.confkey = array[user_column])) then
    raise exception 'Confirmation record repair found an incompatible confirmed_by foreign key; inspect it before repair.';
  end if;
  select c.conname, c.convalidated into existing_name, validated from pg_constraint c
    where c.conrelid = 'public.events'::regclass and c.contype = 'f'
      and c.conkey = array[confirmed_column] and c.confrelid = 'public.users'::regclass
      and c.confkey = array[user_column] limit 1;
  if existing_name is null then
    alter table public.events add constraint events_confirmed_by_fkey
      foreign key (confirmed_by) references public.users(user_id);
  elsif not validated then
    execute format('alter table public.events validate constraint %I', existing_name);
  end if;

  if exists (select 1 from pg_constraint c where c.conrelid = 'public.events'::regclass
      and c.conname = 'events_confirmation_recorded_together'
      and (c.contype <> 'c' or regexp_replace(lower(pg_get_expr(c.conbin, c.conrelid)), '[[:space:]()]', '', 'g')
        not in ('confirmed_byisnull=confirmed_atisnull', 'confirmed_atisnull=confirmed_byisnull'))) then
    raise exception 'Confirmation record repair found an incompatible confirmation pair constraint; inspect it before repair.';
  end if;
  select c.conname, c.convalidated into existing_name, validated from pg_constraint c
    where c.conrelid = 'public.events'::regclass and c.contype = 'c'
      and regexp_replace(lower(pg_get_expr(c.conbin, c.conrelid)), '[[:space:]()]', '', 'g')
        in ('confirmed_byisnull=confirmed_atisnull', 'confirmed_atisnull=confirmed_byisnull') limit 1;
  if existing_name is null then
    alter table public.events add constraint events_confirmation_recorded_together
      check ((confirmed_by is null) = (confirmed_at is null));
  elsif not validated then
    execute format('alter table public.events validate constraint %I', existing_name);
  end if;
end
$constraints$;

comment on column public.events.confirmed_by is
  'Coordinator who confirmed the event (SG2-58 AC1); null for events confirmed before SG2-58.';
comment on column public.events.confirmed_at is
  'When the event was confirmed (SG2-58 AC1); null for events confirmed before SG2-58.';

commit;
