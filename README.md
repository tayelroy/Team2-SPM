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
| Event Organiser | Raise, edit, submit and delete their own event requests; see their own requests and status |
| Event Coordinator | Authorised to view event requests, but the query is still scoped to the caller's own id — in practice this returns nothing for a real coordinator yet (tracked separately) |
| Venue Staff | Create and update the venue catalogue; check venue availability |
| Technical Support Staff | Change a user's role — the only role that can, currently API-only (no screen for it yet) |
| Attendee | UI prototype only (mock data), not wired to a real backend |

Every account can view and update its own profile. Booking approval and the
equipment desk (visible in the Venue Staff / Technical Support Staff nav) are
also still prototype screens backed by mock data, not a real API.

Access is enforced server-side by role on every request — see
[docs/authorization.md](docs/authorization.md) for how the check works.

## Stack

React + Vite (`client/`), Express + TypeScript (`server/`), Supabase for
Auth + Postgres, npm workspaces.

## How to use the site

### Run it locally

1. Copy `server/.env.example` to `server/.env` and fill in your Supabase
   project's URL and anon key (and, if you need admin-only operations,
   the service role key — never expose this one to the client).
2. `npm ci` at the repo root.
3. `npm run dev` — starts the backend on `:5000` and the frontend on `:5173`
   together; Vite proxies `/api/*` requests to the backend.
4. Open `http://localhost:5173`.

### Sign in

There's no public sign-up — accounts are seeded directly rather than
self-registered, so you'll need an existing login for the role you want to
test (ask a teammate). From the landing page, click **Open app**, then sign
in. What you see afterward — the nav, the dashboard, which buttons even
appear — is scoped to your role, and the backend checks the same permission
independently of what the UI shows.

### As an Event Organiser

- **New request** starts a draft. Fill in whatever you know and **Save
  draft** at any point — an incomplete draft is fine.
- **My drafts** lists your saved drafts. Resume editing an unfinished one, or
  delete one you no longer need.
- Once every required field (name, purpose, description, date, expected
  attendance, venue requirements) is filled in, submit it for review from
  the request's own screen.
- **My events** shows every request you've raised and its current status;
  anything still waiting on you — a draft, or something sent back — is
  flagged.

### As Venue Staff

- **Catalogue** to add or edit a venue's location, capacity, facilities,
  accessibility features and operating information.
- **Venue Availability** for the booking calendar.

### As Technical Support Staff

Role changes aren't exposed in a screen yet — call
`PATCH /api/users/:userId/role` directly with the new role.

## Getting started (build, test, coverage)

Use Node.js 22.22.2 or newer on the Node 22 LTS line and run `npm ci`, then
`npm run ci` to build both applications, run tests, and enforce coverage.
Tests mock Supabase HTTPS responses and use local HTTP sockets;
they do not need Supabase credentials or a running database.

Run `npm test` for tests without coverage, or `npm run test:coverage` for tests
with the 100% per-file coverage gate. HTML reports are written to `server/coverage/index.html`
and `client/coverage/index.html`.

## Documentation

- [CI setup and validation](docs/ci.md) — SG2-22 acceptance criteria, required branch protection, and Supabase HTTPS configuration
- [Test audit and course case guide](docs/testing.md) — test-suite breakdown and how automated checks map to 4–5 functional cases per feature
- [Authorisation](docs/authorization.md) — how requests are verified and permission-checked
- [Venues](docs/venues.md) — SG2-42 venue catalogue acceptance criteria and API

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
