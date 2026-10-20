# Work through notifications (SG2-69)

Source: [SG2-69](https://smu-spm-group.atlassian.net/browse/SG2-69), read 20 October
2026. AC1–AC7 follow the seven acceptance bullets in Jira, including the
15 October reminder additions. The earlier delivery triggers are documented in
[notifications.md](notifications.md).

## Inbox and event navigation

The header bell uses `GET /api/notifications/inbox` for every signed-in role,
on every authenticated screen. It shows the number of unread notices across
**all** recipient-owned event and hold rows. The first page contains at most
50 rows. The badge displays `99+` above 99 unread notices; its accessible name
and the open inbox retain the exact total. “Load older notifications” follows a timestamp, source and ID cursor;
ties and repeated numeric IDs across the two tables are unambiguous. Rows are
ordered by creation time, source and ID, descending.

Both notice tables gain nullable `read_at`. Existing notices start unread.
Read and unread are labelled in text, with an accent border for unread rows.
Opening a row calls `POST /api/notifications/:source/:id/read`, then opens the
event summary associated with that notice. Reopening preserves the first read
timestamp. Notices without a linked event are marked read in place. Failed
writes keep the row and count unchanged so the user can retry.

`POST /api/notifications/read-all` clears the caller's unread state in both
tables, including unloaded pages. It preserves notice contents and existing
read timestamps. Rows arriving after the statement snapshot remain unread.
All responses are `no-store`; the bell refreshes on mount, window focus,
opening the drawer and every 30 seconds. Changing session or selected acting
role discards the previous view and pending responses. The unread count and
read receipts belong to the recipient across their held roles. Mutation replies
supersede earlier polls.

The event summary exposes only ID, name, status and proposed date, through
`GET /api/notifications/:source/:id/event`. The client cannot choose an arbitrary
event ID. SQL requires ownership of the notice and current access: coordinators
must still be assigned, organisers must own the request in their current
nonblank organisation, and attendees must be registered for the event. Internal
staff also need the current event relationship required by SG2-104 while acting
as that role. Holding a second role does not bypass the selected role's checks. Missing,
deleted or no-longer-accessible targets return the same unavailable response.
Coordinators can continue with “View event details” into the existing assigned-event work queue, including arrangement and planning controls. Organisers continue to their existing request detail. Other roles retain the limited summary. This does not grant access to the private full event-request APIs.

## Outstanding-arrangement reminders

The database job `sg2-69-arrangement-reminders` runs hourly (`0 * * * *`).
It does not depend on a browser being open. It uses Supabase's existing
[pg_cron scheduler](https://supabase.com/docs/guides/cron); no new Vercel cron,
Edge Function, environment variable or subscription upgrade is required.

An upcoming event has a nonnull future proposed date and a current assigned
Event Coordinator. Cancelled, completed and rejected events are excluded.
Safety Rejected events remain eligible while the coordinator reworks them.
“Outstanding” uses the SG2-57/confirmation arrangement rules:

- Venue: pending or rejected requests, no live request, a released/missing
  linked confirmed booking, an affected booking, or a persisted venue recheck.
- Equipment: a live request without placement, zero shortfall and a reservation
  receipt, or a persisted equipment recheck.
- Registration: registration is required but capacity/open/close settings are
  incomplete, or a persisted registration recheck remains.

Each reminder names the event and lists the outstanding categories. It is
stored as `outstanding_arrangements` in the coordinator's own inbox. No other
person receives these reminders. Completed arrangements suppress new reminders;
earlier notices remain as history.

The coordinator's drawer contains “Reminder frequency (days)”. The default is
daily; whole-day intervals from 1 to 30 are supported. GET/PUT
`/api/notifications/reminder-preferences` operates only on the caller's settings
while they are acting as an Event Coordinator. A role switch hides those controls;
revocation is checked again before a settings write.
The interval is measured in UTC hour buckets from the most recent reminder
**per event and recipient**. A daily reminder sent at 10:00:02 is eligible in
the next day's 10:00 hour, even if that sweep reaches it at 10:00:01. This avoids
accumulating an extra hour of delay from small variations in sweep timing.
The exact send timestamp remains recorded, and a second sweep in the same
hour cannot send another reminder. An hourly sweep can send less than one
hour before the exact elapsed-day anniversary; it does not use a day boundary
in the database session's local timezone. A new assignment is not suppressed by
the previous coordinator's reminder receipt. Shortening an interval can make
the next hourly sweep immediately eligible. Marking a reminder read does not
change its delivery cadence.

The sweep locks each event before reading arrangements and assignment, locks
the recipient's held coordinator role while sending, and commits the notice and cadence receipt
in one transaction. A transaction-level advisory lock prevents overlapping
sweeps from duplicating delivery. Preferences and receipts have forced RLS;
authenticated clients use guarded RPCs, and cannot invoke the scheduler or
write delivery receipts. All inbox RPCs use the caller's JWT. Legacy notification
routes and the `venue-hold-deadlines` job remain available. A coordinator holding
several roles still receives reminders without keeping a coordinator browser
session open; the scheduler checks their current held roles directly.

Event and role locks are held until the sweep transaction commits or rolls
back. Coordinator edits to those rows can therefore wait for the remaining
sweep, and the sweep can wait for an edit already in progress. The current
school-project scale keeps one ordered atomic sweep. Skipping locked events
would defer their reminders until a later hourly run; batching would require
a different transaction and retry contract. Neither behavior is introduced
by this cadence correction.

## Rollout and checks

Apply `supabase/migrations/202610200003_notifications_inbox_reminders.sql` after
all earlier migrations, including SG2-104's `202610200002_acting_role_functions.sql`,
and before deploying this API/client. The unreleased notification migration was
renumbered from `202610200002` to avoid a duplicate Supabase version when merging
SG2-104. The inventory/build gate rejects new duplicate migration versions;
the exact historical `202609220001` pair remains unchanged.
It adds columns,
indexes, private reminder tables, guarded RPCs and the named hourly job, and
reloads the PostgREST schema. It does not rewrite existing messages or delete
business rows. Historical notices becoming unread is intentional.

On hosted Supabase, verify the named job is active in `cron.job` and inspect
`cron.job_run_details` for successful runs. The existing hold-deadline job must
remain active. Plain PostgreSQL test images do not ship pg_cron, so the migration
reports its absence there; native tests invoke the same scheduler function
directly. A successful local test does not establish that a hosted job is installed.
Keep Supabase Free. If a Free project is paused, reminders resume only when its
database is running; this feature does not add an external wake-up service.

Validation is split across public seams:

- Route/store and client/component tests exercise real input, response, access,
  read-state, session and failure contracts with controlled providers.
- Native PostgreSQL and concurrency tests prove recipient isolation, paging,
  snapshot marking, readiness, cadence, stop conditions and competing sweeps.
- Native API integration traverses Express, the production Supabase adapter,
  PostgREST and disposable PostgreSQL using caller JWTs.
- `e2e/notification-inbox.spec.ts` drives the built app and real handlers with
  isolated storage at 1440px and 390px. Its reminder notice is seeded; scheduler
  correctness is proved by the native tests, not that browser fixture.
- `e2e/smoke.spec.ts` includes `SMOKE-INBOX-01` in the separate smoke CI job:
  open an unread notice, reach assigned event work, clear both notice sources,
  and retain read state after reload at phone width.
- `SG2-69-R01` refreshes two loaded inbox pages after a second authenticated
  session reads an older notice. Exact history order and all 54 rows remain.
- Native API case `SG2-69-API02` changes the organiser's current organisation in
  disposable PostgreSQL and proves target access is revoked and restored while
  historical read receipts remain owned and idempotent.

The method inventory and regression register hold execution evidence. Independent
teammate review remains required before merge; automated checks are not peer sign-off.
