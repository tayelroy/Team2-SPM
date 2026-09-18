# ConnectSphere

Event Planning & Venue Booking System — an SPM course project. Organisers raise
event requests, coordinators review and route them, and venue staff keep the
venue catalogue current, all behind role-based access control.

## Roles

| Role | Can do |
| --- | --- |
| Event Organiser | Raise, edit, submit and delete their own event requests; track status |
| Event Coordinator | View and review event requests; check venue availability |
| Venue Staff | Create and update the venue catalogue; check venue availability |
| Technical Support Staff | Change a user's role — the only role that can |
| Attendee | UI prototype only; not yet wired to a real backend |

Every account can view and update its own profile. Access is enforced
server-side by role on every request, not just hidden in the UI — see
[docs/authorization.md](docs/authorization.md) for how.

## Stack

React + Vite (`client/`), Express + TypeScript (`server/`), Supabase for
Auth + Postgres, npm workspaces.

## Getting started

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
