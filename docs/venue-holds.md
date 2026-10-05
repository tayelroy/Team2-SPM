# Tentative venue holds — SG2-84 and SG2-85

Venue Staff use **Venue holds** to reserve a venue for an approved or planning event with an assigned Event Coordinator. Select the event, venue and period, and enter a future expiry. Inputs use the device's local time; saved values are UTC instants and displayed dates use Singapore time. Event Coordinators use the same screen to view holds for their assigned events.

An active hold is labelled **Tentative** in the list and availability calendar. It conflicts with overlapping holds, bookings and unavailable periods and removes the venue from search matches for that period. Touching intervals do not overlap. Placement creates a pending venue booking request and informs the assigned coordinator, including the expiry. It creates no confirmed booking and does not change the event's status or approved booking pointer. Existing legacy `venue_bookings.status = 'held'` search warnings are preserved; the new effective view distinguishes SG2-84 records with `status = 'tentative'`.

**Approve booking** converts the hold through its linked pending request: current event eligibility, conflicts, venue facilities and capacity are checked again. An oversized booking requires the established capacity exception for that request and current attendance. Staff can approve the exception from the dashboard's selected booking request. Conversion records a confirmed booking, approves the request and associates the booking with the event. It leaves overall event confirmation to the event workflow. **Release hold** cancels the linked request and frees the period early.

At the deadline, the effective occupancy view releases the period immediately. Approval checks the database clock again under its locks, so an overdue hold cannot be converted even if the scheduler is late. Expiry cancels the pending request, records a system-authored entry in the existing event history, and informs the coordinator. An expired hold remains visible as **Expired**; staff must place a new request to reserve the period again. Converted and released holds are preserved and never expired by the timer.

## Database and scheduler setup

Apply `supabase/migrations/202610050001_venue_holds.sql` after the existing migrations. It adds:

- `venue_holds`: mandatory finite timestamps, deadline, linked request and booking, lifecycle status, creator and warning marker.
- `venue_hold_notifications`: persisted placement, warning and expiry messages, isolated by recipient and unique for each hold/recipient/message kind.
- `venue_hold_settings`: one administration-only warning lead-time setting.
- `venue_booking_occupancy`: confirmed/legacy bookings with their existing RLS, plus only unexpired Tentative holds through a guarded, limited projection.
- Transactional RPCs for placement, list, options, notices, release, conversion and deadline processing, plus venue-lock conflict enforcement for booking/block writes.

The database clock decides deadlines. All competing hold/booking writes lock the venue before checking conflicts. Mutations persist the hold, request, booking, history and notifications within one transaction. The deadline sweep skips venues locked by another mutation and retries them on its next run; deadline enforcement in occupancy and approval remains immediate. Direct authenticated mutations of hold or notification tables and calls to internal timer helpers are denied; routes use the caller's token, and RPCs independently enforce role/assignment restrictions.

Coordinators cannot read raw `venue_holds` records. Their detailed lifecycle reads use `list_venue_holds()`, which follows current event assignment. Venue Staff and Technical Support Staff retain their existing raw read access. The shared `venue_hold_occupancy()` projection independently checks the caller's account role and returns only venue, period, Tentative status and an event identifier visible to that caller. Other coordinators' event identifiers are null; hold/request/creator/deadline/history fields are absent. This preserves global availability/search without exposing unrelated hold metadata. Trusted service-role database queries remain supported; anonymous, external and missing-identity callers receive no hold data.

The migration schedules `public.process_venue_hold_deadlines()` every minute when `pg_cron` is available. The job runs inside PostgreSQL and requires no new application secret or environment variable. If the extension is unavailable, the migration emits a notice: provision a trusted scheduler that invokes this function every minute before deployment. Reads also process due transitions, but the scheduled job is required to deliver warnings and expiry notifications when nobody opens the application. A hold created within its warning window receives its warning immediately. The minute cadence means scheduled messages can arrive up to one minute after the threshold; occupancy and approval enforcement have no such delay.

The user confirmed a **24-hour default** on 5 October 2026. Administrators can adjust future warning processing without changing application code:

```sql
-- Trusted SQL administration only; authenticated application roles cannot edit settings.
update public.venue_hold_settings
set warning_lead_seconds = 86400
where singleton;
```

The setting accepts 1–2,592,000 seconds. Already emitted warnings are retained, rather than resent when the setting changes. Before staging sign-off, verify the `venue-hold-deadlines` job and its successful run in `cron.job` and `cron.job_run_details`, then check coordinator notifications and expiry history in the deployed application. See [Supabase Cron documentation](https://supabase.com/docs/guides/cron) for scheduling and job monitoring.

## API

All routes require a verified bearer token and send `Cache-Control: no-store`.

| Route | Actor and result |
| --- | --- |
| `GET /api/venue-holds` | Internal staff; coordinators receive only their assigned events; `{ holds }` includes lifecycle records. |
| `GET /api/venue-holds/options` | Venue Staff; eligible assigned events and venue catalogue for placement. |
| `POST /api/venue-holds` | Venue Staff; `{ event_id, venue_id, starts_at, ends_at, expires_at }`; `201 { hold }`. Times require explicit zones. |
| `POST /api/venue-holds/:id/convert` | Venue Staff; approval of an active hold's pending request; `200 { hold }`. |
| `POST /api/venue-holds/:id/release` | Venue Staff; early release of an active hold; `200 { hold }`. |
| `GET /api/venue-holds/notifications` | Internal users receive only their own persisted notifications. The existing bell loads these on sign-in, refreshes every 30 seconds and on window focus, and shares current notices with the open drawer. Opening the drawer refreshes immediately; failures can be retried. |

Invalid inputs return 400, missing records 404, conflicts/inactive holds/suitability failures 409, denied access 401/403 and provider failures 503. Failed saves preserve form input. Rapid repeated submissions and decisions issue a single mutation. Account changes and unmounted views cannot display obsolete read responses.

## Acceptance criteria and test evidence

AC numbers follow Jira's displayed bullet order, read in Chrome on 5 October 2026. The source catalogue is `docs/test-acceptance-criteria.json`. The exact tagged method/file/line inventory is generated into `docs/test-case-inventory.json` and checked by the existing CI build; the PR includes the relevant method rows. The regression register separates expected outcomes from dated execution evidence.

| Story / criterion | Observable result and principal evidence |
| --- | --- |
| SG2-84 AC1–AC2 | Staff placement with finite, future, mandatory expiry; public route/SQL validation and form/API tests. |
| SG2-84 AC3 | Conflict rejection, adjacent periods accepted, Tentative calendar and search occupancy; SQL suite and browser placement journey. |
| SG2-84 AC4 | Tentative distinguished from confirmed booking, no event status/booking-pointer change; SQL readback, calendar and hold list. |
| SG2-84 AC5 | Transactional conversion of the pending request or release; current suitability/capacity, repeated/stale decisions; SQL and browser lifecycle journeys. |
| SG2-84 AC6 | Placement message contains expiry and belongs to assigned coordinator; SQL recipient checks and live notification workflow. |
| SG2-85 AC1–AC3 | Expiry at deadline, immediate free period, conversion refused, new request required; deterministic clock/SQL cases and browser deadline journey. |
| SG2-85 AC4 | Default/configurable warning window, one warning and one expiry notice; SQL deadline processing and live inbox. |
| SG2-85 AC5 | Atomic system-authored expiry history; SQL readback and existing history drawer. |

Tests cover `[NORMAL]`, `[BOUNDARY]`, `[CONFLICT]` and `[FAILURE]` at public API, SDK, component, browser and SQL seams. Expected records, statuses and timestamps use independent fixtures. Controlled browser clocks and database lock observations replace timing guesses. The two-session concurrency check in `.github/scripts/test-venue-holds-concurrency.mjs` runs with the SQL suite in CI. Per-file statement, branch, function and line coverage remains at 100%; no thresholds or source exclusions were relaxed.

Local browser journeys use a production React build and real Express handlers with disposable storage and identity providers. They establish UI/API integration; the separate PostgreSQL suite establishes schema, RLS and transactional behavior. DoD v2.1 additionally requires 390px/1440px visual checks, a successful Vercel preview, and a teammate's structured review before merge. Local tests do not substitute for hosted Supabase, actual scheduler execution or that teammate approval. No other stories' assignment, general booking-decision or event-confirmation workflows are implemented here.


## Local verification — 5 October 2026

- `npm run ci`: clean production build; 924 backend and 808 frontend cases pass, with 100% statement, branch, function and line coverage per file. The existing inventory and reviewer checks pass. Local runtime: Node 24.10.0; CI uses Node 22.
- Full browser regression: 39/39 pass with no skips or retries; e2e TypeScript and all 13 report-gate checks pass. The final required SG2-26 report gate passes. Local Playwright used installed Chrome with video disabled in a temporary config; repository browser settings and dependencies are unchanged.
- Fresh disposable PostgreSQL 18.4: all 14 migrations and all 10 SQL suites pass. Four concurrency contracts also pass through the actual `psql` driver, including approval that crosses its deadline while waiting for an event lock; CI runs the same driver through its PostgreSQL 17 container.
- Additional SQL contracts verify placement against existing bookings/blocks, conversion after a new block, and complete rollback/retry when warning or expiry notifications fail. Fresh SQL and concurrency evidence: `/tmp/holds-real-sql-followup.log` and `/tmp/holds-psql-concurrency-followup.log`.
- PR #57's reported coordinator read-isolation finding is addressed at the database boundary. Thirteen additional SQL contracts verify direct-table denial, scoped RPCs across assignment changes, redacted global occupancy, restricted projection fields, external/missing-identity denial and staff/service compatibility. Fresh PostgreSQL verification again passed all 14 migrations and 10 suites; the independent patch review found no surviving bypass or regression. Final hosted verification is recorded on the PR.
- The 1440px/390px hold layouts and desktop/mobile notification portal were visually inspected. Screenshots are in `/tmp/sg2-holds-qa`; browser and SQL fixtures never use shared Supabase data.
- The latest `origin/main` was fetched and remained `dd9be1b76b6168f77c8a78b90ab3b36c97b4346b`, the branch base. The implementation has a successful Vercel preview. The PR must still obtain a teammate's structured sign-off and deployed database/scheduler verification before merge; final commit checks are recorded on PR #57.

## Notification refresh verification — 5 October 2026

The hold inbox now loads at sign-in and shares its current records with the badge and drawer. It refreshes every 30 seconds, on window focus and when opened. Overlapping refreshes share one pending request; account changes clear previous recipient data immediately and ignore old responses. Initial loading/failure is not displayed as a false zero, and background failures preserve known notices with a Retry action. This remains limited to SG2-84 AC6 and SG2-85 AC4.

Three additional component declarations cover polling with the drawer closed/open, focus failure/recovery and token changes with pending responses. Existing coverage also verifies request deduplication and timer/listener cleanup. Browser regression SG2-85-P02 verifies the badge goes from 1 to 2 at the warning threshold while closed, then expiry arrives with count 3 while the drawer remains open. The full local suite passes 39 browser cases and 924 backend/808 frontend tests with 100% coverage; screenshots at 1440px and 390px are retained in `/tmp/sg2-holds-refresh-qa`. Final hosted results are recorded on PR #57.
