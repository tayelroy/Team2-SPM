# Hosted release readiness

The application build, database migrations and account provisioning are separate
release actions. A green CI run or a Vercel **Ready** deployment does not prove
that the application's hosted Supabase project has the required schema.

This gate supports SG2-23 (usable role sessions), SG2-25 (server authorization)
and SG2-96 (release documentation and verification). It does not replace their
acceptance tests or the Definition of Done.

## Before accepting a deployment

1. Confirm that the deployed server points to the intended Supabase project.
   Use the project dashboard and server configuration; do not copy keys into
   screenshots, issue comments or logs.
2. Review unapplied migrations and apply them to that project in filename order.
   Use the migration ledger together with the actual schema. Some historical
   setups used SQL Editor without a ledger; do not blindly reapply the entire
   directory to an existing database. Keep the release's migration result.
3. Run the complete contents of
   [`supabase/checks/release_readiness.sql`](../supabase/checks/release_readiness.sql)
   in that project's SQL Editor as the database operator. The script only reads
   schema metadata and the fixed role catalogue; it does not read event/person
   records, execute application RPCs, apply DDL or change data. It must finish
   without an exception and return `release_schema_status = ready`. An exception
   lists the failed contracts. Retain the result, project name, time and deployed
   commit in the release evidence; investigate failures before accepting release.
4. Confirm that PostgREST sees the schema as well. A passing SQL check cannot
   establish schema-cache freshness or unambiguous relationship selection.
   `events.venue_booking_id` and `venue_bookings.event_id` are two valid foreign
   keys between the same tables. A bare `venue_bookings(...)` embed is therefore
   ambiguous (PGRST201); the event-detail query must select the booking-to-event
   relationship explicitly with
   `venue_bookings!venue_bookings_event_id_fkey(ends_at, status)`. Keep both
   legitimate foreign keys. The isolated PostgREST integration test verifies
   this actual API query; catalogue existence alone cannot do so.
   Using the normal authenticated application,
   open the Lead's unassigned queue, reopen an organiser's saved draft, open
   coordinator history, and save/reopen planning information. Check a populated
   record as well as an empty state. A missing-column/relationship/RPC error
   after SQL passes needs investigation of the API schema cache and deployment;
   an empty or unavailable state is not a pass. Follow the operator's cache
   refresh procedure only after confirming the database schema is correct.
5. Run the affected normal workflow on clearly named QA records: draft → submit
   → Lead assignment → coordinator review, then the changed venue/equipment or
   confirmation actions. Verify persistence after reopening and check the
   relevant roles' notifications/history. Existing later-story prerequisites
   must be recorded honestly; manually seeding a later stage proves only that
   stage's slice, not that a fresh event can reach it through the UI.
6. Verify that authorised demo accounts exist for every shipped role. The role
   migration defines the role catalogue and grants; it does not create hosted
   Auth identities, profiles or account-role assignments. Memory E2E fixtures
   are not hosted accounts. Record the tested roles without recording passwords.

## What the structural gate checks

- Event detail, submission and planning columns, including the completion and
  submission timestamps; selected fragile column types.
- Supporting workflow tables, views and callable RPC signatures.
- All fourteen lifecycle enum values and all seven fixed role names.
- Foreign keys required by the organiser, coordinator, booking and audit embeds.
- Service-role read grants needed by the privileged readers.
- The planning registration fields/notes exposed by the work queue view.
- Notification columns and the validated literal `notifications_kind_check`
  allow-list, including `event_confirmed` and all five event lifecycle kinds.

Notification schema drift can produce a partial success: submission changes the
event state and writes history before its notice insert fails. The UI then
reports an error even though the request has entered the unassigned queue.
Migration `202610150001_event_confirmation.sql` adds `event_confirmed` to the
allow-list; `202610160001_event_notifications.sql` preserves it and adds
submission, assignment, clarification and event approval/rejection notices.
Check the actual constraint and required columns, not just migration-ledger
entries: a missing ledger row does not prove that every statement is absent.
The gate reads the constraint's literal allow-list without inserting a test
notice or executing its expression. Native API tests must still prove the
complete transition/history/notification result.

The view check verifies named JSON keys structurally. It does not prove that the
values are correct; the disposable database integration tests and the UI save /
reopen check do that. The gate is deliberately a maintained runtime contract,
not a complete schema diff, RLS audit, scheduler test or guarantee that every
feature works. Update it when a deployed feature adds a required dependency.

Tentative-hold expiry also needs the hosted scheduler setup described in
[`venue-holds.md`](venue-holds.md). Verify the named `venue-hold-deadlines`
database job is active, runs every minute in the intended database, and has a
successful execution. If `pg_cron` is unavailable, retain equivalent evidence
for the trusted external scheduler required by that document. Do not add a
second scheduler when the existing job is healthy.

Exercise a QA hold through its warning/deadline without opening the hold-list
or hold-notification endpoints, then inspect persisted expiry, notification and
history records through the operator's read-only checks before reopening the
UI. Those two application reads also sweep deadlines and can mask a missing
autonomous job. Occupancy stops counting an overdue hold immediately, while
persisting its lifecycle/history and delivering messages needs a sweep. Merely
having the RPC installed, or observing expiry after an application refresh, is
insufficient evidence that unattended scheduling works.

## CI and local verification

The database CI job applies every committed migration to its disposable
PostgreSQL service, runs the structural gate, and runs
[`release-readiness.test.mjs`](../.github/scripts/release-readiness.test.mjs).
The tests deliberately remove required columns, alter the queue view, rename a
role, revoke a grant and restore a legacy notification-kind constraint inside
transactions. Every mutation rolls back, and the
tests prove the next independent check passes again. All four test categories
are represented. No hosted credentials or automatic hosted migration are used.

Only run that mutation test with `POSTGRES_CONTAINER` pointing to the disposable
CI PostgreSQL container. Never adapt its mutation cases for a shared database.
The read-only SQL gate above is the script intended for the hosted SQL Editor.

`/health` reports process/configuration state; `/health/db` probes Supabase Auth
API availability. Neither endpoint proves that application tables, columns,
RPCs or RLS are ready. Their successful response is not a substitute for this
gate and the authenticated UI checks.

## Running the integration and smoke suites locally

Use Node.js 22, install the locked dependencies with `npm ci`, and run
`npm run ci` for the application build, unit tests and coverage gates.

- `npm run test:integration` needs Docker. By default it creates disposable
  PostgreSQL 17 and PostgREST containers, applies the committed migrations,
  tests the real Express handlers and Supabase adapters, then removes its
  containers. Identity tokens are synthetic; application role reads and
  database operations are real. It does not load hosted credentials or `.env`.
- `npm run build`, `npx playwright install chromium`, then `npm run test:smoke`
  run the short browser suite against the production app and isolated loopback
  storage. It checks all seven role sessions, organiser submission and Lead
  assignment, phone/desktop planning persistence, and stale reassignment.
- `npm run test:e2e` runs the complete browser regression, including smoke cases.
  Keep port 4173 free. Both browser commands start and stop their own fixture
  server; they do not target the shared staging URL.

CI runs the native API suite after the SQL/concurrency suites and runs smoke
as a separate required dependency of **Build and test**. Browser artifacts retain
reports, traces/failure evidence and successful layout captures for 14 days.
These isolated checks complement the authenticated hosted checks above.
