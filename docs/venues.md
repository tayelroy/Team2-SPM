# SG2-42: Maintain venue records

Venue Staff can create and edit records. Event Coordinators can read the
catalogue. Both the API and Supabase row-level policies enforce this distinction;
the prototype role picker grants no access to venue records.

## Minimal scope

The catalogue uses the existing theme, shared cards, labels, notices and buttons.
It supports add/edit, text search across the saved details, loading, empty,
permission-denied and retry states. Search uses the loaded catalogue and re-filters
immediately after saving. Booking links retain the existing prototype navigation;
this story does not persist bookings or implement date/layout suitability filters.

The API requires a complete record: name, location, positive integer capacity,
facilities, accessibility features and operating information. Name is limited to
255 characters, matching Supabase. Enter `None` when a feature is unavailable.
Existing nullable fields are displayed as not recorded and can be completed in
the editor. IDs and role fields in the request body are ignored.

| Endpoint | Permission | Result |
| --- | --- | --- |
| `GET /api/venues` | `venues.read`: Venue Staff, Event Coordinator | `{ venues: [...] }` |
| `POST /api/venues` | `venues.create`: Venue Staff | `201 { venue: ... }` |
| `PUT /api/venues/:venueId` | `venues.update`: Venue Staff | `200 { venue: ... }` |

All requests carry `Authorization: Bearer <access_token>` and responses are not
cached. Invalid input returns 400, missing/invalid credentials 401, denied access
403, a missing/inaccessible update target 404, and service failures 503.
The backend uses `SUPABASE_URL` and `SUPABASE_ANON_KEY` with the caller's token;
it never falls back to the service-role key for venue operations.

## Schema and integration

The columns match Dao Jun's
[core schema on SG2-44](https://github.com/tayelroy/Team2-SPM/blob/feature/SG2-44-view-venue-availability/supabase/migrations/202609080000_core_schema.sql):
`venue_id` (serial), `name` (varchar 255), `location` (text), `capacity` (integer),
`facilities` (text), `accessibility_features` (text), `operating_information` (text).

`202609110001_venues.sql` preserves an existing table, creates the matching table
on branches without the core migration, and adds grants/RLS. Review migration
history with SG2-21/SG2-44 before deployment; a manually provisioned database may
already contain the core tables. No migration was applied to the shared Supabase
project during development. This migration assumes the standard sequence name
from the captured core schema. It adds no availability or booking tables.

Login remains owned by SG2-23. Pass the current session token into
`<Venues accessToken={session?.accessToken ?? null} onBook={...} />` once that
branch is integrated. `App` also accepts an optional `accessToken` prop for
integration tests. The current prototype entry point supplies no token and
therefore shows a sign-in notice. Login, registration and role assignment were
not changed. A seeded user must exist in Supabase Auth with a matching
`account_roles` row (`venue_staff` or `event_coordinator`).

The page loads server permissions before data. Token changes unmount stale data
and cancel requests. Save requests are authorized again by the backend, and a
401/403 removes write controls and cached records. There is no refresh-token
management in the venue feature. A failed in-flight write can have reached the
server even if the browser aborts; reload to confirm its outcome before retrying.

When SG2-44 merges, compose the catalogue and availability routes under the same
venue router, retaining each operation's permission. The permission map additions
must retain `event_request.create`, `users.role.update` and
`venues.availability.view` from their respective stories.

## Verification

Run `npm run ci` with Node 22. HTTP tests cover all five roles, forged role fields,
anonymous requests, create/update/readback, invalid input and service failures.
Frontend tests cover saved search results, read-only coordinators, retry,
duplicate submissions, cancellation and session changes. Supabase HTTP is mocked
in these tests; this does not prove the shared project's deployment is configured.

CI applies migrations in an isolated PostgreSQL database and runs
`supabase/tests/venues.sql` to check actual table grants and RLS. The SQL test
rolls back its fixtures. Live acceptance still needs the schema migration and
seeded login integration above.

### Playwright acceptance cases

Run `npx playwright install chromium` once, then `npm run test:e2e` on Node 22.
The four Chromium cases in `e2e/venues.spec.ts` are intentionally small:

| Case | Type | Expected result |
| --- | --- | --- |
| SG2-42-P01 | Positive | Staff create and edit a venue; search finds edited details after reloading. |
| SG2-42-N01 | Negative | Coordinator sees no write controls; direct/forged writes return 403, anonymous create returns 401, and data stays unchanged. |
| SG2-42-B01 | Boundary | Capacity 1 and 2147483647 save; 0, 1.5 and 2147483648 are rejected by the browser and API. |
| SG2-42-B02 | Boundary | A 255-character name saves; 256 characters show validation and cause no write. |

Each case starts from one fresh fixture venue. Playwright starts an isolated
loopback server containing the real venue page, shared shell, authorization
middleware and venue routes. Only principal lookup and the data store are test
doubles; Supabase credentials and live data are not used. The fixture supplies
the token at the login integration boundary and is excluded from production
builds. This does not test Ye Zhan's login flow or live Supabase persistence/RLS.
Tests run one at a time, with no retries, so resets cannot affect another case.

The GitHub Actions `browser-tests` job follows the existing Node 22, PR/merge
triggers and artifact conventions. Its result is required by `Build and test`.
The job uploads the HTML report plus failure screenshots/traces for 14 days.
Browser tests supplement the existing coverage and database jobs. `npm run ci`
keeps its existing build/coverage behavior; run `npm run test:e2e` separately.
