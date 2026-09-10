-- Core application schema: roles, users, venues, events, equipment, and
-- registrations. Captured from the provisioned Supabase project so a fresh
-- database (including the CI Postgres service) reproduces the same structure
-- that later migrations and features build on.
--
-- This migration intentionally does not enable row level security, matching
-- the current project state. RLS and per-table policies are added per feature.
begin;

create type public.event_status as enum (
  'draft', 'submitted', 'under_review', 'approved', 'planning',
  'confirmed', 'completed', 'cancelled', 'rejected'
);

create table public.roles (
  role_id     serial primary key,
  role_name   varchar(50) not null unique,
  description text
);

-- Seed the fixed role list. public.users.role_id is NOT NULL and account
-- creation looks up the "Attendee" row by name (see server/src/db/users.ts).
insert into public.roles (role_id, role_name) values
  (1, 'Event Organiser'),
  (2, 'Event Coordinator'),
  (3, 'Venue Staff'),
  (4, 'Technical Support Staff'),
  (5, 'Attendee');
select setval('public.roles_role_id_seq', (select max(role_id) from public.roles));

create table public.users (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  name         varchar(255) not null,
  organisation varchar(255),
  role_id      integer not null references public.roles(role_id)
);

create table public.venues (
  venue_id               serial primary key,
  name                   varchar(255) not null,
  location               text,
  capacity               integer,
  facilities             text,
  accessibility_features text,
  operating_information   text
);

create table public.events (
  event_id               serial primary key,
  organiser_id           uuid not null references public.users(user_id),
  coordinator_id         uuid references public.users(user_id),
  organisation           varchar(255),
  name                   varchar(255),
  purpose                text,
  description            text,
  proposed_date          timestamptz,
  expected_attendance    integer,
  venue_requirements     text,
  accessibility_needs    text,
  equipment_requirements text,
  registration_needed    boolean,
  status                 public.event_status not null default 'draft',
  -- Populated once a venue booking exists; the foreign key is added by the
  -- venue availability migration that creates public.venue_bookings.
  venue_booking_id       integer
);

create table public.equipment (
  equipment_id   serial primary key,
  name           varchar(255) not null,
  quantity_total integer
);

create table public.equipment_reservations (
  reservation_id    serial primary key,
  event_id          integer not null references public.events(event_id) on delete cascade,
  equipment_id      integer not null references public.equipment(equipment_id),
  quantity_reserved integer not null
);

create table public.registrations (
  registration_id serial primary key,
  event_id        integer not null references public.events(event_id) on delete cascade,
  attendee_id     uuid not null references public.users(user_id),
  status          varchar(50)
);

commit;
