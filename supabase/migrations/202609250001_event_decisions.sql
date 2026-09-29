-- Coordinator approval and rejection decisions (SG2-37). Records the outcome
-- alongside who decided it and when, so a decision is never anonymous.
--
-- These columns live on public.events rather than a separate table so the
-- decision travels with the row every existing query already reads. SG2-40
-- ("see who changed what on an event") is expected to introduce a general
-- change history later; it can read these columns as the decision entry
-- rather than this story inventing a history table it does not own.
--
-- Row level security on public.events is owned by the organisation isolation
-- migration (202609210001) and is deliberately not touched here.
begin;

alter table public.events
  add column decided_by      uuid references public.users(user_id),
  add column decided_at      timestamptz,
  add column decision_reason text;

-- A rejection must explain itself (SG2-37 AC2). Enforced here as well as in
-- the handler so no future write path can reject an event silently. Approvals
-- may carry a reason but do not require one.
alter table public.events
  add constraint events_rejection_requires_reason
  check (status <> 'rejected' or decision_reason is not null);

-- A decision is recorded whole or not at all: who and when always travel
-- together, so a half-written decision cannot look like a valid one.
alter table public.events
  add constraint events_decision_recorded_together
  check ((decided_by is null) = (decided_at is null));

comment on column public.events.decided_by is
  'Coordinator who approved or rejected the request (SG2-37).';
comment on column public.events.decided_at is
  'When the approval or rejection was recorded (SG2-37).';
comment on column public.events.decision_reason is
  'Why the request was rejected; required for rejections, optional otherwise (SG2-37).';

commit;
