# SG2-52: Maintain equipment records

Technical Support Staff can record and update ConnectSphere's equipment through
the **Equipment** screen. The catalogue shows the type, description, quantity
held, location, operational status and available quantity for each stored record.
Jira's three acceptance criteria were verified in the live SG2-52 description on
7 October 2026.

| Acceptance criterion | Behaviour | Verification |
| --- | --- | --- |
| AC1: create and update type, description, quantity held, location and operational status | Add/edit form persists all five fields; reopening retrieves the saved values | API, adapter and rendered component tests; SG2-52-P01 browser journey |
| AC2: exclude damaged and maintenance stock from availability | Operational stock contributes its quantity held; Damaged and Under maintenance contribute zero | Generated SQL column, API/component assertions and SG2-52-P02 browser journey |
| AC3: only Technical Support Staff edit equipment | Verified server permissions guard both write routes; PostgreSQL RLS also guards direct client writes | Every other role and unsigned callers denied in SG2-52-N02; independent SQL policy assertions |

## API and validation

All routes require a bearer token held by Technical Support Staff. Reads are
restricted to the same role until the equipment request workflow requires a
broader catalogue.

| Route | Success response |
| --- | --- |
| `GET /api/equipment` | `200 { equipment: [...] }` |
| `POST /api/equipment` | `201 { equipment: ... }` |
| `PATCH /api/equipment/:equipmentId` | `200 { equipment: ... }` |

Create and edit send `type`, `description`, `quantity_held`, `location` and
`operational_status`. An edit additionally sends the `version` returned when the
record was read. Text is trimmed and required. Type allows 255 Unicode code
points; description and location allow 2,000. Quantity held must be a JSON integer
from 0 through 2,147,483,647. Operational status is one of `operational`, `damaged`
or `maintenance`, displayed as Operational, Damaged or Under maintenance.

Records additionally return `equipment_id`, `available_quantity` and `version`.
Available quantity is the stock eligible by operational status. Time-specific
equipment requirements, reservations and booking decisions are subsequent stories.

Invalid fields or IDs return 400, missing credentials 401, denied access 403,
stale or missing edit targets 409, and storage failures 503. A failed save retains
the entered fields. A conflict prevents further saves until **Reload records**
fetches the current record. Saving immediately disables the form and prevents a
second mutation from a rapid click. The server compares the submitted version
atomically so a stale editor cannot replace a newer save.

## Database setup

Apply `supabase/migrations/202610070001_equipment_records.sql` after the earlier
migrations, using the repository's existing migration process. No new environment
variables are required. The API uses the existing Supabase URL and anon key with
the caller's token.

Also apply `supabase/migrations/202610070002_legacy_table_rls.sql` in sequence.
It restores self-profile and organisation-event isolation on older deployments,
allows the existing internal venue reads and Venue Staff writes, and reserves
roles, registrations and equipment reservations for the privileged API. It
clears table, column and sequence grants before restoring the required access.
The existing guarded booking and hold RPCs retain their owners and permissions.

The migration preserves `equipment_id`, `name` and `quantity_total`, which existing
equipment requests and the work queue reference. The API exposes the latter two
as `type` and `quantity_held`. It adds description, location, operational status,
version and a stored generated available quantity. Legacy records start with
description/location **Not recorded**, Operational status and version 1; existing
null or negative quantity values become zero. Support staff can complete those
records through the editor.

PostgreSQL enforces nonblank text, valid status and quantity constraints, advances
the version on every update, and enables/forces RLS. Authenticated clients can
write only the five equipment fields, and policies require their current
`technical_support_staff` role. Clients cannot set generated availability or the
version. Existing service-role queue reads retain access.

## Verification

Use Node 22 and `npm run ci` for the build, full application tests and 100% per-file
statement, branch, function and line coverage gates. `npm run test:regression`
builds and runs all browser journeys. For a focused browser run after building,
use `npx playwright test e2e/equipment.spec.ts`.

The Browser plugin is not available in this session, so browser verification uses
the repository's Playwright Chromium workflow. It drives the production React
build and real Express authorization/router over loopback, replacing only external
identity and storage with disposable fixtures. It does not access hosted Supabase.

| Category | Concrete scenario |
| --- | --- |
| NORMAL | Create and edit every field, reload persisted values, keep unrelated stock unchanged; damaged and maintenance stock show zero available quantity |
| BOUNDARY | Accept zero and the maximum whole quantity; reject negative, fractional and overflowing quantities and oversized text |
| CONFLICT | Rapid save issues one mutation; another staff save advances the version and a stale form cannot overwrite it |
| FAILURE | Incomplete records, every ungranted role and unsigned writes are refused; failed loads/saves and lost permissions have recovery coverage |

SG2-52-P01 checks the catalogue and editor at 390px and 1440px, meaningful page
content, page title, absence of framework overlays, console/runtime errors and
horizontal overflow. Set `SG2_52_SCREENSHOTS` to an existing directory outside the
repository to capture catalogue and editor screenshots at both widths.

`supabase/tests/equipment_records.sql` is included in the separate database-policy
CI job. It runs with the auth fixture and all migrations against disposable
PostgreSQL, rolls back synthetic test data, and verifies generated availability,
constraints, version conflicts and direct-client permissions. The accompanying
`.github/scripts/test-equipment-concurrency.mjs` uses separate database connections
and an observed row-lock wait to verify that two writers with the same version
produce one saved change. Database execution is recorded separately from browser
fixture results.

Local automated evidence does not provide teammate sign-off, current-commit
GitHub Actions results or a Vercel preview. Those DoD gates remain for the PR's
actual review and deployment evidence. No hosted migration or shared-data writes
are part of local testing.

### Local execution — 7 October 2026

The final `npm run ci` passed with **1,043 backend runner cases**, **925 frontend
runner cases**, all inventory guards and all 19 reviewer-tool tests. Every
application file retained **100% statements, branches, functions and lines**.
The catalogue adapter also verifies that a 1,001-record inventory is retrieved
across the provider's default 1,000-record page limit. Local execution used Node
24.10.0; the existing GitHub Actions workflow verifies Node 22 on the pushed commit.
The final local build and coverage log is `/tmp/sg2-52-ci.log`.

The complete browser regression passed **56/56 journeys**, including all five
SG2-52 cases, with the production build and isolated loopback fixtures. E2E
TypeScript compilation, all **13 report-gate tests** and the required SG2-26 report
gate passed. Installed Google Chrome ran through a temporary Playwright config
because downloaded Playwright Chromium and the Browser plugin were unavailable;
video was disabled. Reports, logs and the four catalogue/editor screenshots are
under `/tmp/sg2-52-qa` and `/tmp/sg2-52-full-browser.log`, outside the repository.
Visual inspection confirmed readable controls and clean wrapping/alignment at
390px and 1440px; the browser checked console/runtime errors, overlays and overflow.

Native **PostgreSQL 17.11** in an isolated `postgres:17` container passed all **19
migrations**, **14 SQL suites**, and **three concurrency scripts/eight scenarios**.
This includes the SG2-52 generated-availability/constraint/RLS suite and the
concurrent stale-writer and refreshed-editor checks. Final passing logs are
`/private/tmp/sg2-52-sql-suites.log` and
`/private/tmp/sg2-52-sql-concurrency.log`. The task container and its volume were
removed after verification. Hosted Supabase was not used.

The [SPM Test Cases workbook](https://docs.google.com/spreadsheets/d/1SPPWhdqrtvg7xQVbJaUia2ZbZDjwtciceW6-RgrzI8o/edit?gid=19761001&range=A1656:Y1734#gid=19761001)
contains **79 SG2-52 declarations and SQL contracts** in **Main Test Cases,
A1656:Y1734**. All four category tags, AC mappings, fixtures, expected assertions,
source locations and measured local results were added and read back. The tab's
existing filter was extended to include the new rows. Parameterized declarations
may run multiple cases; these rows are not 79 independent acceptance workflows.
Teammate review fields remain pending. The user-supplied old tab ID 1667940799 was
absent; the existing test register has sheet ID 19761001.

### Supabase application and compatibility — 7 October 2026

Both migrations were applied to **Team2-SPM** (`xmcsddfgqelfzqiperzx`) through the
SQL Editor and recorded in `supabase_migrations.schema_migrations`. The stored
scripts match the repository files after normalizing CRLF line endings. Hosted
metadata confirms enabled/forced RLS on all seven affected tables, no anonymous
table or column access, the exact five equipment and six venue write columns,
and preserved service-role CRUD. Security Advisor reports **zero errors** after
rerunning its analysis, down from the original seven disabled-RLS errors.

The follow-up migration passed all **20 migrations, 15 SQL suites and eight
concurrency scenarios** on disposable PostgreSQL 17.11. Its 30 tagged assertions
cover all seven account roles, organisation boundaries, changed roles, anonymous
access, primary-key/delete/TRUNCATE denial and legitimate service operations.
A simulated older schema with disabled RLS, broad grants and stale column grants
was repaired, and two reapplications passed the same assertions. These checks
were added to **Main Test Cases, A1735:Y1764**, with all 750 values read back.
Teammate validation remains pending.

The final `npm run ci` passed again with **1,043 backend and 925 frontend cases**
and 100% per-file coverage. Its log is `/tmp/sg2-52-final-ci-success.log`. An earlier
attempt encountered a transient socket reset in an existing venue-operations test;
both the coverage retry and the subsequent complete CI run passed.

Eight Advisor warnings concern intentionally authenticated SECURITY DEFINER RPCs.
Their hosted bodies match the tested source apart from line endings; empty search
paths, current-account/role/ownership guards and anonymous EXECUTE denial remain
in place. Leaked-password protection is unavailable on this project's **Free**
plan, so the ninth warning remains. No plan, billing or authentication settings
were changed. Hosted verification used trusted schema and privilege metadata;
the deployed browser application and shared-data workflows were not exercised.
