# SG2-42: Maintain venue records

Story: Venue Staff maintain venue information in one place so coordinators can
plan against current details. Scope is the ConnectSphere application; shared
Supabase permission changes are deferred for team coordination.

## Acceptance criteria

| Jira criterion | Implementation | Verification |
| --- | --- | --- |
| Create and update location, capacity, facilities, accessibility features and operating information | Add/edit form and authenticated POST/PUT routes using the existing venue table | Create, edit all fields, read back saved record, reject invalid input |
| Updates are reflected in venue search | Search filters the saved catalogue by name, location and descriptive fields | Each edited text field is searchable; the old name stops matching; reload retrieves saved records |
| Non-Venue Staff cannot create or edit venues | Server-verified roles guard both write routes; UI uses server permissions | All five roles tested, forged role fields ignored, anonymous writes rejected, coordinator controls read-only |

The third criterion is verified at the ConnectSphere UI/API boundary. Direct
Supabase access still uses the database's existing grants with venue RLS disabled;
this application change does not close that separate access path.

## API and validation

| Endpoint | Allowed roles | Response |
| --- | --- | --- |
| `GET /api/venues` | Venue Staff, Event Coordinator | `{ venues: [...] }` |
| `POST /api/venues` | Venue Staff | `201 { venue: ... }` |
| `PUT /api/venues/:venueId` | Venue Staff | `200 { venue: ... }` |

Requests carry the current session bearer token. Writes contain `name`,
`location`, `capacity`, `facilities`, `accessibility_features`, and
`operating_information`. Text is trimmed, names allow 255 characters, and capacity
must be an integer from 1 to 2147483647. All fields are required; enter `None`
for unavailable features. Supplied IDs and role fields are ignored. Legacy rows
with null fields remain readable and can be completed through the editor.

Invalid input returns 400, missing credentials 401, denied access 403, a missing
update target 404, and service failures 503. Responses are not cached. Failed
saves retain form values; session changes cancel requests and clear stale data.
If a save loses its connection, reload to check whether it reached the server
before creating the same venue again. Existing booking navigation is a prototype
and is outside this story.

## Deployment and tests

This implementation needs no venue schema migration on the existing Team2-SPM
Supabase project. Use the server's existing Supabase/login configuration and
provisioned `account_roles`. Only explicit user saves change venue records.
Builds and tests use local fixtures and do not access the shared database.

Run `npm run ci` with Node 22. It builds both applications and enforces 100%
per-file statement, branch, function and line coverage. The focused venue suites
are `server/src/venues.test.ts`, `server/src/db/venues.test.ts`, and
`client/src/venues/Venues.test.tsx`; `client/src/App.test.tsx` checks login and
catalogue navigation together. Tests use mocked Supabase HTTP/storage, so they
verify the application contract rather than live database configuration.

## Regression testing

Run `npm run test:regression:sg2-42` with Node 22 for the venue router, database
adapter, logout, authorization, form/catalogue and application navigation tests. Run `npm run ci` before
merging to also build and check all application tests and coverage. The existing
CI workflow already discovers these suites on PR creation, every PR update,
merge queue runs and completed PR merges. There is no duplicate venue-only CI
job. Repository branch protection must require **Build and test** to block merges
on failures; this change does not configure GitHub branch protection.

| Test design | Cases and asserted outcomes | Suite |
| --- | --- | --- |
| Positive flow | Create, edit every field, reload; coordinator sees the saved record; unrelated venue stays unchanged | Router + production app/adapter integration |
| Search regression | Each edited text field matches; case and surrounding search whitespace are ignored; old name no longer matches; edit does not duplicate the venue; remount reads the saved edit | Catalogue |
| Inclusive boundaries | Capacity 1 and 2147483647; names of 1 and 255 Unicode code points; all text trimmed; ID 2147483647 reaches storage and returns 404 if absent | Router + form |
| Invalid input | Each required text field missing, blank or mistyped at API; missing/blank UI fields; zero, negative, fractional and overflowing capacities; numeric strings rejected at API; 256-character name; malformed IDs | Router + form |
| Authorization | Every role on both write routes; anonymous requests denied; forged role/ID fields ignored; coordinator has no editor; changing staff role denies the same token's next write before storage | Router + production app/adapter integration + catalogue |
| Save failure | 400/404/503 preserve all edits and allow retry; network failure leaves values and catalogue intact; 401/403 clear controls/data; missing row never reports success | Router + adapter + catalogue |
| Request lifecycle | Duplicate submissions make one request; pending form disabled; leaving aborts load/save; late success/failure cannot restore stale data | Catalogue |
| Catalogue loading | Permission and catalogue requests start together; either response may arrive first; neither records nor controls appear until both succeed; denied reads remain hidden | Catalogue |
| Session navigation | Logo returns staff/attendee home and preserves the session across reload; explicit sign-out clears it; 401/403 invalidate it while 500/503/network failures preserve it | App |
| Storage contract | Caller bearer token and public key; exact selected columns; update only specified ID; stable read order; timeout signal on attempts; failed writes are not retried; configuration cannot fall back to admin credentials | Adapter |
| Existing data/navigation | Null legacy fields display and can be completed; login opens the catalogue/editor; coordinator's existing request navigation still works | Catalogue + App |

Test fixtures replace only external identity/storage/HTTP boundaries. The adapter
integration uses the production Express app, authorization middleware, venue
router and Supabase SDK together; its fake HTTP responses are not evidence of
live PostgreSQL persistence or database permissions. UI tests use jsdom and do
not establish browser layout or native browser-validation behavior.

100% coverage measures execution of the included TypeScript/TSX source. It does
not prove every possible behavior, input or future change is correct. Assertions
above provide the requirement evidence; coverage is an additional regression
gate, with no new exclusions or coverage-ignore comments.

### Audit evidence — 14 September 2026

The revised suite passed `npm run ci`: 183 backend tests, 141 frontend tests and
19 reviewer tests (343 total), with 100% statements, branches, functions and lines
for every included application source file. The focused regression command also
passed. No shared Supabase operations were performed.

To check assertion strength, 13 selected defects were temporarily introduced one
at a time. All triggered test assertion failures: accepting zero capacity;
rejecting the valid name limit; bypassing API validation; allowing coordinator
edits; updating the wrong record; using the admin key; rejecting the valid form
capacity limit; counting UTF-16 units instead of Unicode code points; omitting
facilities from search; duplicating edited records; discarding failed edits;
not aborting a load; and allowing duplicate saves. Source files were restored
byte-for-byte after each run. This is a targeted fault check, not an exhaustive
mutation score. No mutation framework or dependency was added to the project.

### Session, profile and catalogue regression audit — 14 September 2026

The logo opens the signed-in user's home screen. Logout is inside the top-right
Profile options. Background validation clears the session only on 401/403;
permissions and catalogue records load concurrently without caching permissions
or changing database settings.

`npm run test:regression:sg2-42` passes 78 backend and 65 frontend checks. It now
includes the logout and authorization suites, alongside venue and App tests.
The complete CI command passes **350 tests**: 179 backend, 152 frontend and 19
reviewer, with 100% per-file statements, branches, functions and lines.
Six overlapping logout tests were consolidated into route-level contracts using
the real logout service, plus the existing production-app/SDK success workflow.
Unused fallback/`any` scaffolding was removed from the logout test fixture.

| Test design | Evidence |
| --- | --- |
| Positive | Logo/reload retain session; profile toggle and dismissal; Logout clears browser state immediately, waits for server confirmation, and stays signed out after reload |
| Negative | SDK returned/thrown errors and missing client produce 503; HTTP/network failures never restore local access; body tokens cannot select another session |
| Loading order | Either catalogue response may arrive first without exposing data early |
| Authorization | SDK receives current-session scope; simulated Auth revocation blocks the same token's subsequent read/write while another device remains signed in |

Five retained fault checks caused assertion failures: global logout scope,
ignoring SDK errors, retaining local session storage, ignoring logout HTTP errors,
and closing the profile on inside clicks.
Every source was restored byte-for-byte. This is targeted fault testing, not an
exhaustive mutation score or evidence of live Supabase revocation.

Browser checks used the built client and loopback fixtures: login, catalogue,
logo, reload, profile dropdown, keyboard dismissal, Logout and reload passed.
Controlled 2/3-second permission/catalogue delays started 2 ms apart and completed
in about 3 seconds overall; this is not a measurement of hosted latency.
No application console errors were observed. Shared Supabase was not accessed.

The root build now builds the client once through the server build. Vercel's
build command reuses `npm run ci` with blank Supabase credentials. Running that
exact command locally rejected a deliberate revocation regression (exit 1), then
passed after restoration (exit 0). See [CI and deployment gates](ci.md).

### Course test register

The [SPM Test Cases workbook](https://docs.google.com/spreadsheets/d/1SPPWhdqrtvg7xQVbJaUia2ZbZDjwtciceW6-RgrzI8o/edit)
uses the supplied template and retains five SG2-42 scenario IDs: `SG2-42-P01`
(create/edit/search), `SG2-42-N01` (permissions), `SG2-42-B01` (capacity/IDs),
`SG2-42-B02` (text/Unicode/allowlist), and `SG2-42-N02` (failure recovery).
The Automation index identifies the current executed tests supporting them.
Old browser-fixture and venue-RLS results were removed from the current register;
they do not establish this branch's behavior. Hosted CI and SQL cases remain
Not Executed for this snapshot.
