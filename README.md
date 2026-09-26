# ConnectSphere

Event Planning & Venue Booking System — an SPM course project. Organisers raise
event requests, venue staff keep the venue catalogue current, and access to
every action is checked by role on the server, not just hidden in the UI.

## What's in this repo

An npm-workspaces monorepo:

- **`client/`** — React + Vite single-page app.
  - `src/screens/` — one file per page (Login, Dashboard, RequestForm, DraftRequests, EventsTable, EventDetail, Venues, AvailabilityCalendar, Profile, plus a few still-prototype screens — see below).
  - `src/api/` — typed fetch wrappers for the backend, one module per feature area.
  - `src/auth/` — session storage and the client-side permission check used to decide what to show.
  - `src/mock/` — fixture data and types backing the screens that aren't wired to a real API yet.
- **`server/`** — Express + TypeScript API.
  - `src/auth/` — login, logout, session verification, and the role → permission map (`policy.ts`).
  - `src/events/` — event request handlers (create, list, detail, update, delete, submit).
  - `src/venues/` — venue catalogue and availability handlers.
  - `src/profile/` — the caller's own profile.
  - `src/db/` — the actual Supabase queries behind all of the above.
- **`supabase/`** — `migrations/` (schema history — not every table is captured yet), `seed_dev.sql`, `tests/`.
- **`docs/`** — deeper write-ups per subsystem/story, linked below.

## Roles

| Role | What's actually wired up today |
| --- | --- |
| Event Organiser | Raise, edit, submit and delete their own event requests; view events and status shared by their client organisation |
| Event Coordinator | View awaiting-review requests and their active assigned events in the dashboard; open each event's stored details |
| Venue Staff | View pending booking requests and details in the dashboard; maintain the venue catalogue and check availability |
| Technical Support Staff | View pending equipment requests and details in the dashboard; change a user's role via the API |
| Attendee | UI prototype only (mock data), not wired to a real backend |

Every account can view and update its own profile. Booking approval and the
equipment desk (visible in the Venue Staff / Technical Support Staff nav) are
also still prototype screens backed by mock data, not a real API.
The SG2-41 dashboard queue and its selected-record detail view use Supabase;
approval/rejection mutations are separate work. See [work queue setup](docs/work-queue.md)
for the required migration and queue rules.

Access is enforced server-side by role on every request — see
[docs/authorization.md](docs/authorization.md) for how the check works.

## Stack

React + Vite (`client/`), Express + TypeScript (`server/`), Supabase for
Auth + Postgres, npm workspaces.

## How to use the site

### Run it locally

1. **Prerequisite:** Node.js 22.22.2 or newer, on the Node 22 LTS line.
2. Clone the repo: `git clone https://github.com/tayelroy/Team2-SPM.git`
3. **Database:** create a Supabase project, then apply the migrations in
   [`supabase/migrations/`](supabase/migrations/) in filename order — either
   paste each file into the Supabase SQL Editor and run it in order, or
   `supabase db push` if you have the Supabase CLI linked to the project.
   That's the only setup a fresh database needs; there's no separate
   migration-runner script yet. Optionally also run
   [`supabase/seed_dev.sql`](supabase/seed_dev.sql) by hand for sample venue
   data.
4. **Configuration:** copy `server/.env.example` to `server/.env` and fill
   in your Supabase project's URL and anon key (Project Settings → API),
   and, if you need admin-only operations, the service role key — never
   expose this one to the client.
5. `npm ci` at the repo root.
6. Start both at once, or each separately in its own terminal:
   - **Both together:** `npm run dev` — runs the backend on `:5000` and the
     frontend on `:5173` concurrently; Vite proxies `/api/*` requests to the
     backend, so you only ever open the frontend URL.
   - **Server only:** `npm run dev --prefix server` (or `cd server && npm run dev`)
     — starts the Express API on `:5000`, reading `server/.env`.
   - **Client only:** `npm run dev --prefix client` (or `cd client && npm run dev`)
     — starts the Vite dev server on `:5173`. It expects the server already
     running on `:5000` for any `/api/*` call to work.
7. Open `http://localhost:5173`.

### Sign in

There's no public sign-up — accounts are seeded directly rather than
self-registered. Demo logins for each role (all use the same team-shared
password — ask a teammate for it rather than looking here, since this repo
is public):

| Role | Demo email |
| --- | --- |
| Event Organiser | `event.organiser1@connectsphere.test` |
| Event Coordinator | `event.coordinator1@connectsphere.test` |
| Venue Staff | `venue.staff1@connectsphere.test` |
| Technical Support Staff | `technical.support1@connectsphere.test` |
| Attendee | `attendee1@connectsphere.test` |

Two more numbered accounts (`2`, `3`) exist per role except Technical
Support Staff. From the landing page, click **Open app**, then sign in.
What you see afterward — the nav, the dashboard, which buttons even appear
— is scoped to your role, and the backend checks the same permission
independently of what the UI shows.

### As an Event Organiser

- **New request** starts a draft. Fill in whatever you know and **Save
  draft** at any point — an incomplete draft is fine.
- **My drafts** lists your saved drafts. Resume editing an unfinished one, or
  delete one you no longer need.
- Once every required field (name, purpose, description, date, expected
  attendance, venue requirements) is filled in, submit it for review from
  the request's own screen.
- **My events** shows requests belonging to your client organisation, including
  those raised by colleagues. Colleagues' requests are view-only; editing,
  submission and deletion remain with the creator. Your own drafts and rejected
  requests are flagged when they need your attention.
- Organisation membership is provisioned by an administrator; it cannot be changed
  through your profile. Accounts without an organisation see no events.

### As Venue Staff

- **Catalogue** to add or edit a venue's location, capacity, facilities,
  accessibility features and operating information.
- **Venue Availability** for the booking calendar.

### As Technical Support Staff

Role changes aren't exposed in a screen yet — call
`PATCH /api/users/:userId/role` directly with a bearer token and a JSON
body like `{"role": "Attendee"}`. The role must be Title Case exactly as
shown in the roles table above (e.g. `"Event Organiser"`) — lowercase or
snake_case is rejected.

## Getting started (build, test, coverage)

Use Node.js 22.22.2 or newer on the Node 22 LTS line and run `npm ci`, then
`npm run ci` to build both applications, run tests, and enforce coverage.
Tests mock Supabase HTTPS responses and use local HTTP sockets;
they do not need Supabase credentials or a running database.

Run `npm test` for tests without coverage, or `npm run test:coverage` for tests
with the 100% per-file coverage gate. HTML reports are written to `server/coverage/index.html`
and `client/coverage/index.html`.

For the 19 purposeful browser regression journeys, install Chromium once with
`npx playwright install chromium`, then run `npm run test:regression`. The tests
drive the built UI and real API routes against isolated in-memory providers;
they do not use shared Supabase data. `npm run ci:full` runs the existing build,
coverage and reviewer gates followed by Playwright. SQL policies run separately
in GitHub Actions. Browser reports, JSON/JUnit results and failure traces are
uploaded as the `browser-regression` artifact.

## Documentation

- [CI setup and validation](docs/ci.md) — SG2-22 acceptance criteria, required branch protection, and Supabase HTTPS configuration
- [Test audit and course case guide](docs/testing.md) — test-suite breakdown and how automated checks map to 4–5 functional cases per feature
- [Purposeful regression register](docs/regression.md) — current 29 cases, Playwright scope and historical-case consolidation
- [Authorisation](docs/authorization.md) — how requests are verified and permission-checked
- [Organisation event access](docs/organisation-events.md) — SG2-26 behaviour, provisioning and database protection
- [Venues](docs/venues.md) — SG2-42 venue catalogue acceptance criteria and API
- [Internal work queue](docs/work-queue.md) — SG2-41 role queues, selected-record details, Supabase migration and verification

CI runs the complete regression suite before and after each PR merge.

## Deployment

For the combined Vercel deployment, set **Root Directory** to `server` and enable
**Include source files outside of the Root Directory in the Build Step** so the
build can access `client`. `server/vercel.json` uses the **Other** framework preset,
installs both workspaces from the root lockfile, including build dependencies, and
runs the server build. Vercel publishes `server/public` as the static output and
packages `server/api/index.js` as the Express API function. `/` loads
`index.html` → `main.tsx` → `App.tsx`; `/healthcheck` loads the health-check page,
and `/api/*` and `/health/*` go to the backend. Static files are resolved before
page fallbacks, without rewriting page requests into the backend. The malformed
`/.index.html` path redirects to `/`. Redeploy after pushing changes.
