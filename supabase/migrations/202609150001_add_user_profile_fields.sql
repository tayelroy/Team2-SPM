-- SG2-27: profile fields not covered by any existing column or migration.
-- Contact details + comms preferences apply to everyone; department is only
-- meaningful for "internal" roles (which roles count as internal is still
-- an open product question - left nullable/unenforced here).
begin;

alter table public.users
  add column phone character varying,
  add column communication_preferences text[] not null default '{}',
  add column department character varying;

comment on column public.users.phone is
  'Contact phone number (SG2-27). Validated at the API layer.';
comment on column public.users.communication_preferences is
  'Preferred contact channels, e.g. {email, sms} (SG2-27). Validated at the API layer.';
comment on column public.users.department is
  'Only meaningful for internal roles; null otherwise (SG2-27).';

commit;
